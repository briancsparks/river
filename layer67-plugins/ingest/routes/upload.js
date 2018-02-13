
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
lib.upload = function(req, res, params, splats, query) {
  console.log(req.url, req.headers, params, splats, query);
  return sg._200(req, res, {});
};




_.each(lib, (value, key) => {
  exports[key] = value;
});

