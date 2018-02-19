
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
  const url                 = urlLib.parse(req.url, true);

  return sg.getBody(req, function(err) {

    const all = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});
    var   params = {};

    setOnn(params, 'sessionId', all.sessionId);
    setOnn(params, 'clientId',  all.clientId);

    return getSessionTelemetry(params, function(err, data) {
      if (!sg.ok(err, data))  { console.error(err); return sg._404(req, res); }

      console.log(''+200+', '+(data.items && data.items.length)+' items for:'+req.url);
      return sg._200(req, res, data);
    });
  });
};



_.each(lib, (value, key) => {
  exports[key] = value;
});

