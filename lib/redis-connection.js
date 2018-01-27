
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
lib.myFavoriteFunction = function(argv, context, callback) {
  return callback();
};




_.each(lib, (value, key) => {
  exports[key] = value;
});

