
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;

var lib = {};


//...
lib.prepForHttp = function(items) {
  if (!_.isArray(items)) {
    return lib.prepForHttp([items])[0];
  }

  return _.map(items, function(item) {
    return sg.reduce(item, {}, function(m, v, k) {
      var value = v;

      if (_.isDate(value)) {
        value = value.getTime();
      }

      return sg.kv(item, k, value);
    });
  });

  return callback();
};




_.each(lib, (value, key) => {
  exports[key] = value;
});

