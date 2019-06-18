'use strict';
const awsServerlessExpress = require('aws-serverless-express');
const express              = require('express');
const slackend             = require('./index');
const url                  = require('url');
const {SecretsManager,SNS} = require('aws-sdk');
const {WebClient}          = require('@slack/web-api');

slackend.logger.debug.log = console.log.bind(console);
slackend.logger.info.log  = console.log.bind(console);
slackend.logger.warn.log  = console.log.bind(console);
slackend.logger.error.log = console.log.bind(console);

exports = module.exports = (options = {}) => {
  let app            = options.app;
  let secretsmanager = options.secretsmanager || new SecretsManager();
  let server         = options.server;
  let slack          = options.slack;
  let sns            = options.sns || new SNS();

  async function getApp() {
    if (!app) {
      await getEnv();
      app = express();
      app.use(process.env.BASE_URL || '/', slackend({
        client_id:          process.env.SLACK_CLIENT_ID,
        client_secret:      process.env.SLACK_CLIENT_SECRET,
        oauth_error_uri:    process.env.SLACK_OAUTH_ERROR_URI,
        oauth_redirect_uri: process.env.SLACK_OAUTH_REDIRECT_URI,
        oauth_success_uri:  process.env.SLACK_OAUTH_SUCCESS_URI,
        signing_secret:     process.env.SLACK_SIGNING_SECRET,
        signing_version:    process.env.SLACK_SIGNING_VERSION,
        token:              process.env.SLACK_TOKEN,
      }), publish);
    }
    return app;
  }

  async function getEnv() {
    const secret = await secretsmanager.getSecretValue({SecretId: process.env.AWS_SECRET}).promise();
    return Object.assign(process.env, JSON.parse(secret.SecretString));
  }

  async function getServer() {
    if (!server) {
      server = awsServerlessExpress.createServer(await getApp());
    }
    return server;
  }

  async function getSlack() {
    if (!slack) {
      await getEnv();
      slack = new WebClient(process.env.SLACK_TOKEN);
    }
    return slack;
  }

  async function handler(event, context) {
    slackend.logger.info(`EVENT ${JSON.stringify(event)}`);
    await getServer();
    return await awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
  }

  function post(method) {
    return async (event) => {
      slackend.logger.info(`EVENT ${JSON.stringify(event)}`);
      await getSlack();
      const func = slack.chat[method];
      const msgs = event.Records.map((rec) => JSON.parse(rec.Sns.Message));
      return await Promise.all(msgs.map((msg) => func(msg)));
    };
  }

  function publish(req, res) {
    slackend.logger.info(`PUT ${JSON.stringify(res.locals)}`);
    return sns.publish({
      Message:  JSON.stringify(res.locals.message),
      TopicArn: process.env.AWS_SNS_TOPIC_ARN,
      MessageAttributes: {
        type: {
          DataType:    'String',
          StringValue: res.locals.type,
        },
        id: {
          DataType:    'String',
          StringValue: res.locals.id,
        },
      },
    }).promise().then(() => {
      if (req.path === '/oauth') {
        let uri = process.env.SLACK_OAUTH_SUCCESS_URI || 'slack://channel?team={TEAM_ID}&id={CHANNEL_ID}';
        uri = uri.replace('{TEAM_ID}', res.locals.message.team_id);
        uri = uri.replace('{CHANNEL_ID}', res.locals.message.incoming_webhook && res.locals.message.incoming_webhook.channel_id);
        uri = url.parse(uri, true);
        res.redirect(uri.format());
      } else {
        res.status(204).send();
      }
    }).catch((err) => {
      res.status(400).send(err);
    });
  }

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
exports.logger = slackend.logger;
