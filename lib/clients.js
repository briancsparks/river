
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const utilities               = require('./utilities');
const MongoClient             = require('mongodb').MongoClient;
const redisLib                = require('redis');
const feederLib               = require('./feeder');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const DataSet                 = feederLib.DataSet;
const prepForHttp             = utilities.prepForHttp;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const namespace               = 'ntl';

const redis                   = redisLib.createClient(redisPort, redisHost);

var lib = {};

const cProjection             = lib.projection = {
  clientId      :1,
  description   :1,
  email         :1,
  username      :1,
  ctime         :1,
  mtime         :1,
  _id           :0
};

const queryCursor = function(clientsDb, argv) {

  // Default query is all
  var query = {clientId:{$exists:true}};

  var projection = cProjection;

  var limit   = argvGet(argv, 'limit');

  var   cursor = clientsDb.find(query, {projection});

  // If we have no sort, yet, just use reverse-chrono
  cursor = cursor.sort({mtime:-1});

  // If we have not limited, yet, use 100
  cursor = cursor.limit(limit || 100);

  return cursor;
};

lib.sendClientsToFeed = function() {
  var   u               = sg.prepUsage();

  var ra = raLib.adapt(arguments, (argv, context, callback) => {

    const destKey         = argvGet(argv, u('dest-key,dest',      '=dest-key',    'The destination.'));
    const requestId       = argvGet(argv, u('request-id,req-ie',  '=request-id',  'The id for this request'));
    const limit           = argvGet(argv, u('limit',              '=limit',       'The limit')) || 100;

    if (!destKey)         { return u.sage('dest-key', 'Need destination key.', callback); }

    return bootstrap('sendClientsToFeed', callback, function(err, db, config, eabort, abort) {
      if (!sg.ok(err))  { return abort(err, 'sendClientsToFeed_bootstrap'); }

      const clientsDb = db.db('ntl').collection('clients');

      // Respond right away, then do the real work to push into redis
      callback(null, {ok:true});

      // Now, get the clients from the db
      const cursor = queryCursor(clientsDb, argv);
      return cursor.toArray(eabort(function(err, receipt) {

        var dataSet = new DataSet({name:'clients', items:prepForHttp(receipt)});
        return dataSet.sendTo(destKey, requestId, function(err, receipt) {
          db.close();
        });
      }));
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

