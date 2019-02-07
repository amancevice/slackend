'use strict';
const AWS                  = require('aws-sdk');
const awsServerlessExpress = require('aws-serverless-express');
const express              = require('express');
const slackend             = require('./index');

const AWS_SECRET     = process.env.AWS_SECRET;
const AWS_SNS_PREFIX = process.env.AWS_SNS_PREFIX || '';
const BASE_URL       = process.env.BASE_URL       || '/';

const sns            = new AWS.SNS();
const secretsmanager = new AWS.SecretsManager();

const app    = express();
const server = awsServerlessExpress.createServer(app);

let env;

slackend.logger.debug.log = console.log.bind(console);
slackend.logger.info.log  = console.log.bind(console);
slackend.logger.warn.log  = console.log.bind(console);
slackend.logger.error.log = console.log.bind(console);

function getEnv(options) {
  slackend.logger.info(`GET ${JSON.stringify(options)}`);
  return secretsmanager.getSecretValue(options).promise().then((secret) => {
    env = Object.assign(process.env, JSON.parse(secret.SecretString));
    return env;
  });
}

module.exports = (event, context) => {
  Promise.resolve(env || getEnv({SecretId: AWS_SECRET})).then((env) => {
    app.use(BASE_URL, slackend({
      client_id:       process.env.SLACK_CLIENT_ID,
      client_secret:   process.env.SLACK_CLIENT_SECRET,
      redirect_uri:    process.env.SLACK_OAUTH_REDIRECT_URI,
      signing_secret:  process.env.SLACK_SIGNING_SECRET,
      signing_version: process.env.SLACK_SIGNING_VERSION,
      token:           process.env.SLACK_TOKEN,
    }), (req, res) => {
      res.locals.topic = `${AWS_SNS_PREFIX}${res.locals.topic}`;
      slackend.logger.info(`PUT ${JSON.stringify(res.locals)}`);
      return sns.publish({
        Message:  JSON.stringify(res.locals.message),
        TopicArn: res.locals.topic,
      }).promise().then(() => {
        res.status(204).send();
      }).catch((err) => {
        res.status(400).send(err);
      });
    });
    awsServerlessExpress.proxy(server, event, context);
  });
};
