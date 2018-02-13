
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

const myUpload                = require('./routes/upload');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const unhandled               = unhandledRoutes.unhandled;

const packageName             = 'ntl';

const main = function() {

  var   ip          = ARGV.ip       || '127.0.0.1';
  const port        = ARGV.port;

  if (!port) {
    console.log('Need --port=');
    process.exit(2);
  }

  // What did the routes sign me up for?
  const routeNames  = _.keys(myUpload);
  const urlRoutes   = _.map(routeNames, n => `/${packageName}/${n}`);

  const router = Router();

  var handlers = {};

  _.each(myUpload, function(fn, name) {
    handlers[name] = {
      fn        : fn,
      urlRoute  : `/ntl/${name}`
    };
  });

  _.each(handlers, function(handler, name) {
    router.addRoute(handler.urlRoute, handler.fn);
  });

  // Start the server

  return sg.__run([function(next) {
    return request.get('http://169.254.169.254/latest/meta-data/local-ipv4').end((err, result) => {
      console.log(err, result.text, result.ok, result.body);
      if (sg.ok(err, result, result.text)) {
        ip = result.text;
      }
      return next();
    });
  }, function(next) {
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

    server.listen(port, ip, function() {
      console.log(`Listening on ${ip}:${port}`);
      next();

      tell();
      function tell() {
        setTimeout(tell, 15 * 1000);
        redisUtils.tellService(`/${packageName}`, `http://${ip}:${port}`, 30, function(err) {
          redisUtils.tellService(`/${packageName}/xapi/v1`, `http://${ip}:${port}`, 30, function(err) {
          });
        });
      };
    });

  }], function done() {
  });
};





main();

