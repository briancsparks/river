
/**
 *  The feeder class implementation file.
 *
 *  Feeder is the class that you use to feed a data river from one place to another.
 *  Essentially, it wraps the Redis calls.
 */
const sg                      = require('sgsg');
const _                       = sg._;
const raLib                   = sg.include('run-anywhere') || require('run-anywhere');
const redisLib                = require('redis');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';

const redis                   = redisLib.createClient(redisPort, redisHost);

var lib = {};

var DataSet = function(options_, optionsForResponse_) {
  var self = this;

  const options             = sg.deepCopy(options_ || {})
  const optionsForResponse  = sg.deepCopy(optionsForResponse_ || {});

  self.items = [];
  self.keys  = [];

  self.itemsMap       = {};
  self.itemsMapCommon = {};

  self.srcKey = '';
  self.destKey = '';
  self.requestId = '';

  if (options.srcKey)                  { self.srcKey     = options.srcKey; }

  if (optionsForResponse.destKey)      { self.destKey    = optionsForResponse.destKey; }
  if (optionsForResponse.requestId)    { self.requestId  = optionsForResponse.requestId; }

  self.pushItem = function(a, b) {
    var item = a, key = b;

    if (_.isString(a)) {
      return self.pushItems(a, [b]);
    }

    self.items.push(item);
    if (key) {
      self.keys.push(item);
    }
  };

  var pushIntoMap = function(name, blob_) {
    if (_.isArray(blob_)) {
      return pushIntoMap(name, {items:blob_});
    }

    var   blob  = _.extend({}, blob_);
    const items = blob.items || blob.payload || [];

    delete blob.items;
    delete blob.payload;

    self.itemsMap[name]       = (self.itemsMap[name] || []).concat(items);
    self.itemsMapCommon[name] = sg.reduce(blob, self.itemsMapCommon[name] || {}, (m, v, k) => {
      if (_.isString(v)) {
        return sg.kv(m, k, sg.kv(m[k], v, v));
      }
      return sg.kv(m, k, v);
    });
  };

  self.pushItems = function(a, b) {
    var name = a, items = b;

    if (!_.isString(a)) {
      name  = null;
      items = a;
    }

    //console.log(`pushing ${a} (${name}); ${items.length}`, {items});
    if (name) {
      pushIntoMap(name, items);
    } else {
      self.items = self.items.concat(items);
    }

  };

  const prepData = function() {
    var result = {};

    var itemsMap = {__just: {items: self.items}};
    var count    = self.items.length;

    if (sg.numKeys(self.itemsMap) > 0) {
      itemsMap = self.itemsMap;
    }

    result = sg.reduce(itemsMap, {}, (m, items, k) => {
      count += items.length || 0;

      const value = sg.reduce(self.itemsMapCommon[k], {items}, (m, v, k) => {
        if (sg.isObject(v) && sg.numKeys(v) !== 1) {
          console.error(`Found non-conforming element: ${k}`, v);
        }
        return sg.kv(m, k, sg.firstKey(v));
      });

      return sg.kv(m, k, value);
    });

    if ('__just' in result) {
      result = result.__just;
    }

    return {data:result, count};
  };

  self.sendTo = function(destKey_, requestId_, callback_) {
    if (arguments.length === 1) {
      return self.sendTo(null, null, arguments[0]);
    } else if (arguments.length === 2) {
      return self.sendTo(destKey_, null, arguments[1]);
    }

    const destKey   = destKey_    || self.destKey;
    const requestId = requestId_  || self.requestId;
    const callback  = callback_   || function(){};

    // TODO: If self.keys is not empty, must sort the data

    // Wrap the data in a name, if requested
    var { data, count } = prepData();

    if (requestId) {
      data = {[requestId] : data};
    }

    // Push the data to Redis
    console.log(`LPUSHing ${count} items to ${destKey}`);
    return redis.lpush(`river:feed:${destKey}`, JSON.stringify([optionsForResponse, data]), function(err, receipt) {
      return callback.apply(this, arguments);
    });
  };

  if (options) {
    if (options.items) {
      if (options.name) {
        self.pushItems(options.name, options.items);
      } else {
        self.pushItems(options.items);
      }
    }
  }
};
lib.DataSet = DataSet;




_.each(lib, (value, key) => {
  exports[key] = value;
});

