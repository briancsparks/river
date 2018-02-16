
/**
 *
 *  Handle the river data feed.
 *
 *  When a request comes in, we fetch data from Redis for it. If no
 *  data is available, we block (long-held connection) until data is
 *  available. (Of course, we do not wait forever.)
 *
 *  1. Handle the Node.js req/res, and get the HTTP body.
 *  2. Read from redis: 'river:feed:clientId' -- this is a blocking call.
 *  3. Write a 'signal' key into Redis so other clients know to send their data
 *     to our list.
 *
 *  *  Handle the client disconnecting.
 *
 *  To manual test, use curl from across the interwebs:
 *
 *      [sa]curl -sS 'https://rriver.mobilewebassist.net/ntl/xapi/v1/feed?clientId=asdf&watch=bsdf&expectJson=1'
 *
 *  Then, using redis-cli, send data:
 *
 *      redis-cli LPUSH river:feed:asdf '{"a":42}'
 *
 *
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

  var   clientRequestIsInvalid;

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

    const start = _.now();

    // If we time-out, we come back here and go around again.
    sg.until(function(again, last, count, elapsed) {

      // -----------------------------------------------------------------------------------------------------
      // !!!!!!!!!!!!! Handle when the client disconnects !!!!!!!!!!!!!!!!
      //

      // Make sure the client request is still valid
      if (clientRequestIsInvalid)         { return exitForBrokenRequest(); }

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

        // -----------------------------------------------------------------------------------------------------
        // !!!!!!!!!!!!! Handle when the client disconnects !!!!!!!!!!!!!!!!
        //

        // Make sure the client request is still valid
        if (clientRequestIsInvalid)         { return exitForBrokenRequest(); }

        // Was there an error, or did we timeout?
        if (err)   { return sg._500(req, res, err); }
        if (!data) {
          return again(100); /*timeout*/
        }

        // We didnt fail, or timeout, so we got some data... Send it to the client; data === [ riverName, data_from_other ]
        var   [ redisListName, payload ] = data;

        if (all.expectJson || all.json) {
          payload = sg.safeJSONParseQuiet(payload) || payload;
        }

        const result = { [_.last(redisListName.split(':'))] : payload };

        // But first, we will remove our id from Redis, so others are not confused.
        redis.srem(signalName, riverName, (err, sremData) => {
          return sg._200(req, res, result);
        });
      });

    }, function done() {
      // We only get here when the sg.until:elapsed is > 5min
      return sg._200(req, res, {timeout: (_.now() - start)});
    });

    // Write a key on Redis so the other client knows where to send the data
    redis.sadd(signalName, riverName, (err, data) => {
      redis.expire(signalName, 60, (err, data) => {
      });
    });

    // Error handler
    req.on('close', () => {
      clientRequestIsInvalid = (clientRequestIsInvalid || '') + 'close';
      //console.error('at req-on-close');
    });

    req.on('aborted', () => {
      clientRequestIsInvalid = (clientRequestIsInvalid || '') + 'aborted';
      //console.error('at req-on-aborted');
    });

    req.on('end', () => {
      clientRequestIsInvalid = (clientRequestIsInvalid || '') + 'end';
      //console.log('request normal end');
    });

    function exitForBrokenRequest() {
      console.error('Exiting after broken client request: '+clientRequestIsInvalid);
      return sg._400(req, res, {clientReq: clientRequestIsInvalid});
    }

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


