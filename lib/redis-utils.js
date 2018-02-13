
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const { StringDecoder }       = require('string_decoder');
const redisLib                = require('redis');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const redis                   = redisLib.createClient(redisPort, redisHost);

var   hourHasBeenComputed     = false;
var   hour;

var lib = {};

lib.tellService = function(name, location, ttl, callback) {

  // Get the IP from location
  const m = /([0-9]+[.][0-9]+[.][0-9]+[.][0-9]+)/.exec(location);

  const ip            = (m || [])[1] || 'notanip';
  const serviceName   = `service:${name}:${lib.getHour()}`;
  const providerKey   = `${serviceName}:${ip}`;

  return redis.psetex(providerKey, ttl, location, function(err, res) {
    return redis.sadd(serviceName, providerKey, function(err, res) {
      return redis.expire(serviceName, 60, function(err, res) {
        return callback.apply(this, arguments);
      });
    });
  });
};

const maintainTime = function() {
  // First, schedule next maintenance
  setTimeout(maintainTime, 1000*30);
  hourHasBeenComputed = false;
};
maintainTime();


lib.getHour = function() {
  if (hourHasBeenComputed) {
    return hour;
  }
  return (hour = ("0" + new Date().getUTCHours()).slice(-2));
}

_.each(lib, (value, key) => {
  exports[key] = value;
});

