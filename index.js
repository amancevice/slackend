'use strict';
const bodyParser  = require('body-parser');
const debug       = require('debug');
const crypto      = require('crypto');
const express     = require('express');
const qs          = require('querystring');
const {WebClient} = require('@slack/client');

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
    const slack = options.slack || new WebClient(options.token);
    slack.oauth.access({
      code:          req.query.code,
      client_id:     options.client_id,
      client_secret: options.client_secret,
      redirect_uri:  options.redirect_uri,
    }).then((ret) => {
      res.locals.message = ret;
      res.locals.topic   = `${options.topic_prefix}oauth${options.topic_suffix}`;
      next();
    }).catch((err) => {
      logger.error(err);
      res.status(500).json({error: err});
    });
  };
}

function handleCallback(options = {}) {
  return (req, res, next) => {
    res.locals.message = req.body = JSON.parse(qs.parse(req.body).payload);
    res.locals.topic   = `${options.topic_prefix}callback_${res.locals.message.callback_id}${options.topic_suffix}`;
    next();
  };
}

function handleEvent(options = {}) {
  return (req, res, next) => {
    res.locals.message = req.body = JSON.parse(req.body);
    if (res.locals.message.type === 'url_verification') {
      res.json({challenge: res.locals.message.challenge});
    } else {
      res.locals.topic = `${options.topic_prefix}event_${res.locals.message.event.type}${options.topic_suffix}`;
      next();
    }
  };
}

function handleSlashCmd(options = {}) {
  return (req, res, next) => {
    res.locals.message = req.body = qs.parse(req.body);
    res.locals.topic   = `${options.topic_prefix}slash_${req.params.cmd}${options.topic_suffix}`;
    next();
  };
}

exports = module.exports = (options = {}) => {

  // Set defaults
  options.signing_version = options.signing_version || 'v0';
  options.topic_prefix    = options.topic_prefix    || '';
  options.topic_suffix    = options.topic_suffix    || '';

  // Create express router
  const app = express();

  // Configure routes
  app.use(bodyParser.text({type: '*/*'}));
  app.get('/health', (req, res) => res.json({ok: true}));
  app.get('/oauth', handleOauth(options));
  app.post('/callbacks',  verifyRequest(options), handleCallback(options));
  app.post('/events',     verifyRequest(options), handleEvent(options));
  app.post('/slash/:cmd', verifyRequest(options), handleSlashCmd(options));

  // Return routes
  return app;

};
exports.logger = logger;
