
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const AWS                     = require('aws-sdk');
const telemetryLib            = require('../../../lib/telemetry');
const path                    = require('path');
const crypto                  = require('crypto');
const formidable              = require('formidable');
const redisLib                = require('redis');

const ARGV                    = sg.ARGV();
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const redisPort               = argvGet(ARGV, 'redis-port')             || 6379;
const redisHost               = argvGet(ARGV, 'redis-host')             || 'redis';
const s3Key                   = telemetryLib.s3Key;

const redis                   = redisLib.createClient(redisPort, redisHost);

const uploadDir               = path.join('/tmp', 'river', 'upload');

const s3                      = new AWS.S3();

var lib = {};

/**
 *  Quickly ingests the JSON.
 */
lib.ingest = function(req, res, params, splats, query) {
  // console.log(req.url, req.headers, params, splats, query);

  return sg.getBody(req, function(err) {
    if (!sg.ok(err))  { return sg._400(req, res); }

    var   msg         = req.url;
    var   result      = {};
    const Bucket      = telemetryLib.bucketName();
    var   body        = telemetryLib.normalizeBody(req.bodyJson || {}, params || {}, query || {});

    body.payload      = body.payload || [];

    if (!body.sessionId) {
      return sg._400(req, res, {ok:false}, 'Must provide sessionId');
    }

    if (req.headers['x-real-ip']) {
      body = sg._extend({x_real_ip: req.headers['x-real-ip']}, body);
    }

    const telemetry   = JSON.stringify(body);
    const clientId    = body.clientId;
    const dataType    = body.dataType   || 'telemetry';

    const s3Params    = s3PutObjectParams(clientId, body.sessionId, dataType, Bucket, telemetry);
    return s3.putObject(s3Params, function(err, data) {
      if (!sg.ok(err, data))    { return sg._500(req, res, err, 'Failed to s3.putObject'); }

      // Delay and push to Redis (feed) -- redis-cli LPUSH river:feed:asdf '{"payload":[{"a":42}]}'
      sg.setTimeout(10, function() {

        // The Redis keys are generated from the client IDs
        const signalName   = `river:feedsignal:${clientId}`;

        return redis.smembers(signalName, (err, destKeys) => {
          if (!sg.ok(err, destKeys))   { return; }

          return sg.__each(destKeys, (destKey) => {
            return redis.lpush(destKey, s3Params.Body, function(err, receipt) {
              //console.log('LPUSH ', signalName, destKey, err, receipt);
              console.log(msg, 'LPUSH ', signalName, destKey);
            });
          }, function done() {
          });
        });
      });

      console.log(msg+' OK, '+body.payload.length+' items');
      return sg._200(req, res, {ok:true, count: body.payload.length});
    });
  });
};


//-------------------------------------------------------------------------------------------------
/**
 *  Handles uploaded binary files.
 *
 *    /ingestBlob
 *
 */
lib.ingestBlob = function(req, res, params, splats, query) {
  var   result = {};
  var   code, msg;

  var   form = new formidable.IncomingForm();

  form.keepExtensions = true;
  form.uploadDir      = uploadDir;

  // ---------- On:progress ----------
  form.on('progress', (recd, expected) => {
  });

  // ---------- On:file ----------
  form.on('file', (name, file) => {
  });

  // ---------- parse ----------
  form.parse(req, (err, fields_, files) => {
    // fs.unlink, fs.rmdir

    var fields, body;
    if (sg.ok(err, fields_, files)) {
      console.log(`uploaded`, fields_, _.map(files,(f,k) => {return sg.kv(k,f.name); }));

      // Fields is the payload, but might have the key attributes
      fields          = telemetryLib.normalizeBody(fields_ || {}, {}, {});

      // Restore the payload field -- probably undefined, but forcibly added by normalizeBody
      fields.payload  = fields_.payload;

      body            = telemetryLib.normalizeBody(fields || {}, params || {}, query || {});

      if (!body.sessionId) {
        code = 400;
        msg  = `Must provide sessionId`;
        return;
      }

      const Bucket   = telemetryLib.bucketName();
      if (!Bucket) {
        code = 404;
        msg  = `No bucket for ${body.projectId}`;
        return;
      }

      var item = sg.extend(body.payload.shift(), _.omit(fields, 'clientId,sessionId,projectId,version'.split(',')));
      sg.__each(files, (file, nextFile, key) => {
        const s3Params = s3PutObjectParamsFile(body.clientId, body.sessionId, Bucket, file.path, file.name);

        return s3.putObject(s3Params, (err, data) => {
          console.log(`uploadedBlob ${file.name} (${file.size} bytes) to ${Bucket} ${shortenKey(s3Params.Key)}`, err, data);
          item = sg.kv(item, key, file.name);
          return nextFile();
        });

      }, function() {

        body.payload.unshift(item);

        // Add a JSON object to reference the uploaded
        const s3Params  = s3PutObjectParams(body.clientId, body.sessionId, 'telemetry', Bucket, JSON.stringify(body));
        return s3.putObject(s3Params, (err, data) => {
          console.log(`telemetry added ${body.payload.length} to S3 (${shortenKey(s3Params.Key)}):`, err, data);
        });
      });
    }

  });

  // ---------- On:end ----------
  form.on('end', () => {
    code      = code || 200;
    result.ok = (code >= 200 && code < 400);
    serverassist['_'+code](req, res, result, msg);
  });

  // ---------- On:error ----------
  form.on('error', (err) => {
  });

  // ---------- On:aborted ----------
  form.on('aborted', () => {
  });


};


_.each(lib, (value, key) => {
  exports[key] = value;
});

///**
// *  What is the bucket name?
// *
// *  (They are different for the different accounts.)
// *
// */
//function bucketName() {
//  if (sg.isProduction()) {
//    return 'sa-telemetry-netlab-asis-prod';
//  }
//  return 'sa-telemetry-netlab-asis-test';
//}
//
///**
// *  Computes the `Key` part of an s3 Bucket/Key pair.
// */
//function s3Key(clientId, sessionId) {
//  var   key = [];
//
//  if (sessionId.startsWith(clientId)) {
//    key = sessionId.split('-');
//  } else {
//    key = `${clientId}-${sessionId}`.split('-');
//  }
//
//  // Add first-3 as root
//  key.unshift(key[0].substr(0,3));
//
//  return key.join('/');
//}

/**
 *  Returns the Content-Type.
 *
 *  Returns `guess` to allow the caller to guess, unless the guess isnt(),
 *  or is octet-stream.
 */
function educatedGuessContentType(guess, filename) {
  var ct = guess;

  // Someone else just defaulted to octet-stream?
  if (!ct || ct === 'application/octet-stream') {
    ct = sg.mimeType(filename) || ct;
  }

  return ct || 'application/octet-stream';
};

/**
 *  Returns the `params` input object for the s3.putObject() API, for 'any' file type.
 *
 */
function s3PutObjectParamsFile(clientId, sessionId, Bucket, tmpBlobFilename, filename, options_) {

  const options       = options_                    || {};
  const basename      = path.basename(filename);

  const contentType   = educatedGuessContentType(options.contentType, filename);
  const keyDir        = s3Key(clientId, sessionId);
  const Key           = [keyDir, basename].join('/');

  const params        = {
    Body        : fs.createReadStream(tmpBlobFilename),
    Bucket,
    Key,
    ContentType :  contentType
  };

  return params;
}

/**
 *  Returns the `params` input object for the s3.putObject() API, for a JSON file.
 */
function s3PutObjectParams(clientId, sessionId, dataType, Bucket, payload) {

  const Body      = _.isString(payload) ? payload : JSON.stringify(payload);
  const keyDir    = s3Key(clientId, sessionId);
  var   shasum    = crypto.createHash('sha1');

  shasum.update(Body);

  const Key       = [keyDir, dataType, shasum.digest('hex')].join('/') + '.json';
  const params    = {
    Body,
    Bucket,
    Key,
    ContentType:  'application/json'
  };

  return params;
}

