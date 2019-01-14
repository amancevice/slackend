'use strict';
require('dotenv').config();
const express  = require('express');
const slackend = require('./index');
const port     = process.env.PORT || 3000;
const host     = process.env.SLACKEND_HOST || 'localhost';
const baseUrl  = process.env.SLACKEND_BASE_URL || '/';
slackend.app.use(baseUrl, slackend.router);
slackend.app.listen(port, () => console.log(`> Listening on ${host}:${port}${baseUrl}`));
