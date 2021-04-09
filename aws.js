'use strict';

// stdlib
const url = require('url');

// node_modules
const debug                        = require('debug');
const express                      = require('express');
const serverless                   = require('serverless-http');
const {SecretsManager,EventBridge} = require('aws-sdk');
const {WebClient}                  = require('@slack/web-api');

// local
const slackend = require('./index');

let app, slack, secretsmanager, eventbridge;

// Lambda logger
slackend.logger.addContext = (context) => {
  let reqid;
  if (context && context.awsRequestId) {
    reqid = `RequestId: ${ context.awsRequestId }`;
  } else {
    reqid = '-';
  }
  ['debug', 'info', 'warn', 'error'].map((lvl) => {
    slackend.logger[lvl].original_namespace = slackend.logger[lvl].namespace;
    slackend.logger[lvl].namespace += ` ${ reqid }`;
  });
};
slackend.logger.dropContext = () => {
  ['debug', 'info', 'warn', 'error'].map((lvl) => {
    slackend.logger[lvl].namespace = slackend.logger[lvl].original_namespace;
  });
}

async function getApp() {
  if (!app) {
    await getEnv();
    app = express();
    app.use(process.env.BASE_PATH || process.env.BASE_URL || '/', slackend(), publish);
  }
  return app;
}

async function getEnv() {
  const secret = await secretsmanager.getSecretValue({SecretId: process.env.AWS_SECRET}).promise();
  return Object.assign(process.env, JSON.parse(secret.SecretString));
}

async function getSlack() {
  if (!slack) {
    await getEnv();
    slack = new WebClient(process.env.SLACK_TOKEN);
  }
  return slack;
}

async function handler(event, context) {
  slackend.logger.addContext(context);
  slackend.logger.info(`EVENT ${ JSON.stringify(event) }`);
  const app = await getApp();
  const handle = serverless(app);
  const res = await handle(event, context);
  slackend.logger.info(`RESPONSE [${ res.statusCode }] ${ res.body }`);
  slackend.logger.dropContext();
  return res;
}

function post(method) {
  return async (event, context) => {
    slackend.logger.addContext(context);
    slackend.logger.info(`EVENT ${ JSON.stringify(event) }`);
    await getSlack();
    slackend.logger.info(`slack.chat.${ method } ${ JSON.stringify(event.detail) }`);
    const res = await slack.chat[method](event.detail);
    slackend.logger.info(`RESPONSE ${ JSON.stringify(res) }`);
    slackend.logger.dropContext();
    return res;
  };
}

function publishOptions(req, res) {
  return {
    Entries: [
      {
        Detail:       JSON.stringify(res.locals.slack),
        DetailType:   process.env.AWS_EVENTBRIDGE_DETAIL_TYPE || 'Slack Event',
        EventBusName: process.env.AWS_EVENTBRIDGE_BUS_NAME    || 'default',
        Source:       process.env.AWS_EVENTBRIDGE_SOURCE      || 'com.slack',
        TraceHeader:  req.headers['x-amzn-trace-id'],
      },
    ],
  };
}

function publishHandler(req, res) {
  if (req.path === '/oauth' || req.path === '/oauth/v2') {
    let uri        = process.env.SLACK_OAUTH_SUCCESS_URI || 'slack://channel?team={TEAM_ID}&id={CHANNEL_ID}',
        channel_id = res.locals.slack.incoming_webhook && res.locals.slack.incoming_webhook.channel_id,
        team_id    = res.locals.slack.team && res.locals.slack.team.id;
    uri = uri.replace('{TEAM_ID}', team_id).replace('{CHANNEL_ID}', channel_id);
    uri = url.parse(uri, true).format();
    slackend.logger.info(`RESPONSE [302] ${ uri }`);
    res.redirect(uri);
  } else {
    slackend.logger.info(`RESPONSE [204]`);
    res.status(204).send();
  }
}

function publish(req, res) {
  let options = publishOptions(req, res);
  slackend.logger.info(`PUT EVENTS ${ JSON.stringify(options) }`);
  return eventbridge.putEvents(options).promise()
    .then(() => publishHandler(req, res))
    .catch((err) => {
      slackend.logger.warn(`RESPONSE [400] ${ JSON.stringify(err) }`);
      res.status(400).send(err);
    });
}

module.exports = (options = {}) => {
  app            = options.app;
  slack          = options.slack;
  secretsmanager = options.secretsmanager || new SecretsManager();
  eventbridge    = options.eventbridge    || new EventBridge();

  return {
    getApp:        getApp,
    getEnv:        getEnv,
    getSlack:      getSlack,
    handler:       handler,
    postEphemeral: post('postEphemeral'),
    postMessage:   post('postMessage'),
    publish:       publish,
  }
};
module.exports.logger = slackend.logger;
