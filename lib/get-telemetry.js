
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const telemetryLib            = require('./telemetry');
const MongoClient             = require('mongodb').MongoClient;
const AWS                     = require('aws-sdk');

const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const setOnna                 = sg.setOnna;
const deref                   = sg.deref;
const namespace               = 'layer67';

const s3                      = new AWS.S3();
var   bootstrap;

var lib = {};

lib.getSessionTelemetry = function() {
  var   u               = sg.prepUsage();

  var ra = raLib.adapt(arguments, (argv, context, callback) => {

    const sessionId          = argvGet(argv, u('sessionId',  '=sessionId', 'The sessionId.'));
    const clientId           = argvGet(argv, u('clientId',  '=clientId', 'The clientId.'));

    if (!sessionId)          { return u.sage('sessionId', 'Need sessionId.', callback); }

    const Bucket    = telemetryLib.bucketName();
    const Prefix    = telemetryLib.s3Key(clientId, sessionId);

    var result = {};
    return bootstrap('getSessionTelemetry', callback, function(err, db, config, eabort) {

      var   s3objects;
      return sg.__run3([function(next, enext, enag, ewarn) {

        return s3.listObjectsV2({Bucket, Prefix}, eabort(function(err, data) {
          s3objects = data || {Contents:[]};
          return next();
        }, 'listObjectsV2'));

      }, function(next, enext, enag, ewarn) {

        // All the bodies (that we will return) from S3 as Array, so they can be sorted
        var bodies = [];

        return sg.__eachll(s3objects.Contents, function(contents, nextContent, index_)  {

          // Get Key; skip non-JSON
          const Key = contents.Key;
          if (!Key.match(/[0-9a-f]+[.]json$/i)) { return nextContent(); }

          // Get the JSON from S3
          return s3.getObject({Bucket, Key}, function(err, s3file) {
            if (!sg.ok(err, s3file))          { console.error(err); return nextContent(); }

            // Parse the JSON
            const body  = sg.safeJSONParseQuiet(s3file.Body);
            if (!body)                        { return nextContent(); }

            // Remember mtime
            body.LastModified = contents.LastModified;

            // Put this item into the list of bodies
            const index = bodies.findIndex(x => x.LastModified>contents.LastModified);

            if (index === -1)     { bodies.push(body); }
            else                  { bodies.splice(index, 0, body); }

            // Next!
            return nextContent();
          });

        }, function() {

          // Build up result (projectId / clientId / sessionId / version; individual 'payloads' as 'itmes')
          _.each(bodies, body => {
            if (!body) { return; }

            _.each(_.omit(body, 'payload', 'items'), function(value, key) {
              setOnn(result, [key], value);
            });

            _.each(body.payload || body.items || [], item => {
              setOnna(result, ['items'], item);
            });
          });

          return next();
        });
      }], function() {
        if (db) { db.close(); }

        return callback(err, result);
      });
    });
  });
};


bootstrap = function(name, outerCb, callback) {

  const dbAddress = process.env.SERVERASSIST_DB_IP;
  var   dbUrl     = 'mongodb://'+dbAddress+':27017/'+namespace;
  var   db, config = {};

  return sg.__run([function(next) {
    if (db) { return next(); }

    return MongoClient.connect(dbUrl, function(err, db_) {
      if (!sg.ok(err, db_)) { return process.exit(2); }

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




