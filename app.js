'use strict'
const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');

require('dotenv').config();
const oauth_redirect = process.env.OAUTH_REDIRECT;
const redirect_uri = process.env.REDIRECT_URI;
const secret = process.env.SECRET;
const sns_topic_prefix = process.env.SNS_TOPIC_PREFIX;

const app = express();
const SNS = new AWS.SNS();

let secrets;

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

/**
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {function} next Callback.
 */
function getSecrets(req, res, next) {
  if (secrets) {
    console.log(`CACHED ${secret}`);
    next();
  } else {
    console.log(`FETCH ${secret}`);
    const AWS = require('aws-sdk');
    const secretsmanager = new AWS.SecretsManager();
    return secretsmanager.getSecretValue({
      SecretId: secret,
    }).promise().then((data) => {
      secrets = JSON.parse(data.SecretString);
      next();
    });
  }
}

/**
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {function} next Callback.
 */
function verifyRequest(req, res, next) {
  console.log(`PAYLOAD ${JSON.stringify(req.body)}`);
  if (process.env.SKIP_VERIFY) {
    console.warn('SKIP VERIFY');
    next();
  }
  else {
    const ts = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    const hmac = crypto.createHmac('sha256', secrets.SIGNING_SECRET);
    const data = `${secrets.SIGNING_VERSION}:${req.headers['x-slack-request-timestamp']}:${req.body}`;
    const sig2 = `${secrets.SIGNING_VERSION}=${hmac.update(data).digest('hex')}`;
    const delta = Math.abs(new Date()/1000 - ts);
    console.log(`SIGNATURES ${JSON.stringify({given: sig, calculated: sig2})}`);
    if (delta > 60 * 5) {
      res.status(403).send({error: 'Request too old'});
    } else if (sig !== sig2) {
      res.status(403).send({error: 'Signatures do not match'});
    } else {
      next();
    }
  }
}

/**
 *
 * @param {object} payload SNS payload to publish.
 * @param {object} topic SNS topic ARN.
 */
function publishPayload(payload, topic) {
  if (process.env.SKIP_PUBLISH) {
    const options = {TopicArn: topic};
    console.log(`SKIP PUBLISH ${JSON.stringify(options)}`);
    return Promise.resolve({});
  }
  else {
    console.log(`PAYLOAD ${JSON.stringify(payload)}`);
    const message = Buffer.from(JSON.stringify(payload)).toString('base64');
    const options = {Message: message, TopicArn: topic};
    console.log(`PUBLISH ${JSON.stringify(options)}`);
    return SNS.publish(options).promise();
  }
}

/**
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function getOauth (req, res) {
  console.log(`PAYLOAD ${JSON.stringify(req.body)}`);
  const { WebClient } = require('@slack/client');
  const slack = new WebClient(secrets.BOT_ACCESS_TOKEN);
  const options = {
    code: req.query.code,
    client_id: secrets.CLIENT_ID,
    client_secret: secrets.CLIENT_SECRET,
    redirect_uri: redirect_uri,
  };
  return slack.oauth.access(options).then((ret) => {
    console.log(`AUTH ${JSON.stringify(ret)}`);
    const sns_topic_suffix = `oauth`;
    const topic = `${sns_topic_prefix}${sns_topic_suffix}`;
    publishPayload(ret, topic).then((sns) => {
      res.redirect(oauth_redirect || `https://slack.com/app_redirect?team=${ret.team_id}`);
    }).catch((err) => {
      res.status(500).send({error: err})
    });
  });
}

/**
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function postCallback (req, res) {
  const sns_topic_suffix = `callback_${req.body.callback_id}`;
  const topic = `${sns_topic_prefix}${sns_topic_suffix}`;
  publishPayload(payload, topic).then((sns) => {
    console.log(`SNS RESPONSE ${JSON.stringify(sns)}`);
    res.send(sns);
  }).catch((err) => {
    res.status(500).send({error: err})
  });
}

/**
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function postEvent (req, res) {
  if (req.body.type === 'url_verification') {
    const challenge = {challenge: req.body.challenge};
    console.log(`CHALLENGE ${JSON.stringify(challenge)}`);
    res.send(challenge);
  } else {
    const sns_topic_suffix = `event_${req.body.event.type}`;
    const topic = `${sns_topic_prefix}${sns_topic_suffix}`;
    publishPayload(res, topic).then((sns) => {
      console.log(`SNS RESPONSE ${JSON.stringify(sns)}`);
      res.status(204).send();
    }).catch((err) => {
      res.status(500).send({error: err});
    });
  }
}

/**
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 */
function postSlashCommand (req, res) {
  const sns_topic_suffix = req.body.command.replace(/^\//, 'slash_');
  const topic = `${sns_topic_prefix}${sns_topic_suffix}`;
  publishPayload(res, topic).then((sns) => {
    console.log(`SNS RESPONSE ${JSON.stringify(sns)}`);
    res.status(204).send();
  }).catch((err) => {
    console.error(`ERROR ${JSON.stringify(err)}`);
    res.status(500).send({error: err});
  });
}

app.get('/oauth', getSecrets, getOauth);
app.post('/callbacks', getSecrets, verifyRequest, postCallback);
app.post('/events', getSecrets, verifyRequest, postEvent);
app.post('/slash-commands', getSecrets, verifyRequest, postSlashCommand);

module.exports = app;
