
/**
 *
 *
 * TODO: It is hard to keep the connections coherent (between both Redis and Node). Of
 *       course it is, but gotta make sure no data is lost.
 */
const sg                      = require('sgsg');
const _                       = sg._;
const http                    = require('http');
const Router                  = require('routes');
const redisUtils              = require('./lib/redis-utils');
const urlLib                  = require('url');
//const redisLib                = require('redis');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
//const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
//const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

var   routeHandlers           = require('./routes/feed');

//const redis                   = redisLib.createClient(redisPort, redisHost);

const packageName             = 'river';


const main = function() {

  var   ip    = ARGV.ip       || '127.0.0.1';
  const port  = ARGV.port;

  const router = Router();

  // Add the above handler to the URL map for the module.
  _.each(routeHandlers, (handler, name) => {
    router.addRoute(`/${packageName}/xapi/v1/${name}`, handler);
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
    if (sg.ok(err, result, result.text)) {
      ip = result.text;
    }

    server.listen(port, ip, function() {
      console.log(`Listening on ${ip}:${port}`);

      tell();
      function tell() {
        setTimeout(tell, 15 * 1000);

        // Register to handle /river
        redisUtils.tellService(`/${packageName}`, `http://${ip}:${port}`, 30, function(err) {

        // Register to handle /river/xapi/v1
        redisUtils.tellService(`/${packageName}/xapi/v1`, `http://${ip}:${port}`, 30, function(err) {
        });
        });
      };
    });
  });

};

// Call main
if (sg.callMain(ARGV, __filename)) {
  main();
}

