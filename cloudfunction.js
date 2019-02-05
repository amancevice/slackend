'use strict';
require('dotenv').config();
const PubSub   = require('@google-cloud/pubsub');
const slackend = require('slackend');

const pubsub = new PubSub();

slackend.app.use('/', slackend.router);

slackend.app.set('publish', (payload, topic) => {
  const data = Buffer.from(JSON.stringify(payload));
  return pubsub.topic(topic).publisher().publish(data);
});

exports.handler = (req, res, next) => {
  req.url = process.env.ROUTE;
  return slackend.app._router.handle(req, res, next);
};
