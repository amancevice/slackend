'use strict';
require('dotenv').config();
const PubSub   = require('@google-cloud/pubsub');
const debug    = require('debug');
const express  = require('express');
const slackend = require('slackend');

const BASE_URL     = process.env.BASE_URL     || '/';
const TOPIC_PREFIX = process.env.TOPIC_PREFIX || '';

const app    = express();
const info   = debug('slackend:google:info');
const pubsub = new PubSub();

app.use(BASE_URL, slackend(), (req, res) => {
  res.locals.topic = `${TOPIC_PREFIX}${res.locals.topic}`;
  slackend.logger.info(JSON.stringify(res.locals));
  const data = Buffer.from(JSON.stringify(res.locals.message));
  return pubsub.topic(res.locals.topic).publisher().publish(data);
});

module.exports = (req, res, next) => {
  req.url = process.env.ROUTE;
  app._router.handle(req, res, next);
};
