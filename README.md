# Asynchronous Slackbot

A simple, asynchronous back end for your Slack app.

The service intentionally does very little: it accepts an incoming request, verifies its origin, and publishes the payload to a queue/trigger for asynchronous processing.

Endpoints are provided for:

- `/callbacks` publishes [interactive messages](https://api.slack.com/interactive-messages)
- `/events` publishes events from the [Events API](https://api.slack.com/events-api)
- `/slash/:cmd` publishes [slash commands](https://api.slack.com/slash-commands)
- `/oauth` completes the [OAuth2](https://api.slack.com/docs/oauth) workflow

Without additional configuration, request payloads are simply published to `console.log`.

In production it is expected that users will attach their own publishing functions to connect to a messaging service like [Amazon SNS](https://aws.amazon.com/sns/), or [Google Pub/Sub](https://cloud.google.com/pubsub/docs/).

The fetching of additional/secret environmental values necessary for connecting to external services is also configurable.

**Advantages**

- Separates the concerns of responding to incoming requests and the logic to handle them.
  - Handlers can be added/removed independently of this app; deploy once and forget.
  - Requests can be published to any platform.
  - Handlers can be written in any language supported by the topic trigger.
- Designed to work within serverless frameworks, such as [AWS Lambda](https://aws.amazon.com/lambda/) or [Google Cloud Functions](https://cloud.google.com/functions/docs/).
- Authenticates requests using Slack's [signing secrets](https://api.slack.com/docs/verifying-requests-from-slack) so you'll know that events published to internal triggers/queues are verified.

**Drawbacks**

- Slack has a strict 3-second lifetime for many API operations, so it is critical that your asynchronous tasks complete quickly. Cold start times of some serverless computing platforms may be prohibitively slow.

## Local Setup

Run a local instance of your slack app by cloning this repository, configuring settings, installing dependencies, and starting the express server.

Configure settings by copying [`.env.example`](./.env.example) to `.env` and adding your keys/settings.

```bash
cp .env.example .env
```

Install dependencies using `npm` or `docker-compose`:

```bash
npm install
# or
docker-compose run --rm npm install
```

Start the server:

```bash
npm start
```

Send a sample request:

```bash
# Callback
curl --request POST \
  --data 'payload=%7B%22callback_id%22%3A%22fizz%22%7D' \
  --url 'http://localhost:3000/callbacks'

# Event
curl --request POST \
  --header 'Content-Type: application/json' \
  --data '{"type": "event_callback", "event": {"type": "team_join"}}' \
  --url 'http://localhost:3000/events'

# Slash command
curl --request POST \
  --data 'fizz=buzz' \
  --url 'http://localhost:3000/slash/fizz'
```

## Deploy to AWS Lambda

Deploy directly to AWS using [`terraform`](https://terraform.io) and the [`slackbot`](https://github.com/amancevice/terraform-aws-slackbot) + [`slackbot-secrets`](https://github.com/amancevice/terraform-aws-slackbot-secrets) modules:


```hcl
module slackbot_secret {
  source                  = "amancevice/slackbot-secrets/aws"
  kms_key_alias           = "alias/slack/your-kms-key-alias"
  secret_name             = "slack/your-secret-name"
  slack_bot_access_token  = "${var.slack_bot_access_token}"
  slack_client_id         = "${var.slack_client_id}"
  slack_client_secret     = "${var.slack_client_secret}"
  slack_signing_secret    = "${var.slack_signing_secret}"
  slack_user_access_token = "${var.slack_user_access_token}"
}

module slackbot {
  source          = "amancevice/slackbot/aws"
  api_description = "My Slack REST API"
  api_name        = "<my-api>"
  api_stage_name  = "<my-api-stage>"
  secret_arn      = "${module.slackbot_secret.secret_arn}"
  kms_key_id      = "${module.slackbot_secret.kms_key_id}"
}
```

## Customization

Set app values for `fetchEnv` and `publish` to customize the app's behavior.

The [`lambda.js`](./lambda.js) script shows how to deploy the app using AWS SecretsManager to fetch Slack secrets and SNS to publish requests.

```javascript
'use strict';
const awsServerlessExpress = require('aws-serverless-express');
const slackend = require('slackend');

slackend.app.set('fetchEnv', () => {
  // Get ENV values
});

slackend.app.set('publish', (payload, topic) => {
  // Publish `payload` to `topic`
});

slackend.app.use('/', slackend.app.router);
const server = awsServerlessExpress.createServer(app);
exports.handler = (event, context) => awsServerlessExpress.proxy(server, event, context);
```

### Environment

Supply additional environmental variables by setting the `fetchEnv` value of the app to a function that takes no arguments and returns a promise to update and return `process.env`.

Example:

```javascript
slackend.app.set('fetchEnv', () => {
  return Promise.resolve(process.env);
});
```

### Publishing

Set the `publish` value of the app to a function that takes a `payload` and `topic` and returns a promise to publish.

Example:

```javascript
slackend.app.set('publish', (payload, topic) => {
  return Promise.resolve({
    topic: topic,
    payload: payload
  }).then(console.log);
});
```
