'use strict';
const dotenv = require('dotenv');
const config = dotenv.config();
const slackend = require('slackend');
slackend.app.use('/', slackend.router);

slackend.app.set('publish', (payload, topic) => {
  const PubSub = require('@google-cloud/pubsub');
  const pubsub = new PubSub();
  const data = Buffer.from(JSON.stringify(payload));
  return pubsub.topic(topic).publisher().publish(data);
});

exports.handler = (req, res, next) => {
  req.url = process.env.ROUTE;
  return slackend.app._router.handle(req, res, next);
};
