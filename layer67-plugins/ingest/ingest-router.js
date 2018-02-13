
/**
 *
 *  The Node.js server for the river-ingestion services.
 *
 *  Start like this:
 *
 *      sshix $ip "cd ~/dev/river/layer67-plugins/ingest && pm2 start ingest-router.js --name ingest -- --port=$(cat /tmp/config.json | jq -r '.routerPort')"
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
    const route = `/${packageName}/xapi/v1/${name}`;
    console.log('ingest -- handling route: '+route);

    router.addRoute(route, handler);
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

      tell();
      function tell() {
        setTimeout(tell, 15 * 1000);

//        redisUtils.tellService(`/${packageName}`, `http://${ip}:${port}`, 30000, function(err) {
//        });

        // Register to handle /river
        _.each(routeHandlers, (handler, name) => {
          // Register to handle /river/xapi/v1/{name}
          redisUtils.tellService(`/${packageName}/xapi/v1/${name}`, `http://${ip}:${port}`, 30000, function(err) {
          });
        });
      };
    });
  });
};





main();

