"use strict";
require("dotenv").config();
const qs = require("querystring");
const express = require("express");
const slackend = require("./index");

const BASE_URL = process.env.BASE_URL || "/";
const HOST = process.env.HOST || "localhost";
const PORT = process.env.PORT || 3000;

const app = express();
const api = slackend();
const pub = (req, res) => {
  console.log(`\n${req.method} ${req.path}`);
  res.json(req.body);
};
const log = () => {
  let callback = { type: "block_actions", view: { callback_id: "callback_1" } },
    event = { type: "event_callback", event: { type: "team_join" } },
    slash = { fizz: "buzz" };
  console.log(`> Listening on ${HOST}:${PORT}${BASE_URL}\n`);

  console.log(`# Callback`);
  console.log(`curl --request POST \\`);
  console.log(`  --data 'payload=${qs.escape(JSON.stringify(callback))}' \\`);
  console.log(`  --url 'http://${HOST}:${PORT}${BASE_URL}callbacks' | jq\n`);

  console.log(`# Event`);
  console.log(`curl --request POST \\`);
  console.log(`  --header 'Content-Type: application/json' \\`);
  console.log(`  --data '${JSON.stringify(event)}' \\`);
  console.log(`  --url 'http://${HOST}:${PORT}${BASE_URL}events' | jq\n`);

  console.log(`# Slash command`);
  console.log(`curl --request POST \\`);
  console.log(`  --data '${JSON.stringify(slash)}' \\`);
  console.log(`  --url 'http://${HOST}:${PORT}${BASE_URL}slash/fizz' | jq\n`);
};
app.use(BASE_URL, api, pub);
app.listen(PORT, log);
