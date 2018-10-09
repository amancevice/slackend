'use strict'
const app = require('./app');
const awsServerlessExpress = require('aws-serverless-express');
const server = awsServerlessExpress.createServer(app);
exports.handler = (event, context) => awsServerlessExpress.proxy(server, event, context);
