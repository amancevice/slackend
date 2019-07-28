'use strict';
const bodyParser  = require('body-parser');
const debug       = require('debug');
const crypto      = require('crypto');
const express     = require('express');
const qs          = require('querystring');
const {WebClient} = require('@slack/web-api');

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

function handleOAuth(options = {}) {
  return (req, res, next) => {
    const slack = options.slack || new WebClient(options.token);
    slack.oauth.access({
      code:          req.query.code,
      client_id:     options.client_id,
      client_secret: options.client_secret,
      redirect_uri:  options.redirect_uri,
    }).then((ret) => {
      res.locals.slack = {
        id:      req.query.code,
        message: ret,
        type:    'oauth',
      };
      next();
    }).catch((err) => {
      logger.error(err);
      if (options.oauth_error_uri) {
        res.redirect(options.oauth_error_uri);
      } else {
        res.status(403).json({error: err});
      }
    });
  };
}

function handleCallback(options = {}) {
  return (req, res, next) => {
    req.body = JSON.parse(qs.parse(req.body).payload);
    res.locals.slack = {
      id:      req.body.callback_id,
      message: req.body,
      type:    'callback',
    };
    next();
  };
}

function handleEvent(options = {}) {
  return (req, res, next) => {
    req.body = JSON.parse(req.body);
    if (req.body.type === 'url_verification') {
      res.json({challenge: req.body.challenge});
    } else {
      res.locals.slack = {
        id:      req.body.event.type,
        message: req.body,
        type:    'event',
      };
      next();
    }
  };
}

function handleSlashCmd(options = {}) {
  return (req, res, next) => {
    req.body = qs.parse(req.body);
    res.locals.slack = {
      id:      req.params.cmd,
      message: req.body,
      type:    'slash'
    };
    next();
  };
}

exports = module.exports = (options = {}) => {

  // Set defaults
  options.client_id          = options.client_id          || process.env.SLACK_CLIENT_ID;
  options.client_secret      = options.client_secret      || process.env.SLACK_CLIENT_SECRET;
  options.oauth_error_uri    = options.oauth_error_uri    || process.env.SLACK_OAUTH_ERROR_URI;
  options.oauth_redirect_uri = options.oauth_redirect_uri || process.env.SLACK_OAUTH_REDIRECT_URI;
  options.oauth_success_uri  = options.oauth_success_uri  || process.env.SLACK_OAUTH_SUCCESS_URI;
  options.signing_secret     = options.signing_secret     || process.env.SLACK_SIGNING_SECRET;
  options.signing_version    = options.signing_version    || process.env.SLACK_SIGNING_VERSION;
  options.token              = options.token              || process.env.SLACK_TOKEN;

  // Create express router
  const app = express();

  // Configure routes
  app.use(bodyParser.text({type: '*/*'}));
  app.get('/health', (req, res) => res.json({ok: true}));
  app.get('/oauth', handleOAuth(options));
  app.post('/callbacks',  verifyRequest(options), handleCallback(options));
  app.post('/events',     verifyRequest(options), handleEvent(options));
  app.post('/slash/:cmd', verifyRequest(options), handleSlashCmd(options));

  // Return routes
  return app;

};
exports.logger = logger;
