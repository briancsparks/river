
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const AWS                     = require('aws-sdk');
const urlLib                  = require('url');
const telemetryLib            = require('../../../lib/telemetry');
const getTelemetryLib         = require('../../../lib/get-telemetry');
const clients                 = require('../../../lib/clients');
const sessions                = require('../../../lib/sessions');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
var   bootstrap;

const namespace               = 'ntl';
const s3                      = new AWS.S3();

var lib = {};

/**
 *  Fetch telemetry from one session
 */
lib.download = function(req, res, params, splats, query) {
  // console.log(req.url, req.headers, params, splats, query);

  const getSessionTelemetry = raLib.contextify(getTelemetryLib.getSessionTelemetry, {req, res});
  const toTimeSeries        = raLib.contextify(getTelemetryLib.toTimeSeries, {req, res});
  const url                 = urlLib.parse(req.url, true);

  return sg.getBody(req, function(err) {

    const all = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});
    var   params = {};

    setOnn(params, 'sessionId', all.sessionId);
    setOnn(params, 'clientId',  all.clientId);
    setOnn(params, 'dataType',  all.dataType);

    return getSessionTelemetry(params, function(err, data) {
      if (!sg.ok(err, data))  { console.error(err); return sg._404(req, res); }

      const numItems = data.items && data.items.length;
      if (all.timeseries) {
        return toTimeSeries({telemetry:data}, function(err, ts) {
          data.timeSeriesMap = ts.timeSeriesMap;
          delete data.items;

          console.log(''+200+', '+(numItems)+' items for:'+req.url);
          return sg._200(req, res, data);
        });
      }

      /* otherwise */
      console.log(''+200+', '+(numItems)+' items for(asis):'+req.url);
      return sg._200(req, res, data);
    });
  });
};

/**
 *  Gets the S3 keys for the sessionId.
 */
lib.getS3Keys = function(req, res, params, splats, query) {
  const url                 = urlLib.parse(req.url, true);

  return sg.getBody(req, function(err) {

    const all       = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});
    const sessionId = all.sessionId || all.session;
    const clientId  = all.clientId  || all.client;
    const Bucket    = telemetryLib.bucketName();
    const Prefix    = telemetryLib.s3Key(clientId, sessionId);

    return s3.listObjectsV2({Bucket, Prefix}, function(err, data) {
      if (!sg.ok(err, data))    { return sg._404(req, res); }

      return sg._200(req, res, data);
    });
  });
};

/**
 *  Get an item from S3.
 */
lib.getS3 = function(req, res, params, splats, query) {
  const url                 = urlLib.parse(req.url, true);

  return sg.getBody(req, function(err) {

    const all       = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});
    const Key       = all.key;
    const Bucket    = telemetryLib.bucketName();

    return s3.getObject({Bucket, Key}, function(err, s3file) {
      if (!sg.ok(err, s3file))    { return sg._404(req, res); }

      if (s3file.ContentType.match(/[/]json/)) {
        return sg._200(req, res, sg.safeJSONParseQuiet(s3file.Body));
      }

      return sg._400(req, res);
    });
  });
};

/**
 *  Fetch telemetry from one session
 *
 * To receive the result:
 *
 *    for ((;;)); do sacurl -sS "https://b47console.mobilewebassist.net/ntl/xapi/v1/${RIVER_COLOR}/feed?clientId=asdf&watch=bsdf&expectJson=1" | jq '.'; sleep 0.5; echo '--'; done
 *
 * To send the request that causes this function to push data from s3
 *
 *    sacurl -sS "https://b47console.mobilewebassist.net/ntl/xapi/v1/${RIVER_COLOR}/download2?sessionId=A00CIOMLvczYMoUcdf0Vhy6SDuzlvwgWlXsqiu70vIOVttuC10gx0SojgN8faUHC-20180430160338402&dataType=telemetry&destKey=asdf&requestId=foobar&limit=2"
 *
 */
lib.download2 = function(req, res, matchParams, splats, query) {
  // console.log(req.url, req.headers, matchParams, splats, query);

  const sendSessionDataToFeed = raLib.contextify(sessions.sendSessionDataToFeed, {req, res});
  const url                   = urlLib.parse(req.url, true);

  return sg.getBody(req, function(err) {

    const all = sg._extend(req.bodyJson || {}, url.query || {}, matchParams ||{});

    return sendSessionDataToFeed(all, function(err, data) {
      if (!sg.ok(err, data))  { console.error(err); return sg._404(req, res); }

      /* otherwise */
      console.log({httpCode:200, err, data});
      return sg._200(req, res, data);
    });
  });
};

/**
 *  Pushes the clients to redis.
 *
 * To receive the result:
 *
 *    for ((;;)); do sacurl -sS "https://b47console.mobilewebassist.net/ntl/xapi/v1/${RIVER_COLOR}/feed?clientId=asdf&watch=bsdf&expectJson=1" | jq '.'; sleep 0.5; echo '--'; done
 *
 * To send some data:
 *
 *    sacurl -sS "https://b47console.mobilewebassist.net/ntl/xapi/v1/${RIVER_COLOR}/queryClients?destKey=asdf&requestId=foobar&limit=2"
 *
 */
lib.queryClients = function(req, res, params, splats, query) {
  const sendClientsToFeed = raLib.contextify(clients.sendClientsToFeed, {req, res});

  return sg.getBody(req, function(err) {

    // TODO: cannot send query directly from request into the DB
    return sendClientsToFeed(query, function(err, data) {
      if (!sg.ok(err, data))  { console.error(err); return sg._404(req, res); }

      console.log({httpCode:200, err, data});
      return sg._200(req, res, data);
    });
  });
};

/**
 * Pushes the sessions to redis.
 *
 * To receive the result:
 *
 *    for ((;;)); do sacurl -sS "https://b47console.mobilewebassist.net/ntl/xapi/v1/${RIVER_COLOR}/feed?clientId=asdf&watch=bsdf&expectJson=1" | jq '.'; sleep 0.5; echo '--'; done
 *
 * To send some data:
 *
 *    sacurl -sS "https://b47console.mobilewebassist.net/ntl/xapi/v1/${RIVER_COLOR}/querySessions?destKey=asdf&requestId=foobar&limit=2"
 *
 */
lib.querySessions = function(req, res, params, splats, query) {
  const sendSessionsToFeed = raLib.contextify(sessions.sendSessionsToFeed, {req, res});

  return sg.getBody(req, function(err) {

    // destKey, requestId, limit
    return sendSessionsToFeed(query, function(err, data) {
      if (!sg.ok(err, data))  { console.error(err); return sg._404(req, res); }

      console.log({httpCode:200, err, data});
      return sg._200(req, res, data);
    });
  });
};


_.each(lib, (value, key) => {
  exports[key] = value;
});

