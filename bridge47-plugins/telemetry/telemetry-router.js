
/**
 *
 *  The Node.js server for the river-telemetry services.
 *
 *  Start like this:
 *
 *      sshix $ip "cd ~/dev/river/bridge47-plugins/telemetry && pm2 start telemetry-router.js --name telemetry -- --port=$(cat /tmp/config.json | jq -r '.routerPort')"
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
const color                   = ARGV.color;
const stack                   = ARGV.stack;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

var   routeHandlers           = lowerKeys(require('./routes/download'));

const packageName             = 'ntl';

const main = function() {
  var   ip          = ARGV.ip       || '127.0.0.1';
  const port        = ARGV.port;

  if (!port || !color || !stack) {
    console.log('Need --port= and --color= and --stack=');
    return process.exit(2);
  }

  const router = Router();

  // Add the loaded handlers to the route map
  _.each(routeHandlers, (handler, name) => {
    const route = '/'+_.compact([packageName, 'xapi', 'v1', color, name]).join('/');
    console.log('telemetry -- registering route: '+route);

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
      const all = sg._extend(url.query || {}, req.bodyJson || {});

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
    if (sg.ok(err, result) && result.text) {
      ip = result.text;
    }

    return server.listen(port, ip, function() {
      console.log(`Listening on ${ip}:${port}`);

      tell();
      function tell() {
        setTimeout(tell, 15 * 1000);

        // Register to handle routes
        _.each(routeHandlers, (handler, name) => {

          // Register to handle /ntl/xapi/v1/[color]/{name}
          const route = '/'+_.compact([packageName, 'xapi', 'v1', color, name]).join('/');

          redisUtils.tellStackService(route, `http://${ip}:${port}`, 30000, stack, function(err) {
          });
        });
      };
    });
  });
};





main();


function lowerKeys(obj) {
  return sg.reduce(obj, {}, (m, v, k) => {
    return sg.kv(m, k.toLowerCase(), v);
  })
}

