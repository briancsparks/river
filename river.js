
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
const redisLib                = require('redis');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const redis                   = redisLib.createClient(redisPort, redisHost);

const packageName             = 'shovel';

var lib = {};

const main = function() {

  const ip    = ARGV.ip;
  const port  = ARGV.port;

  const router = Router();

  const shoveler = function(req, res, params, splats, query) {
    const url = urlLib.parse(req.url, true);
    var   done = false;

    return sg.getBody(req, function(err) {
      const all = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});

      const clientId      = all.clientId;
      const watchClientId = all.watchClientId || all.watch;

      if (!clientId)          { return errExit('Must provide your clientId', 400); }
      if (!watchClientId)     { return errExit('Must provide your clientId', 400); }

      const signalName   = `river:feedsignal:${watchClientId}`;
      const riverName    = `river:feed:${clientId}`;

      // Start a new connection and watch the list
      const clientBlocking   = redis.duplicate();

      sg.until(function(again, last, count, elapsed) {
        //console.log('until: ', count, elapsed);

        // Only try for so long
        if (elapsed > 1000 * 60 * 5) { return last(); }

        // On the 2nd, and futher times through the loop, dont let the other timer expire
        if (count > 1) {
          //console.log('Saving '+signalName+' from timeout');
          redis.expire(signalName, 60, (err, data) => {});
        }

        return clientBlocking.brpop(riverName, 45, function(err, data) {

          if (err)   { return sg._500(req, res, err); }
          if (!data) {
            //console.log('BRPOP timeout for '+riverName);
            return again(100); /*timeout*/
          }

          // When something shows up, send it to the client
          redis.srem(signalName, riverName, (err, sremData) => {
            //console.log('SREM('+signalName+','+riverName+')', err, sremData);
            return sg._200(req, res, data);
          });
        });
      }, function done() {
        // Should not get here
        return sg._200(req, res);
      });

      // Now let others know that we're waiting for data
      redis.sadd(signalName, riverName, (err, data) => {
        //console.log('sadd', signalName, riverName, err, data);
        redis.expire(signalName, 60, (err, data) => {
        });
      });

      // Then set error handlers to clean up
      req.on('error', (err) => {
        console.error(err, 'at req-on-err');
      });

      res.on('error', (err) => {
        console.error(err, 'at res-on-err');
      });

      // ----------------------------- No callbacks, or responding on req/res --------------------------
      // -----------------------------------------------------------------------------------------------
    });

    function errExit(msg, statusCode) {
      console.error(msg);
      return sg['_'+statusCode](req, res, {msg});
    }
  };

  router.addRoute('/shovel/client', shoveler);

  const server = http.createServer(function(req, res) {

    // We are a long-poll server
    req.setTimeout(0);
    res.setTimeout(0);

    const url       = urlLib.parse(req.url, true);
    const pathname  = url.pathname.toLowerCase();

    return sg.getBody(req, function(err) {
      const match = router.match(pathname);
      if (match && _.isFunction(match.fn)) {
        match.fn(req, res, match.params, match.splats, url.query);
        return;
      }

      return sg._404(req, res);
    });
  });

  server.listen(port, ip, function() {
    console.log(`Listening on ${ip}:${port}`);

    tell();
    function tell() {
      setTimeout(tell, 15);
      redisUtils.tellService(`/${packageName}`, `http://${ip}:${port}`, 30, function(err) {
        redisUtils.tellService(`/${packageName}/xapi/v1`, `http://${ip}:${port}`, 30, function(err) {
        });
      });
    };
  });



};




_.each(lib, (value, key) => {
  exports[key] = value;
});

if (sg.callMain(ARGV, __filename)) {
  main();
}

