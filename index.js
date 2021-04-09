"use strict";

// stdlib
const crypto = require("crypto");
const qs = require("querystring");

// node_modules
const bodyParser = require("body-parser");
const debug = require("debug");
const express = require("express");
const { WebClient } = require("@slack/web-api");

const logger = {
  debug: debug(process.env.SLACKEND_DEBUG || "slackend:debug"),
  info: debug(process.env.SLACKEND_INFO || "slackend:info"),
  warn: debug(process.env.SLACKEND_WARN || "slackend:warn"),
  error: debug(process.env.SLACKEND_ERROR || "slackend:error"),
};

function calculateSignature(req, options = {}) {
  const ts = req.headers["x-slack-request-timestamp"];
  const given = req.headers["x-slack-signature"];
  const hmac = crypto.createHmac("sha256", options.signing_secret);
  const data = `${options.signing_version}:${ts}:${req.body}`;
  const signature = hmac.update(data).digest("hex");
  const computed = `${options.signing_version}=${signature}`;
  const delta = Math.abs(new Date() / 1000 - ts);
  const res = { given: given, computed: computed, delta: delta };
  logger.debug(`SIGNING DATA ${data}`);
  logger.debug(`SIGNATURES ${JSON.stringify(res)}`);
  return res;
}

function getOptions(options = {}) {
  return {
    client_id: process.env.SLACK_CLIENT_ID,
    client_secret: process.env.SLACK_CLIENT_SECRET,
    disable_verification: process.env.SLACK_DISABLE_VERIFICATION,
    oauth_install_uri: process.env.SLACK_OAUTH_INSTALL_URI,
    oauth_error_uri: process.env.SLACK_OAUTH_ERROR_URI,
    oauth_redirect_uri: process.env.SLACK_OAUTH_REDIRECT_URI,
    oauth_success_uri: process.env.SLACK_OAUTH_SUCCESS_URI,
    signing_secret: process.env.SLACK_SIGNING_SECRET,
    signing_version: process.env.SLACK_SIGNING_VERSION,
    token: process.env.SLACK_TOKEN,
    ...options,
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
      return res.redirect(options.oauth_error_uri);
    }

    // Set up OAuth
    const slack = options.slack || new WebClient(options.token);
    const oauth = version ? slack.oauth[version] : slack.oauth;
    const payload = {
      code: req.query.code,
      client_id: options.client_id,
      client_secret: options.client_secret,
      redirect_uri: options.redirect_uri,
    };
    const finish = (ret) => {
      res.locals.slack = ret;
      next();
    };
    const error = (err) => {
      logger.error(err);
      if (options.oauth_error_uri) {
        logger.warn(`RESPONSE [302] ${options.oauth_error_uri}`);
        res.redirect(options.oauth_error_uri);
      } else {
        logger.error("RESPONSE [403]");
        res.status(403).json({ error: err });
      }
    };

    // Fetch token and finish (or error)
    oauth.access(payload).then(finish).catch(error);
  };
}

function handleCallback(options = {}) {
  return (req, res, next) => {
    res.locals.slack = JSON.parse(qs.parse(req.body).payload);
    next();
  };
}

function handleEvent(options = {}) {
  return (req, res, next) => {
    res.locals.slack = JSON.parse(req.body);
    if (res.locals.slack.type === "url_verification") {
      logger.info(`RESPONSE [200] ${res.locals.slack.challenge}`);
      res.json({ challenge: res.locals.slack.challenge });
    } else {
      next();
    }
  };
}

function handleSlashCmd(options = {}) {
  return (req, res, next) => {
    res.locals.slack = qs.parse(req.body);
    next();
  };
}

function logSlackMsg(req, res, next) {
  logger.debug(`SLACK MESSAGE ${JSON.stringify(res.locals.slack)}`);
  next();
}

function verifyRequest(options = {}) {
  return (req, res, next) => {
    logger.debug(`HEADERS ${JSON.stringify(req.headers)}`);
    logger.debug(`BODY ${JSON.stringify(req.body)}`);
    if (options.disable_verification) {
      logger.warn("VERIFICATION DISABLED - ENV");
      next();
    } else if (options.signing_secret === undefined) {
      logger.warn("VERIFICATION DISABLED - NO SIGNING SECRET");
      next();
    } else {
      const sign = calculateSignature(req, options);
      if (sign.delta > 60 * 5) {
        logger.error("RESPONSE [403] Request too old");
        res.status(403).json({ error: "Request too old" });
      } else if (sign.given !== sign.computed) {
        logger.error("RESPONSE [403] Signatures do not match");
        res.status(403).json({ error: "Signatures do not match" });
      } else {
        next();
      }
    }
  };
}

const app = (options = {}) => {
  // Set opts with defaults
  const opts = getOptions(options);

  // Create express router & callbacks
  const app = express(),
    doCallback = handleCallback(opts),
    doEvent = handleEvent(opts),
    doInstall = handleInstall(opts),
    doOAuth = handleOAuth(opts),
    doOAuthV2 = handleOAuth(opts, "v2"),
    doSlash = handleSlashCmd(opts),
    doVerify = verifyRequest(opts);

  // Configure routes
  app.use(bodyParser.text({ type: "*/*" }));
  app.get("/health", (req, res) => res.json({ ok: true }));
  app.get("/install", doInstall);
  app.get("/oauth", doOAuth, logSlackMsg);
  app.get("/oauth/v2", doOAuthV2, logSlackMsg);
  app.post("/callbacks", doVerify, doCallback, logSlackMsg);
  app.post("/events", doVerify, doEvent, logSlackMsg);
  app.post("/slash/:cmd", doVerify, doSlash, logSlackMsg);

  // Return routes
  return app;
};

module.exports = app;
module.exports.logger = logger;
