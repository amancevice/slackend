'use strict';

// stdlib
const crypto = require('crypto');
const qs     = require('querystring');

// node_modules
const bodyParser  = require('body-parser');
const debug       = require('debug');
const express     = require('express');
const {WebClient} = require('@slack/web-api');

const logger = {
  debug: debug('slackend:debug'),
  info:  debug('slackend:info'),
  warn:  debug('slackend:warn'),
  error: debug('slackend:error'),
};

function calculateSignature(req, options = {}) {
  const ts       = req.headers['x-slack-request-timestamp'];
  const given    = req.headers['x-slack-signature'];
  const hmac     = crypto.createHmac('sha256', options.signing_secret);
  const data     = `${options.signing_version}:${ts}:${req.body}`;
  const computed = `${options.signing_version}=${hmac.update(data).digest('hex')}`;
  const delta    = Math.abs(new Date() / 1000 - ts);
  const res      = {
    given:    given,
    computed: computed,
    delta:    delta,
  };
  logger.debug(`SIGNING DATA ${data}`);
  logger.debug(`SIGNATURES ${JSON.stringify(res)}`);
  return res;
}

function verifyRequest(options = {}) {
  return (req, res, next) => {
    logger.debug(`HEADERS ${JSON.stringify(req.headers)}`);
    logger.debug(`BODY ${JSON.stringify(req.body)}`);
    if (options.disable_verification) {
      logger.warn('VERIFICATION DISABLED - ENV');
      next();
    } else if (options.signing_secret === undefined) {
      logger.warn('VERIFICATION DISABLED - NO SIGNING SECRET');
      next();
    } else {
      const sign = calculateSignature(req, options);
      if (sign.delta > 60 * 5) {
        logger.error('RESPONSE [403] Request too old');
        res.status(403).json({error: 'Request too old'});
      } else if (sign.given !== sign.computed) {
        logger.error('RESPONSE [403] Signatures do not match');
        res.status(403).json({error: 'Signatures do not match'});
      } else {
        next();
      }
    }
  };
}

function handleInstall(options = {}) {
  return (req, res) => {
    logger.info(`RESPONSE [302] ${options.oauth_install_uri}`);
    res.redirect(options.oauth_install_uri);
  };
}

function handleOAuth(options = {}, version = null) {
  return (req, res, next) => {
    // Handle denials
    if (req.query.error) {
      logger.error(req.query.error);
      logger.warn(`RESPONSE [302] ${options.oauth_error_uri}`);
      res.redirect(options.oauth_error_uri);
    }

    // Handle OAuth
    else {
      const slack = options.slack || new WebClient(options.token);
      const oauth = version ? slack.oauth[version] : slack.oauth;
      oauth.access({
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
          logger.warn(`RESPONSE [302] ${options.oauth_error_uri}`);
          res.redirect(options.oauth_error_uri);
        } else {
          logger.error('RESPONSE [403]');
          res.status(403).json({error: err});
        }
      });
    }
  };
}

function handleCallback(options = {}) {
  return (req, res, next) => {
    req.body = JSON.parse(qs.parse(req.body).payload);
    res.locals.slack = {
      id:          req.body.type,
      message:     req.body,
      type:        'callback',
    };
    if (req.body.type === 'view_submission') {
      res.locals.slack.callback_id = req.body.view.callback_id;
    } else if (req.body.type === 'block_actions') {
      res.locals.slack.action_ids = req.body.actions.map((x) => x.action_id);
    } else {
      res.locals.slack.callback_id = req.body.callback_id;
    }

    next();
  };
}

function handleEvent(options = {}) {
  return (req, res, next) => {
    req.body = JSON.parse(req.body);
    if (req.body.type === 'url_verification') {
      logger.info(`RESPONSE [200] ${req.body.challenge}`);
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

function logSlackMsg(req, res, next) {
  logger.debug(`SLACK MESSAGE ${JSON.stringify(res.locals.slack)}`);
  next();
}

const app = (options = {}) => {

  // Set defaults
  options.client_id            = options.client_id            || process.env.SLACK_CLIENT_ID;
  options.client_secret        = options.client_secret        || process.env.SLACK_CLIENT_SECRET;
  options.disable_verification = options.disable_verification || process.env.SLACK_DISABLE_VERIFICATION;
  options.oauth_install_uri    = options.oauth_install_uri    || process.env.SLACK_OAUTH_INSTALL_URI;
  options.oauth_error_uri      = options.oauth_error_uri      || process.env.SLACK_OAUTH_ERROR_URI;
  options.oauth_redirect_uri   = options.oauth_redirect_uri   || process.env.SLACK_OAUTH_REDIRECT_URI;
  options.oauth_success_uri    = options.oauth_success_uri    || process.env.SLACK_OAUTH_SUCCESS_URI;
  options.signing_secret       = options.signing_secret       || process.env.SLACK_SIGNING_SECRET;
  options.signing_version      = options.signing_version      || process.env.SLACK_SIGNING_VERSION;
  options.token                = options.token                || process.env.SLACK_TOKEN;

  // Create express router
  const app = express();

  // Configure routes
  app.use(bodyParser.text({type: '*/*'}));
  app.get('/health', (req, res) => res.json({ok: true}));
  app.get('/install',  handleInstall(options));
  app.get('/oauth',    handleOAuth(options),       logSlackMsg);
  app.get('/oauth/v2', handleOAuth(options, 'v2'), logSlackMsg);
  app.post('/callbacks',  verifyRequest(options), handleCallback(options), logSlackMsg);
  app.post('/events',     verifyRequest(options), handleEvent(options),    logSlackMsg);
  app.post('/slash/:cmd', verifyRequest(options), handleSlashCmd(options), logSlackMsg);

  // Return routes
  return app;

};

module.exports = app;
module.exports.logger = logger;
