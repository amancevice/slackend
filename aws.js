'use strict';
const aws                  = require('aws-sdk');
const awsServerlessExpress = require('aws-serverless-express');
const express              = require('express');
const slackend             = require('./index');
const slack                = require('@slack/client');

const AWS_SECRET = process.env.AWS_SECRET;

const app    = express();
const server = awsServerlessExpress.createServer(app);

let env, clients = {
  secretsmanager: new aws.SecretsManager(),
  sns:            new aws.SNS(),
};

slackend.logger.debug.log = console.log.bind(console);
slackend.logger.info.log  = console.log.bind(console);
slackend.logger.warn.log  = console.log.bind(console);
slackend.logger.error.log = console.log.bind(console);

function getEnv (options) {
  slackend.logger.info(`GET ${JSON.stringify(options)}`);
  return clients.secretsmanager.getSecretValue(options).promise().then((secret) => {
    env = Object.assign(process.env, JSON.parse(secret.SecretString));
    clients.slack = clients.slack || new slack.WebClient(process.env.SLACK_TOKEN);
    return env;
  });
}

function postGen (method) {
  return async (event) => {
    slackend.logger.info(`EVENT ${JSON.stringify(event)}`);
    await Promise.resolve(env || getEnv({SecretId: AWS_SECRET}));
    const send  = clients.slack.chat[method];
    const msgs  = event.Records.map((rec) => JSON.parse(rec.Sns.Message));
    return Promise.all(msgs.map(send));
  };
}

function publish (req, res) {
  res.locals.topic = `${process.env.AWS_SNS_PREFIX || ''}${res.locals.topic}`;
  slackend.logger.info(`PUT ${JSON.stringify(res.locals)}`);
  return clients.sns.publish({
    Message:  JSON.stringify(res.locals.message),
    TopicArn: res.locals.topic,
  }).promise().then(() => {
    res.status(204).send();
  }).catch((err) => {
    res.status(400).send(err);
  });
}

async function handler (event, context) {
  slackend.logger.info(`EVENT ${JSON.stringify(event)}`);
  await Promise.resolve(env || getEnv({SecretId: AWS_SECRET}));
  app.use(process.env.BASE_URL || '/', slackend({
    client_id:       process.env.SLACK_CLIENT_ID,
    client_secret:   process.env.SLACK_CLIENT_SECRET,
    redirect_uri:    process.env.SLACK_OAUTH_REDIRECT_URI,
    signing_secret:  process.env.SLACK_SIGNING_SECRET,
    signing_version: process.env.SLACK_SIGNING_VERSION,
    token:           process.env.SLACK_TOKEN,
  }), publish);
  return await awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
}

exports.handler = handler;

if (process.env.NODE_ENV === 'test') {
  exports.clients       = clients;
  exports.env           = env;
  exports.getEnv        = getEnv;
  exports.publish       = publish;
  exports.postEphemeral = postGen('postEphemeral');
  exports.postMessage   = postGen('postMessage');
  exports.server        = server;
}
