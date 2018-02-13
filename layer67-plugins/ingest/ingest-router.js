
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const Router                  = require('routes');
const redisUtils              = require('../../lib/redis-utils');
const unhandledRoutes         = require('../../lib/unhandled-routes');
const http                    = require('http');
const urlLib                  = require('url');
const request                 = sg.extlibs.superagent;


const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const unhandled               = unhandledRoutes.unhandled;

var   routeHandlers           = require('./routes/upload');

const packageName             = 'river';

const main = function() {

  var   ip          = ARGV.ip       || '127.0.0.1';
  const port        = ARGV.port;

  if (!port) {
    console.log('Need --port=');
    return process.exit(2);
  }

  const router = Router();

  // Add the loaded handlers to the route map
  _.each(routeHandlers, (handler, name) => {
    router.addRoute(`/${packageName}/xapi/v1/${name}`, handler);
  });

  // ---------- Node.js Server ----------

  // The typical Node.js server
  const server = http.createServer(function(req, res) {

    // We are a long-poll server
    req.setTimeout(0);
    res.setTimeout(0);

    const url       = urlLib.parse(req.url, true);
    const pathname  = url.pathname.toLowerCase();

    return sg.getBody(req, function(err) {
      if (err) { return unhandled(req, res); }

      // Collect all the interesting items
      const all = sg._extend(url.query, req.bodyJson || {});

      const match = router.match(pathname);
      if (match && _.isFunction(match.fn)) {
        match.fn(req, res, match.params, match.splats, url.query);
        return;
      }

      return unhandled(req, res);
    });
  });

  // Start listening
  return request.get('http://169.254.169.254/latest/meta-data/local-ipv4').end((err, result) => {
    if (sg.ok(err, result, result.text)) {
      ip = result.text;
    }

    return server.listen(port, ip, function() {
      console.log(`Listening on ${ip}:${port}`);
      next();

      tell();
      function tell() {
        setTimeout(tell, 15 * 1000);

        // Register to handle /river
        redisUtils.tellService(`/${packageName}`, `http://${ip}:${port}`, 30000, function(err) {

        // Register to handle /river/xapi/v1
        redisUtils.tellService(`/${packageName}/xapi/v1`, `http://${ip}:${port}`, 30000, function(err) {
        });
        });
      };
    });
  });
};





main();

