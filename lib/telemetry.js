
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

  // If we do not have clientId, we may be able to determine it from sessionId
  if (!clientId) {
    if (sessionId.match(/^[a-z0-9_]+-[0-9]+$/i)) {        // alnum-numbers
      clientId = sessionId.split('-')[0];
    }
  }

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

/**
 *  What is the bucket name?
 *
 *  (They are different for the different accounts.)
 *
 */
lib.bucketName = function() {
  if (sg.isProduction()) {
    return 'sa-telemetry-netlab-asis-prod';
  }
  return 'sa-telemetry-netlab-asis-test';
}

/**
 *  Computes the `Key` part of an s3 Bucket/Key pair.
 */
lib.s3Key = function(clientId, sessionId) {
  var   key = [];

  if (!clientId || sessionId.startsWith(clientId)) {
    key = sessionId.split('-');
  } else {
    key = `${clientId}-${sessionId}`.split('-');
  }

  // Add first-3 as root
  key.unshift(key[0].substr(0,3));

  return key.join('/');
}




_.each(lib, (value, key) => {
  exports[key] = value;
});

