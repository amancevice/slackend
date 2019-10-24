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
  let server         = options.server;
  let slack          = options.slack;
  let secretsmanager = options.secretsmanager || new SecretsManager();
  let sns            = options.sns            || new SNS();

  async function getApp() {
    if (!app) {
      await getEnv();
      app = express();
      app.use(process.env.BASE_URL || '/', slackend(), publish);
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

  function publishOptions(req, res) {
    return {
      Message:  JSON.stringify(res.locals.slack.message),
      TopicArn: process.env.AWS_SNS_TOPIC_ARN,
      MessageAttributes: {
        type: {
          DataType:    'String',
          StringValue: res.locals.slack.type,
        },
        id: {
          DataType:    'String',
          StringValue: res.locals.slack.id,
        },
      },
    };
  }

  function publishHandler(req, res) {
    if (req.path === '/oauth') {
      let uri        = process.env.SLACK_OAUTH_SUCCESS_URI       || 'slack://channel?team={TEAM_ID}&id={CHANNEL_ID}',
          channel_id = res.locals.slack.message.incoming_webhook && res.locals.slack.message.incoming_webhook.channel_id,
          team_id    = res.locals.slack.message.team_id;
      uri = uri.replace('{TEAM_ID}',    team_id);
      uri = uri.replace('{CHANNEL_ID}', channel_id);
      uri = url.parse(uri, true).format();
      res.redirect(uri);
    } else {
      res.status(204).send();
    }
  }

  function publish(req, res) {
    let options = publishOptions(req, res);
    slackend.logger.info(`PUBLISH ${JSON.stringify(options)}`);
    return sns.publish(options).promise()
      .then(() => publishHandler(req, res))
      .catch((err) => res.status(400).send(err));
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
