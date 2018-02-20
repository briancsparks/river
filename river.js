
/**
 *
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const http                    = require('http');
const Router                  = require('routes');
const redisUtils              = require('./lib/redis-utils');
const urlLib                  = require('url');
const redisLib                = require('redis');
const request                 = sg.extlibs.superagent;

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const redis                   = redisLib.createClient(redisPort, redisHost);

const packageName             = 'river';


const main = function() {

  var   ip    = ARGV.ip       || '127.0.0.1';
  const port  = ARGV.port;

  const router = Router();

  /**
   *
   */
  const river = function(req, res, params, splats, query) {
    const url = urlLib.parse(req.url, true);
    var   done = false;

    return sg.getBody(req, function(err) {
      const all = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});

      return sg._200(res, req, {river: 'done'});

      //
      //  The inputs from the client are discovered here.
      //

      // ----------------------------- No callbacks, or responding on req/res --------------------------
      // -----------------------------------------------------------------------------------------------

    });
  };

  // Add the above handler to the URL map for the module.
  router.addRoute(`/${packageName}`, river);

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

  return request.get('http://169.254.169.254/latest/meta-data/local-ipv4').end((err, result) => {
    if (sg.ok(err, result) && result.text) {
      ip = result.text;
    }

    // Start listening
    return server.listen(port, ip, function() {
      console.log(`Listening on ${ip}:${port}`);

      // Tell the cluster that we are listening at /river
      tell();
      function tell() {
        setTimeout(tell, 15 * 1000);
        redisUtils.tellService(`/${packageName}`, `http://${ip}:${port}`, 30000, function(err) {
        });
      };
    });
  });

};

main();

