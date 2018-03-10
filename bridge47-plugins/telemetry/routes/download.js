
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

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;

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



_.each(lib, (value, key) => {
  exports[key] = value;
});

