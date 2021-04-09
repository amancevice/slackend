# Asynchronous Slackbot

![npm](https://img.shields.io/npm/v/slackend?style=flat-square)
[![test](https://img.shields.io/github/workflow/status/amancevice/slackend/test?logo=github&style=flat-square)](https://github.com/amancevice/slackend/actions)
[![coverage](https://img.shields.io/codeclimate/coverage/amancevice/slackend?logo=code-climate&style=flat-square)](https://codeclimate.com/github/amancevice/slackend/test_coverage)
[![maintainability](https://img.shields.io/codeclimate/maintainability/amancevice/slackend?logo=code-climate&style=flat-square)](https://codeclimate.com/github/amancevice/slackend/maintainability)

A simple, asynchronous back end for your Slack app.

The app intentionally does very little: it is essentially middleware for [ExpressJS](https://expressjs.com) that accepts an incoming request, verifies its origin, and passes the request to a user-provided callback, where the payload is sent to a queue/trigger for asynchronous processing.

Endpoints are provided for:

- `GET /health` check to verify the service is running
- `GET /install` begin the process of installing your app to a workspace
- `GET /oauth` completes the [OAuth2](https://api.slack.com/docs/oauth) workflow
- `GET /oauth/v2` completes the [OAuth2](https://api.slack.com/docs/oauth) workflow (v2)
- `POST /callbacks` publishes [interactive messages](https://api.slack.com/interactive-messages)
- `POST /events` publishes events from the [Events API](https://api.slack.com/events-api)
- `POST /slash/:cmd` publishes [slash commands](https://api.slack.com/slash-commands)

In production it is expected that users will attach their own publishing functions to connect to a messaging service like [Amazon EventBridge](https://aws.amazon.com/eventbridge/), or [Google Pub/Sub](https://cloud.google.com/pubsub/docs/).

## Advantages

- Separates the concerns of responding to incoming requests and the logic to handle them.
  - Handlers can be added/removed independently of this app; deploy once and forget.
  - Requests can be published to any platform.
  - Handlers can be written in any language supported by the topic trigger.
- Designed to work within serverless frameworks, such as [AWS Lambda](https://aws.amazon.com/lambda/) or [Google Cloud Functions](https://cloud.google.com/functions/docs/).
- Authenticates requests using Slack's [signing secrets](https://api.slack.com/docs/verifying-requests-from-slack) so you'll know that events published to internal triggers/queues are verified.

## Drawbacks

- Slack has a strict 3-second lifetime for many API operations, so it is critical that your asynchronous tasks complete quickly. Cold start times of some serverless computing platforms may be prohibitively slow. (_Note: this concern can be effectively eliminated on most platforms by configuring your serverless functions for speed_)

## Processing Events

In very simple terms, all events are processed by transforming the request payload to a JSON object and assigning it to the express local `res.locals.slack`.

It is left to the user to handle further transformation and publishing of the event, however the [`aws`](./aws.js) module provides an implementation that publishes the events to EventBridge.

Here is an example configuration that simply responds to incoming requests with the processed payload:

```javascript
const express = require("express");
const slackend = require("slackend");
const app = express();
app.use(slackend(), (req, res) => res.json(res.locals.slack));
app.listen(3000);
```

## Serverless Deployment

![AWS](./docs/aws.png?)

Deploying a version of this app to Amazon Web Services (AWS) serverless offerings might take the above shape, where incoming requests from Slack to your app are handled as follows:

**API Gateway** receives and routes all requests to a single **Lambda function** integration.

On cold starts, the **Lambda function** pulls its Slack tokens/secrets from its encrypted **SecretsManager** secret, starts a proxy express server, and publishes the request to an **EventBridge** bus.

On warm starts the environment and server are cached and the request is published to **EventBridge** without needing to re-fetch the app secrets.

Once the request is published, the API sends a `204 NO CONTENT` response back to Slack.

Using this method, each feature of your app can be added one-by-one independently of the API and is highly scalable.

## NodeJS Usage

At its core, `slackend` is middleware for [ExpressJS](https://expressjs.com) with several routes predefined for handling Slack messages. None of the routes are configured to respond to the request. This is done deliberately so users can customize the behavior of the app.

The Slack message and an inferred topic name are stored in the `res.locals` object and can be used to publish the request to your preferred messaging/queueing service.

Here is an example usage that simply logs the request to the console:

```javascript
const slackend = require("slackend");

// Create express app
const app = slackend({
  client_id: process.env.SLACK_CLIENT_ID,
  client_secret: process.env.SLACK_CLIENT_SECRET,
  oauth_error_uri: process.env.SLACK_OAUTH_ERROR_URI,
  oauth_redirect_uri: process.env.SLACK_OAUTH_REDIRECT_URI,
  oauth_success_uri: process.env.SLACK_OAUTH_SUCCESS_URI,
  signing_secret: process.env.SLACK_SIGNING_SECRET,
  signing_version: process.env.SLACK_SIGNING_VERSION,
  token: process.env.SLACK_TOKEN,
});

// You *must* add a callback that responds to the request
app.use((req, res) => {
  console.log(res.locals);
  res.json({ ok: true });
});
```

_WARNING &mdash; All of the configuration options to `slackend()` are optional, but omitting the `signing_secret` will disable the verification step where received requests are confirmed as originating from Slack. Disabling verification can also be done by setting the environmental variable `DISABLE_VERIFICATION=1`._

## Local Development

Run a local instance of your slack app by cloning this repository, configuring settings, installing dependencies, and starting the express server.

Configure settings by copying [`.env.example`](./.env.example) to `.env` and adding your keys/settings.

```bash
cp .env.example .env
```

Install dependencies using `npm` or `docker-compose`:

```bash
npm install
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

## AWS

A module is provided to deploy to Lambda using SecretsManager to store the Slack secrets.

Example Lambda handler:

```javascript
const slackend = require("slackend/aws");
module.exports = slackend();
```

## Deploy with Terraform

Deploy directly to AWS using [`terraform`](https://terraform.io) and the [`slackbot`](https://github.com/amancevice/terraform-aws-slackbot) + [`slackbot-secrets`](https://github.com/amancevice/terraform-aws-slackbot-secrets) modules:

```terraform
resource "aws_apigatewayv2_api" "slackbot_api" {
  name          = "my-slack-api"
  protocol_type = "HTTP"
  # …
}

module "slackbot" {
  source  = "amancevice/slackbot/aws"
  version = "~> 20.1"

  http_api_execution_arn = aws_apigatewayv2_api.http_api.execution_arn
  http_api_id            = aws_apigatewayv2_api.http_api.id
  lambda_function_name   = "my-function-name"
  role_name              = "my-role-name"
  secret_name            = module.slackbot_secrets.secret.name
  topic_name             = "my-topic-name"

  # …
}

module "slackbot_secrets" {
  source               = "amancevice/slackbot-secrets/aws"
  kms_key_alias        = "alias/slack/your-kms-key-alias"
  secret_name          = "slack/your-secret-name"
  slack_bot_token      = "your-bot-token"
  slack_client_id      = "your-client-id"
  slack_client_secret  = "your-client-secret"
  slack_signing_secret = "your-signing-secret"
  slack_user_token     = "your-user-token"

  // Optional additional secrets
  secrets = { FIZZ = "buzz" }
}
```
