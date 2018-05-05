
/**
 *
 *  Handle the river data feed.
 *
 *  When a request comes in, we fetch data from Redis for it. If no
 *  data is available, we block (long-held connection) until data is
 *  available. (Of course, we do not wait forever.)
 *
 *  1. Handle the Node.js req/res, and get the HTTP body.
 *  2. Read from redis: 'river:feed:clientId' -- this is a blocking call.
 *  3. Write a 'signal' key into Redis so other clients know to send their data
 *     to our list.
 *
 *  *  Handle the client disconnecting.
 *
 *  To manual test, use curl from across the interwebs:
 *
 *      [sa]curl -sS 'https://rriver.mobilewebassist.net/ntl/xapi/v1/feed?clientId=asdf&watch=bsdf&expectJson=1'
 *
 *  Then, using redis-cli, send data:
 *
 *      redis-cli LPUSH river:feed:asdf '{"a":42}'
 *
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const urlLib                  = require('url');
const redisLib                = require('redis');
const getTelemetryLib         = require('../../../lib/get-telemetry');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const toTimeSeries            = getTelemetryLib.toTimeSeries;
const accumulateResultFromBody= getTelemetryLib.accumulateResultFromBody;
const feedVerbosity           = argvGet(ARGV, 'feed-verbosity,vfeed');
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const redis                   = redisLib.createClient(redisPort, redisHost);

var   lib = {};

/**
 *
 *  Shovel data to the client.
 *
 *
 */
lib.feed = function(req, res, params, splats, query) {
  const toTimeSeries        = raLib.contextify(getTelemetryLib.toTimeSeries, {req, res});
  const url                 = urlLib.parse(req.url, true);

  var   clientRequestIsInvalid;

  return sg.getBody(req, function(err) {
    const all = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});

    //
    //  The inputs from the client are discovered here.
    //

    // Get the clients ID, and the ID of who is being watched.
    const clientId          = all.clientId      || all.destKey;
    const watchClientId     = all.watchClientId || all.watch;

    if (!clientId)          { return errExit('Must provide your clientId', 400); }
//    if (!watchClientId)     { return errExit('Must provide the watched clientId', 400); }

    const dataTypeStr        = argvGet(all, 'data-types,data-type,type');
    const dataTypesOrig      = dataTypeStr ? sg.keyMirror(dataTypeStr) : null;
    const asTimeSeriesOrig   = argvGet(all, 'as-time-series,timeseries');

    // The Redis keys are generated from the client IDs
    const signalName   = watchClientId ? `river:feedsignal:${watchClientId}` : null;
    const riverName    = `river:feed:${clientId}`;

    // We must get a duplicate of the redis client object, because we are about to block.
    const clientBlocking   = redis.duplicate();

    const start = _.now();

    // If we time-out, we come back here and go around again.
    sg.until(function(again, last, count, elapsed) {

      // -----------------------------------------------------------------------------------------------------
      // !!!!!!!!!!!!! Handle when the client disconnects !!!!!!!!!!!!!!!!
      //

      // Make sure the client request is still valid
      if (clientRequestIsInvalid)         { return exitForBrokenRequest(); }

      // But only try for so long
      if (elapsed > 1000 * 60 * 5) { return last(); }

      // On the 2nd, and futher times through the loop, dont let the other timer expire
      if (signalName && count > 1) {
        //console.log('Saving '+signalName+' from timeout');
        redis.expire(signalName, 60, (err, redisData) => {});
      }

      //
      // Here is the big wrinkle
      //

      // This is the blocking call to BRPOP
      return clientBlocking.brpop(riverName, 45, function(err, redisData) {

        // -----------------------------------------------------------------------------------------------------
        // !!!!!!!!!!!!! Handle when the client disconnects !!!!!!!!!!!!!!!!
        //

        // Make sure the client request is still valid
        if (clientRequestIsInvalid)         { return exitForBrokenRequest(); }

        // Was there an error, or did we timeout?
        if (err)   { return sg._500(req, res, err); }
        if (!redisData) {
          return again(100); /*timeout*/
        }

        // We didnt fail, or timeout, so we got some data... Send it to the client; redisData === [ riverName, data_from_other ]
        const [ redisListName, redisPayload ] = redisData;
        const payloadObject                   = sg.safeJSONParseQuiet(redisPayload);
        var   [ optionsForResponse, body ]    = payloadObject;

        const dataTypes     = optionsForResponse.dataTypes    || dataTypesOrig;
        const asTimeSeries  = optionsForResponse.asTimeSeries || asTimeSeriesOrig;

        return sg.__run3([function(next, enext, enag, ewarn) {
          if (_.isString(body)) { logfeed(`Body starts as a string`); return next(); }

          body = accumulateResultFromBody({}, body, dataTypes);
          return next();

        }, function(next, enext, enag, ewarn) {
          if (!asTimeSeries)      { logfeed(`Conversion to TimeSeries not requested`); return next(); }
          if (_.isString(body))   { logfeed(`Body is a string, skipping conversion to TimeSeries`); return next(); }

          const itemsKey = findKeyForItems(body);
          const itemsParentKey = _.initial(itemsKey.split('.')).join('.');
          const items           = deref(body, itemsKey) || {};
          const parent          = deref(body, itemsParentKey);

          //console.log({itemsKey, itemsParentKey}, {body});
          if (parent.dataType !== 'telemetry') {
            logfeed(`Payload is not telemetry (${parent.dataType || 'undefined'}), skipping conversion to TimeSeries`);
            return next();
          }

          logfeed(`Converting to TimeSeries`);
          return toTimeSeries({telemetry:parent}, function(err, ts) {
            parent.timeSeriesMap = ts.timeSeriesMap;
            delete parent.items;

            return next();
          });

        }], function() {
          if (_.isString(body)) {
            body = sg.safeJSONStringQuiet(body) || body;
          }

          const result = { [_.last(redisListName.split(':'))] : body };

          // But first, we will give ourselves some time to re-connect, but otherwise
          // remove our signal
          if (signalName) {
            return redis.expire(signalName, 15, (err, redisData) => {
              return sg._200(req, res, result);
            });
          }

          /* otherwise */
          return sg._200(req, res, result);
        });
      });

    }, function done() {
      // We only get here when the sg.until:elapsed is > 5min
      return sg._200(req, res, {timeout: (_.now() - start)});
    });

    // Write a key on Redis so the other client knows where to send the data
    if (signalName) {
      redis.sadd(signalName, riverName, (err, redisData) => {
        redis.expire(signalName, 60, (err, redisData) => {
        });
      });
    }

    // Error handler
    req.on('close', () => {
      clientRequestIsInvalid = (clientRequestIsInvalid || '') + 'close';
      //console.error('at req-on-close');
    });

    req.on('aborted', () => {
      clientRequestIsInvalid = (clientRequestIsInvalid || '') + 'aborted';
      //console.error('at req-on-aborted');
    });

    req.on('end', () => {
      clientRequestIsInvalid = (clientRequestIsInvalid || '') + 'end';
      //console.log('request normal end');
    });

    function exitForBrokenRequest() {
      console.error('Exiting after broken client request: '+clientRequestIsInvalid);
      return sg._400(req, res, {clientReq: clientRequestIsInvalid});
    }

    // ----------------------------- No callbacks, or responding on req/res --------------------------
    // -----------------------------------------------------------------------------------------------

  });

  function errExit(msg, statusCode) {
    console.error(msg);
    return sg['_'+statusCode](req, res, {msg});
  }
};


_.each(lib, (value, key) => {
  exports[key] = value;
});


function logfeed() {
  if (!feedVerbosity) { return; }
  console.log.apply(console.log, arguments);
}

function findKeyForItems(obj) {
  if (sg.isnt(obj)) { return obj; }

  if (_.isArray(obj.items)) {
    return 'items';
  }

  const firstKey  = sg.firstKey(obj);
  const subKeys   = findKeyForItems(obj[firstKey]);

  if (!subKeys) { return; }

  return _.compact([firstKey, subKeys]).join('.');
}


