
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const AWS                     = require('aws-sdk');
const clientsLib              = require('./clients');
const utilities               = require('./utilities');
const MongoClient             = require('mongodb').MongoClient;
const redisLib                = require('redis');
const feederLib               = require('./feeder');
const urlLib                  = require('url');
const telemetryLib            = require('./telemetry');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const cProjection             = clientsLib.projection;
const DataSet                 = feederLib.DataSet;
const prepForHttp             = utilities.prepForHttp;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const namespace               = 'ntl';
const s3                      = new AWS.S3();

const redis                   = redisLib.createClient(redisPort, redisHost);

var lib = {};

const sProjection             = {
  sessionId    :1,
  clientId     :1,
  ctime        :1,
  _id          :0
};

const queryCursor = function(sessionsDb, argv) {

  // Default query is all
  var query = {sessionId:{$exists:true}};

  var projection = sProjection;

  var limit   = argvGet(argv, 'limit');

  var   cursor = sessionsDb.find(query, {projection});

  // If we have no sort, yet, just use reverse-chrono
  cursor = cursor.sort({mtime:-1});

  // If we have not limited, yet, use 100
  cursor = cursor.limit(limit || 100);

  return cursor;
};

/**
 *  Sends the session object from the db to the redis feed for many sessions; appends
 *  the client objects for those sessions.
 */
lib.sendSessionsToFeed = function() {
  var   u               = sg.prepUsage();

  var ra = raLib.adapt(arguments, (argv, context, callback) => {

    const destKey         = argvGet(argv, u('dest-key,dest',      '=dest-key',    'The destination.'));
    const requestId       = argvGet(argv, u('request-id,req-ie',  '=request-id',  'The id for this request'));
    const limit           = argvGet(argv, u('limit',              '=limit',       'The limit')) || 100;

    if (!destKey)         { return u.sage('dest-key', 'Need destination key.', callback); }

    return bootstrap('sendSessionsToFeed', callback, function(err, db, config, eabort, abort) {
      if (!sg.ok(err))  { return abort(err, 'sendSessionsToFeed_bootstrap'); }

      const sessionsDb = db.db('ntl').collection('sessions');
      const clientsDb  = db.db('ntl').collection('clients');

      // Respond right away, then do the real work to push into redis
      callback(null, {ok:true});

      // Now, get the sessions from the db
      const cursor = queryCursor(sessionsDb, argv);
      return cursor.toArray(eabort(function(err, receipt) {

        var dataSet = new DataSet({name:'sessions', destKey, requestId, items:prepForHttp(receipt)});
        const clientIds = sg.keyMirror(_.pluck(receipt, 'clientId'));

        // Now, lookup each client and add it to the result
        return sg.__eachll(clientIds, function(clientId, next) {

          return clientsDb.find({clientId}, {projection:cProjection}).toArray(eabort(function(err, clients) {
            dataSet.pushItems('clients', prepForHttp(clients));
            return next();
          }));;

        }, function() {

          // Send the data to redis
          return dataSet.sendTo(/*destKey, requestId,*/ function(err, receipt) {
            db.close();
          });
        });

      }));
    });
  });
};

/**
 *  Sends a sessions data to the redis feed list, but feeds each chunk as it gets it from S3,
 *  it does not accumulate the chunks first.
 *
 *  TODO: Add asTimeSeries awareness
 *
 */
lib.sendSessionDataToFeed = function() {
  var   u               = sg.prepUsage();

  var ra = raLib.adapt(arguments, (argv, context, callback) => {

    const sessionId          = argvGet(argv, u('sessionId,session-id',  '=sessionId', 'The sessionId.'));
    const clientId           = argvGet(argv, u('clientId,client-id',  '=clientId', 'The clientId.'));
    const dataTypeStr        = argvGet(argv, u('data-types,data-type,type', '=telemetry', 'Data types to get (telemetry, attrstream).'));
    const dataTypes          = dataTypeStr ? sg.keyMirror(dataTypeStr) : null;
    const asTimeSeries       = argvGet(argv, u('as-time-series', '', ''));
    const destKey            = argvGet(argv, u('dest-key,dest',      '=dest-key',    'The destination.'));
    const requestId          = argvGet(argv, u('request-id,req-ie',  '=request-id',  'The id for this request'));

    if (!sessionId)          { return u.sage('sessionId', 'Need sessionId.', callback); }
    if (!destKey)            { return u.sage('dest-key', 'Need destination key.', callback); }

    const Bucket    = telemetryLib.bucketName();
    const Prefix    = telemetryLib.s3Key(clientId, sessionId);

    // Respond right away, then do the real work to push into redis
    callback(null, {ok:true});

    var   s3objects;

    return sg.iwrap('sendSessionDataToFeed', callback, function(eabort) {
      return s3.listObjectsV2({Bucket, Prefix}, eabort(function(err, data) {

        s3objects = data || {Contents:[]};
        if (ARGV.loud) {
          console.log(`Found these S3 objcets ${s3objects.Contents.length}`);
          _.each(s3objects.Contents, content => {
            console.log({content});
          });
        }

        return sg.__eachll(s3objects.Contents, function(contents, nextContent)  {
          if (!contents.Key.match(/[0-9a-f]+[.]json$/i)) { return nextContent(); }    /* skip non-JSON */

          var dataPoints;
          var dataSet = new DataSet({name:'sessions', destKey, requestId /*, items:prepForHttp(receipt)*/});
          return sg.__run3([function(next, enext, enag, ewarn) {
            // Get the JSON from S3
            return s3.getObject({Bucket, Key:contents.Key}, function(err, s3file) {
              if (!sg.ok(err, s3file))          { console.error(err); return nextContent(); }

              // Parse the JSON
              dataPoints  = sg.safeJSONParseQuiet(s3file.Body);
              if (!dataPoints)                        { return nextContent(); }

              // Fixup
              dataPoints.dataType     = dataPoints.dataType || 'telemetry';

              return next();
            });

          }, function(next, enext, enag, ewarn) {
            //if (!asTimeSeries) { return next(); }

            dataSet.pushItems('dataPoints', dataPoints);
            return next();
          }], function() {
            return dataSet.sendTo(/*destKey, requestId,*/ function(err, receipt) {
              return nextContent();
            });
          });



        }, function() {
          // Nothing
        });

      }, 'listObjectsV2'));
    });
  });
};


bootstrap = function(name, outerCb, callback) {

  const dbAddress   = process.env.SERVERASSIST_DB_IP                  || '10.12.21.229';
  var   dbUrl       = 'mongodb://'+dbAddress+':27017/'+namespace;
  var   db, config  = {};

  return sg.__run([function(next) {
    if (db) { return next(); }

    return MongoClient.connect(dbUrl, function(err, db_) {
      if (!sg.ok(err, db_))   { console.error(err); return process.exit(2); }

      db = db_;
      return next();
    });

  }, function(next) {
    config.accts = sg.parseOn2Chars(process.env.JSAWS_AWS_ACCTS || '', ',', ':');
    return next();

  }], function done() {

    if (!name) {
      return callback(null, db, config);
    }

    return sg.iwrap(name, outerCb, abort, function(eabort) {
      return callback(null, db, config, eabort, abort);
    });
  });

  function abort(err, msg) {
    if (db)   { db.close(); }

    if (msg)  { return sg.die(err, outerCb, msg); }
    return outerCb(err);
  }
};


_.each(lib, (value, key) => {
  exports[key] = value;
});

