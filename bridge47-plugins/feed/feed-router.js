
/**
 *
 *  The Node.js server for the river-feed service.
 *
 *  Start like this:
 *
 *      sshix $ip "cd ~/dev/river/bridge47-plugins/feed && pm2 start feed-router.js --name feed -- --port=$(cat /tmp/config.json | jq -r '.routerPort')"
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const http                    = require('http');
const Router                  = require('routes');
const redisUtils              = require('../../lib/redis-utils');
const urlLib                  = require('url');
const request                 = sg.extlibs.superagent;

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const color                   = ARGV.color;
const stack                   = ARGV.stack;

var   routeHandlers           = require('./routes/feed');

const packageName             = 'ntl';


const main = function() {

  var   ip    = ARGV.ip       || '127.0.0.1';
  const port  = ARGV.port;

  if (!port || !color || !stack) {
    console.log('Need --port= and --color= and --stack=');
    return process.exit(2);
  }

  const router = Router();

  // Add the loaded handlers to the route map
  _.each(routeHandlers, (handler, name) => {
    const route = '/'+_.compact([packageName, 'xapi', 'v1', color, name]).join('/');
    console.log('feed -- registering route: '+route);

    router.addRoute(route, handler);
  });

  // ---------- Node.js Server ----------

  // The typical Node.js server
  const server = http.createServer(function(req, res) {

    // We are a long-poll server
    req.setTimeout(0);
    res.setTimeout(0);

    // The input URL
    const url       = urlLib.parse(req.url, true);
    const pathname  = url.pathname.toLowerCase();

    // Look at the HTTP body, too
    return sg.getBody(req, function(err) {
      const match = router.match(pathname);
      if (match && _.isFunction(match.fn)) {
        match.fn(req, res, match.params, match.splats, url.query);
        return;
      }

      return sg._404(req, res);
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

// Call main
main();

