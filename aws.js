'use strict';
const {SecretsManager,SNS} = require('aws-sdk');
const awsServerlessExpress = require('aws-serverless-express');
const express              = require('express');
const slackend             = require('./index');
const {WebClient}          = require('@slack/client');

slackend.logger.debug.log = console.log.bind(console);
slackend.logger.info.log  = console.log.bind(console);
slackend.logger.warn.log  = console.log.bind(console);
slackend.logger.error.log = console.log.bind(console);

let app, secretsmanager, server, slack, sns;

async function getApp () {
  await getEnv();
  app = express();
  app.use(process.env.BASE_URL || '/', slackend({
    client_id:       process.env.SLACK_CLIENT_ID,
    client_secret:   process.env.SLACK_CLIENT_SECRET,
    redirect_uri:    process.env.SLACK_OAUTH_REDIRECT_URI,
    signing_secret:  process.env.SLACK_SIGNING_SECRET,
    signing_version: process.env.SLACK_SIGNING_VERSION,
    token:           process.env.SLACK_TOKEN,
  }), publish);
  return app;
}

async function getEnv () {
  const secret = await secretsmanager.getSecretValue({SecretId: process.env.AWS_SECRET}).promise();
  return Object.assign(process.env, JSON.parse(secret.SecretString));
}

async function getServer () {
  if (!server) {
    app    = await getApp();
    server = awsServerlessExpress.createServer(app);
  }
  return server;
}

async function getSlack () {
  if (!slack) {
    await getEnv();
    slack = new WebClient(process.env.SLACK_TOKEN);
  }
  return slack;
}

async function handler (event, context) {
  slackend.logger.info(`EVENT ${JSON.stringify(event)}`);
  await getServer();
  return await awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
}

function post (method) {
  return async (event) => {
    slackend.logger.info(`EVENT ${JSON.stringify(event)}`);
    await getSlack();
    const func = slack.chat[method];
    const msgs = event.Records.map((rec) => JSON.parse(rec.Sns.Message));
    return await Promise.all(msgs.map(func));
  };
}

function publish (req, res) {
  res.locals.topic = `${process.env.AWS_SNS_PREFIX || ''}${res.locals.topic}`;
  slackend.logger.info(`PUT ${JSON.stringify(res.locals)}`);
  return sns.publish({
    Message:  JSON.stringify(res.locals.message),
    TopicArn: res.locals.topic,
  }).promise().then(() => {
    res.status(204).send();
  }).catch((err) => {
    res.status(400).send(err);
  });
}

exports = module.exports = (options = {}) => {
  secretsmanager = options.secretsmanager || new SecretsManager();
  server         = options.server;
  slack          = options.slack;
  sns            = options.sns || new SNS();
  return {
    getApp:        getApp,
    getEnv:        getEnv,
    getServer:     getServer,
    getSlack:      getSlack,
    handler:       handler,
    postEphemeral: post('postEphemeral'),
    postMessage:   post('postMessage'),
    publish:       publish,
  }
};
