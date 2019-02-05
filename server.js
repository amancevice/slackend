'use strict';
require('dotenv').config();
const express  = require('express');
const slackend = require('./index');

const PORT     = process.env.PORT              || 3000;
const HOST     = process.env.SLACKEND_HOST     || 'localhost';
const BASE_URL = process.env.SLACKEND_BASE_URL || '/';

slackend.app.use(baseUrl, slackend.router);
slackend.app.listen(port, () => console.log(`> Listening on ${HOST}:${PORT}${BASE_URL}`));
