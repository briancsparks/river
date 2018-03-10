
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const telemetryLib            = require('./telemetry');
const MongoClient             = require('mongodb').MongoClient;
const AWS                     = require('aws-sdk');
const pondjs                  = require('pondjs');

const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const setOnna                 = sg.setOnna;
const deref                   = sg.deref;
const bootServices            = raLib.bootServices;
const TimeSeries              = pondjs.TimeSeries;
const namespace               = 'bridge47';

const s3                      = new AWS.S3();
var   bootstrap;

var lib = {};

lib.getSessionTelemetry = function() {
  var   u               = sg.prepUsage();

  var ra = raLib.adapt(arguments, (argv, context, callback) => {
    const toTimeSeries       = ra.wrap(lib.toTimeSeries);

    const sessionId          = argvGet(argv, u('sessionId,session-id',  '=sessionId', 'The sessionId.'));
    const clientId           = argvGet(argv, u('clientId,client-id',  '=clientId', 'The clientId.'));
    const dataTypeStr        = argvGet(argv, u('data-types,data-type,type', '=telemetry', 'Data types to get (telemetry, attrstream).'));
    const dataTypes          = dataTypeStr ? sg.keyMirror(dataTypeStr) : null;
    const asTimeSeries       = argvGet(argv, u('as-time-series', '', ''));

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

            // Fixup
            body.dataType     = body.dataType || 'telemetry';

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
            return lib.accumulateResultFromBody(result, body, dataTypes);
          });

          return next();
        });

      }, function(next, enext, enag, ewarn) {
        if (!asTimeSeries) { return next(); }

        return toTimeSeries({telemetry: result}, function(err, ts) {
          result.timeSeriesMap = ts.timeSeriesMap;
          delete result.items;

          return next();
        });

      }], function() {
        if (db) { db.close(); }

        return callback(err, result);
      });
    });
  });
};

lib.accumulateResultFromBody = function(result, body, dataTypes) {
  if (!body)                                   { return result; }
  if (dataTypes && !dataTypes[body.dataType])  { return result; }

  if (body.tick0) {
    if (body.tick0 < 1999999999 && body.tick0 > 1400000000) {
      // This is in seconds since epoch -- we want msec
      body.tick0 *= 1000;
    }

    body.tick0 = Math.floor(body.tick0);
  }

  _.each(_.omit(body, 'payload', 'items'), function(value, key) {
    setOnn(result, [key], value);
  });

  _.each(body.payload || body.items || [], item_ => {
    setOnna(result, ['items'], cleanDataPoint(item_, body));
  });

  return result;
};

lib.toTimeSeries = function() {
  var   u               = sg.prepUsage();

  var ra = raLib.adapt(arguments, (argv, context, callback) => {

    const telemetry           = argvGet(argv, u('telemetry',  '=telemetry', 'The telemetry.'));
    if (!telemetry)           { return u.sage('telemetry', 'Need telemetry.', callback); }

    var   result              = {};

    var   tick0               = telemetry.tick0 || 0;
    var   items               = telemetry.items || telemetry.payload || telemetry;

    // attrstream
    if (telemetry.dataType === 'attrstream') {
      items = _.map(items, function(item_) {
        var item = sg.kv(item_, 'tick', item_.when);
        item = sg.kv(item, 'eventType', [item.who, item.type, item.key].join('__'));
        return _.omit(item, 'when');
      });
    }

    // Sanitize items -- the eventType might not be a legal identifier
    items = _.map(items, function(item) {
      return sg.kv(item, 'eventType', cleanKey(item.eventType));
    });

    // Group all of the eventTypes together
    items = _.groupBy(items, 'eventType');

    // Build the timeSeries objects
    result.timeSeriesMap = sg.reduce(items, {}, function(m, events, key) {

      // Remove the eventType from the list of events (points)
      var   points = _.map(events, function(event) {
        return _.omit(event, 'eventType');
      });

      // All events that happened at the same time need to get squashed into one event
      points = _.groupBy(points, 'tick');

      points = sg.reduce(points, [], function(m, eventList, tick) {
        return sg.ap(m, [Math.floor(+tick + tick0), _.extend({}, ...eventList)]);
      });

      // Create the TimeSeries object
      return sg.kv(m, key, new TimeSeries({name: key, columns:['time', 'it'], points}));
    });

    return callback(null, result);
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

function cleanKey(key) {
  if (sg.isnt(key)) { return key; }

  return key.replace(/[^a-z0-9_]/ig, '_');
}

function cleanDataPoint(item, body) {
  var result = item;

  if (item.mod && (item.mod === item.module)) {
    result = _.omit(item, 'mod');
  }

  return result;
}


