'use strict';
const bodyParser = require('body-parser');
const crypto = require('crypto');
const dotenv = require('dotenv');
const express = require('express');

let env;

/**
 * Deafult ENV
 */
function defaultFetchEnv () {
  return Promise.resolve(process.env);
}

/**
 * Deafult publisher
 *
 * @param {object} payload Publish payload.
 * @param {string} topic Publish topic.
 */
function defaultPublish (payload, topic) {
  console.log(`PUBLISH ${JSON.stringify({topic: topic})}`);
  return Promise.resolve(payload);
}

/**
 * Set stringify function for JSON body.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {function} next Callback.
 */
function stringifyJSON(req, res, next) {
  res.locals.stringify = JSON.stringify;
  next();
}

/**
 * Set stringify function for querystring body.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {function} next Callback.
 */
function stringifyQueryString(req, res, next) {
  const qs = require('querystring');
  res.locals.stringify = qs.stringify;
  next();
}

/**
 * Get ENV.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {function} next Callback.
 */
function getEnv(req, res, next) {
  if (env) {
    console.log(`CACHED SECRETS`);
    next();
  } else {
    console.log(`FETCH SECRETS`);
    const fetchEnv = app.get('fetchEnv');
    fetchEnv().then((res) => {
      env = res;
      next();
    });
  }
}

/**
 * Verify request origin.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {function} next Callback.
 */
function verifyRequest (req, res, next) {
  console.log(`HEADERS ${JSON.stringify(req.headers)}`);
  console.log(`REQUEST ${JSON.stringify(req.body)}`);
  if (env.DISABLE_VERIFICATION) {
    console.warn('VERIFICATION DISABLED');
    next();
  } else {
    const signing_secret = env.SIGNING_SECRET;
    const signing_version = env.SIGNING_VERSION;
    const ts = req.headers['x-slack-request-timestamp'];
    const ret = req.headers['x-slack-signature'];
    const hmac = crypto.createHmac('sha256', signing_secret);
    const data = `${signing_version}:${ts}:${res.locals.stringify(req.body)}`;
    const exp = `${signing_version}=${hmac.update(data).digest('hex')}`;
    const delta = Math.abs(new Date()/1000 - ts);
    console.log(`SIGNATURES ${JSON.stringify({given: ret, calculated: exp})}`);
    if (delta > 60 * 5) {
      res.status(403).send({error: 'Request too old'});
    } else if (ret !== exp) {
      res.status(403).send({error: 'Signatures do not match'});
    } else {
      next();
    }
  }
}

/**
 * Get API spec. (not currently implemented)
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function getSpec (req, res) {
  res.send({});
}

/**
 * Handle GET /oauth
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function getOauth (req, res) {
  console.log(`REQUEST ${JSON.stringify(req.body)}`);
  const { WebClient } = require('@slack/client');
  const token = env.BOT_ACCESS_TOKEN;
  const client_id = env.CLIENT_ID;
  const client_secret = env.CLIENT_SECRET;
  const redirect_uri = env.REDIRECT_URI;
  const slack = new WebClient(token);
  const options = {
    code: req.query.code,
    client_id: client_id,
    client_secret: client_secret,
    redirect_uri: redirect_uri,
  };
  return slack.oauth.access(options).then((ret) => {
    console.log(`AUTH ${JSON.stringify(ret)}`);
    const redirect = env.OAUTH_REDIRECT || `https://slack.com/app_redirect?team=${ret.team_id}`;
    const topic = `${env.PUBLISHER_PREFIX}oauth`;
    const publish = app.get('publish');
    publish(ret, topic).then((ret) => {
      res.redirect(redirect);
    }).catch((err) => {
      res.status(500).send({error: err});
    });
  });
}

/**
 * Handle POST /callbacks
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {object} next Express callback.
 */
function postCallback (req, res, next) {
  req.body = JSON.parse(req.body.payload);
  res.locals.topic = `callback_${req.body.callback_id}`;
  next();
}

/**
 * Handle POST /events
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {object} next Express callback.
 */
function postEvent (req, res, next) {
  if (req.body.type === 'url_verification') {
    const challenge = {challenge: req.body.challenge};
    console.log(`CHALLENGE ${JSON.stringify(challenge)}`);
    res.send(challenge);
  } else {
    res.locals.topic = `event_${req.body.event.type}`;
    next();
  }
}

/**
 * Handle POST /slash/:cmd
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {object} next Express callback.
 */
function postSlashCmd (req, res, next) {
  res.locals.topic = `slash_${req.params.cmd}`;
  next();
}

/**
 * Publish request.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function publishBody (req, res) {
  const topic = `${env.PUBLISHER_PREFIX}${res.locals.topic}`;
  const publish = app.get('publish');
  publish(req.body, topic).then((ret) => {
    console.log(`PUBLISHED ${JSON.stringify(ret)}`);
    res.status(204).send();
  }).catch((err) => {
    res.status(400).send(err);
  });
}

const app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.set('fetchEnv', defaultFetchEnv);
app.set('publish', defaultPublish);
app.get('/', getSpec);
app.get('/oauth', getEnv, getOauth);
app.post('/callbacks', getEnv, stringifyQueryString, verifyRequest, postCallback, publishBody);
app.post('/events', getEnv, stringifyJSON, verifyRequest, postEvent, publishBody);
app.post('/slash/:cmd', getEnv, stringifyQueryString, verifyRequest, postSlashCmd, publishBody);
dotenv.config();

module.exports = app;
