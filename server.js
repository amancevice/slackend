'use strict';
const dotenv = require('dotenv');
const config = dotenv.config();
const app = require('./index');
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`> Listening on port ${port}`));
