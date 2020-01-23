'use strict';
require('dotenv').config();
const express  = require('express');
const slackend = require('./index');

const BASE_URL = process.env.BASE_URL || '/';
const HOST     = process.env.HOST     || 'localhost';
const PORT     = process.env.PORT     || 3000;

const app = express();
const api = slackend();
const pub = (req, res) => {
  console.log(`\n${req.method} ${req.path}`);
  console.log(res.locals);
  console.log(`├── type:    ${res.locals.slack.type}`);
  console.log(`├── id:      ${res.locals.slack.id}`);
  console.log(`└── message: ${JSON.stringify(res.locals.slack.message)}`);
  res.json(res.locals.slack);
};
const log = () => {
  console.log(`> Listening on ${HOST}:${PORT}${BASE_URL}\n`);

  console.log(`# Callback`)
  console.log(`curl --request POST \\`)
  console.log(`  --data 'payload=%7B%22callback_id%22%3A%22fizz%22%7D' \\`)
  console.log(`  --url 'http://${HOST}:${PORT}${BASE_URL}callbacks'\n`)

  console.log(`# Event`)
  console.log(`curl --request POST \\`);
  console.log(`  --header 'Content-Type: application/json' \\`);
  console.log(`  --data '{"type": "event_callback", "event": {"type": "team_join"}}' \\`);
  console.log(`  --url 'http://${HOST}:${PORT}${BASE_URL}events'\n`);

  console.log(`# Slash command`);
  console.log(`curl --request POST \\`);
  console.log(`  --data 'fizz=buzz' \\`);
  console.log(`  --url 'http://${HOST}:${PORT}${BASE_URL}slash/fizz'\n`);
};
app.use(BASE_URL, api, pub);
app.listen(PORT, log);
