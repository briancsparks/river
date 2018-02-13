
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
lib.normalizeBody = function(body, params, query) {

  var payload, clientId, sessionId, projectId, partnerId, username, version;

  // First, throw it all together
  var all         = sg.extend(body || {}, params || {}, query ||{});
  var meta        = all.meta || {};

  // Pick out parts
  payload     = sg.extract(all,    'items')       || payload;
  payload     = sg.extract(all,    'payload')     || payload;

  clientId    = sg.extract(all,    'client');
  clientId    = sg.extract(all,    'uid')         || clientId;
  clientId    = sg.extract(all,    'clientId')    || clientId;
  clientId    = sg.extract(meta,   'uid')         || clientId;
  clientId    = sg.extract(meta,   'clientId')    || clientId;

  sessionId   = sg.extract(all,    'session');
  sessionId   = sg.extract(all,    'sessionId')   || sessionId;
  sessionId   = sg.extract(meta,   'sessionId')   || sessionId;

  projectId   = sg.extract(all,    'project');
  projectId   = sg.extract(all,    'projectId')   || projectId;
  projectId   = sg.extract(meta,   'projectId')   || projectId;

  partnerId   = sg.extract(all,    'provider');
  partnerId   = sg.extract(all,    'providerId')  || partnerId;
  partnerId   = sg.extract(meta,   'providerId')  || partnerId;
  partnerId   = sg.extract(all,    'partner')     || partnerId;
  partnerId   = sg.extract(all,    'partnerId')   || partnerId;
  partnerId   = sg.extract(meta,   'partnerId')   || partnerId;

  username    = sg.extract(all,    'username');
  username    = sg.extract(meta,   'username')    || username;

  version     = sg.extract(all,    'v');
  version     = sg.extract(all,    'version')     || version;
  version     = sg.extract(meta,   'version')     || version;

  var result      = {};

  setOnn(result,  'clientId',    clientId);
  setOnn(result,  'sessionId',   sessionId);
  setOnn(result,  'projectId',   projectId);
  setOnn(result,  'partnerId',   partnerId);
  setOnn(result,  'username',    username);
  setOnn(result,  'version',     version);
  setOnn(result,  'payload',     payload);

  return result;
};




_.each(lib, (value, key) => {
  exports[key] = value;
});

