
/**
 *
 *
 * TODO: It is hard to keep the connections coherent (between both Redis and Node). Of
 *       course it is, but gotta make sure no data is lost.
 */
const sg                      = require('sgsg');
const _                       = sg._;
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

var   lib = {};

/**
 *
 *  Shovel data to the client.
 *
 *
 */
lib.feed = function(req, res, params, splats, query) {
  const url = urlLib.parse(req.url, true);
  var   done = false;

  return sg.getBody(req, function(err) {
    const all = sg._extend(req.bodyJson || {}, url.query || {}, params ||{});

    //
    //  The inputs from the client are discovered here.
    //

    // Get the clients ID, and the ID of who is being watched.
    const clientId      = all.clientId;
    const watchClientId = all.watchClientId || all.watch;

    if (!clientId)          { return errExit('Must provide your clientId', 400); }
    if (!watchClientId)     { return errExit('Must provide the watched clientId', 400); }

    // The Redis keys are generated from the client IDs
    const signalName   = `river:feedsignal:${watchClientId}`;
    const riverName    = `river:feed:${clientId}`;

    // We must get a duplicate of the redis client object, because we are about to block.
    const clientBlocking   = redis.duplicate();

    // If we time-out, we come back here and go around again.
    sg.until(function(again, last, count, elapsed) {

      // But only try for so long
      if (elapsed > 1000 * 60 * 5) { return last(); }

      // On the 2nd, and futher times through the loop, dont let the other timer expire
      if (count > 1) {
        //console.log('Saving '+signalName+' from timeout');
        redis.expire(signalName, 60, (err, data) => {});
      }

      //
      // Here is the big wrinkle
      //

      // This is the blocking call to BRPOP
      return clientBlocking.brpop(riverName, 45, function(err, data) {

        // Was there an error, or did we timeout?
        if (err)   { return sg._500(req, res, err); }
        if (!data) {
          return again(100); /*timeout*/
        }

        // We didnt fail, or timeout, so we got some data... Send it to the client

        // But first, we will remove our id from Redis, so others are not confused.
        redis.srem(signalName, riverName, (err, sremData) => {
          return sg._200(req, res, data);
        });
      });

    }, function done() {
      // Should not get here
      return sg._200(req, res);
    });

    // Write a key on Redis so the other client knows where to send the data
    redis.sadd(signalName, riverName, (err, data) => {
      redis.expire(signalName, 60, (err, data) => {
      });
    });

    // Error handler
    req.on('error', (err) => {
      console.error(err, 'at req-on-err');
    });

    // Error handler
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


_.each(lib, (value, key) => {
  exports[key] = value;
});


