'use strict';
const bodyParser = require('body-parser');
const debug      = require('debug');
const crypto     = require('crypto');
const express    = require('express');
const qs         = require('querystring');
const slack      = require('@slack/client');

const logger = {
  debug: debug('slackend:debug'),
  info:  debug('slackend:info'),
  warn:  debug('slackend:warn'),
  error: debug('slackend:error'),
};

function verifyRequest(options = {}) {
  return (req, res, next) => {
    logger.debug(`HEADERS ${JSON.stringify(req.headers)}`);
    logger.debug(`BODY ${JSON.stringify(req.body)}`);
    if (process.env.DISABLE_VERIFICATION) {
      logger.warn('VERIFICATION DISABLED - ENV');
      next();
    } else if (options.signing_secret === undefined) {
      logger.warn('VERIFICATION DISABLED - NO SIGNING SECRET');
      next();
    } else {
      const ts    = req.headers['x-slack-request-timestamp'];
      const ret   = req.headers['x-slack-signature'];
      const hmac  = crypto.createHmac('sha256', options.signing_secret);
      const data  = `${options.signing_version}:${ts}:${req.body}`;
      const exp   = `${options.signing_version}=${hmac.update(data).digest('hex')}`;
      const delta = Math.abs(new Date() / 1000 - ts);
      logger.debug(`SIGNING DATA ${data}`);
      logger.debug(`SIGNATURES ${JSON.stringify({given: ret, calculated: exp})}`);
      if (delta > 60 * 5) {
        logger.error('Request too old');
        res.status(403).json({error: 'Request too old'});
      } else if (ret !== exp) {
        logger.error('Signatures do not match');
        res.status(403).json({error: 'Signatures do not match'});
      } else {
        next();
      }
    }
  };
}

function handleOauth(options = {}) {
  return (req, res, next) => {
    const slackapi = options.slackapi || new slack.WebClient(options.token);
    slackapi.oauth.access({
      code:          req.query.code,
      client_id:     options.client_id,
      client_secret: options.client_secret,
      redirect_uri:  options.redirect_uri,
    }).then((ret) => {
      res.locals.message = ret;
      res.locals.topic   = `oauth`;
      next();
    }).catch((err) => {
      logger.error(err);
      res.status(500).json({error: err});
    });
  };
}

function handleCallback(req, res, next) {
  res.locals.message = req.body = JSON.parse(qs.parse(req.body).payload);
  res.locals.topic   = `callback_${res.locals.message.callback_id}`;
  next();
};

function handleEvent(req, res, next) {
  res.locals.message = req.body = JSON.parse(req.body);
  if (res.locals.message.type === 'url_verification') {
    res.json({challenge: res.locals.message.challenge});
  } else {
    res.locals.topic = `event_${res.locals.message.event.type}`;
    next();
  }
};

function handleSlashCmd(req, res, next) {
  res.locals.message = req.body = qs.parse(req.body);
  res.locals.topic   = `slash_${req.params.cmd}`;
  next();
};

exports = module.exports = (options = {}) => {

  // Set defaults
  options.signing_version = options.signing_version || 'v0';

  // Create express router
  const app = express();

  // Configure routes
  app.use(bodyParser.text({type: '*/*'}));
  app.get('/oauth', handleOauth(options));
  app.post('/callbacks',  verifyRequest(options), handleCallback);
  app.post('/events',     verifyRequest(options), handleEvent);
  app.post('/slash/:cmd', verifyRequest(options), handleSlashCmd);

  // Return routes
  return app;

};
exports.logger = logger;
