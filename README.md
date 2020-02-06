# Asynchronous Slackbot

[![Build Status](https://travis-ci.com/amancevice/slackend.svg?branch=master)](https://travis-ci.com/amancevice/slackend)
[![NPM Version](https://badge.fury.io/js/slackend.svg)](https://badge.fury.io/js/slackend)
[![Test Coverage](https://api.codeclimate.com/v1/badges/1648179274faf0e45541/test_coverage)](https://codeclimate.com/github/amancevice/slackend/test_coverage)
[![Maintainability](https://api.codeclimate.com/v1/badges/1648179274faf0e45541/maintainability)](https://codeclimate.com/github/amancevice/slackend/maintainability)

A simple, asynchronous back end for your Slack app.

The app intentionally does very little: it is essentially middleware for [ExpressJS](https://expressjs.com) that accepts an incoming request, verifies its origin, and passes the request to a user-provided callback, where the payload is sent to a queue/trigger for asynchronous processing.

Endpoints are provided for:

- `/callbacks` publishes [interactive messages](https://api.slack.com/interactive-messages)
- `/events` publishes events from the [Events API](https://api.slack.com/events-api)
- `/oauth` completes the [OAuth2](https://api.slack.com/docs/oauth) workflow
- `/slash/:cmd` publishes [slash commands](https://api.slack.com/slash-commands)

In production it is expected that users will attach their own publishing functions to connect to a messaging service like [Amazon SNS](https://aws.amazon.com/sns/), or [Google Pub/Sub](https://cloud.google.com/pubsub/docs/).

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

In very simple terms, all events are processed by:

- Extracting `type` and `id` fields from the POST payload.
- Nesting the payload in a new JSON object containing the `type`, `id`, and `message` fields.
- Forwarding the new payload to your processing topic/queue

The general idea is to infer some kind of routing logic from the request.

The `type` field's value is taken from the path of the original request and will be one of `callback`, `event`, `oauth`, or `slash`.

The following table illustrates how the `type` and `id` field's respective values are calculated:

| Endpoint      | Type       | ID Recipe       |
|:------------- |:---------- |:--------------- |
| `/callbacks`  | `callback` | `$.callback_id` |
| `/events`     | `event`    | `$.event.type`  |
| `/oauth`      | `oauth`    | `$.code`        |
| `/slash/:cmd` | `slash`    | `:cmd`          |

The processed payload is stored in the `slack` variable of the express response locals.

Here is an example configuration that simply responds to incoming requests with the processed payload:

```javascript
const express = require('express');
const slackend = require('slackend');
const app = express();
app.use(slackend(), (req, res) => { res.json(res.locals.slack); });
app.listen(3000);
```

## Example Events

The following examples illustrate how different kinds of events from Slack are processed.

### Callbacks

A callback event occurs when a user initiates any [App Action](https://api.slack.com/reference/interaction-payloads/actions), like pushing a button or choosing a menu item.

Callback payloads are passed as a query string parameter of the POST.

Example incoming payload:

```javascript
// curl -X POST /callbacks?payload=...
{
  token: 'Nj2rfC2hU8mAfgaJLemZgO7H',
  callback_id: 'chirp_message',
  type: 'message_action',
  trigger_id: '13345224609.8534564800.6f8ab1f53e13d0cd15f96106292d5536',
  response_url: 'https://hooks.slack.com/app-actions/T0MJR11A4/21974584944/yk1S9ndf35Q1flupVG5JbpM6',
  team: {
    id: 'T0MJRM1A7',
    domain: 'pandamonium',
  },
  channel: {
    id: 'D0LFFBKLZ',
    name: 'cats'
  },
  user: {
    id: 'U0D15K92L',
    name: 'dr_maomao'
  },
  message: {
    type: 'message',
    user: 'U0MJRG1AL',
    ts: '1516229207.000133',
    text: "World's smallest big cat! <https://youtube.com/watch?v=W86cTIoMv2U>"
  }
}
```

Processed payload to forward:

```javascript
{
  type: 'callback',    // Slack event type
  id: 'chirp_message', // Taken from $.callback_id in payload
  message: { /* … */ } // Original incoming payload
}
```

### Events

Events are triggered by the [Events API](https://api.slack.com/events-api) when a particular activity happens on Slack, like the creation or deletion of a channel, or a reaction being added to a message; almost everything is traceable using the Events API.

Events are sent as JSON in the body of a POST request.

Example incoming payload:

```javascript
// curl -X POST -d '{...}' /events
{
  token: 'XXYYZZ',
  team_id: 'TXXXXXXXX',
  api_app_id: 'AXXXXXXXXX',
  event: {
    type: 'name_of_event',
    event_ts: '1234567890.123456',
    user: 'UXXXXXXX1',
    '...': '...'
  },
  type: 'event_callback',
  authed_users: [
    'UXXXXXXX1',
    'UXXXXXXX2'
  ],
  event_id: 'Ev08MFMKH6',
  event_time: 1234567890
}
```

Processed payload to forward:

```javascript
{
  type: 'event',       // Slack event type
  id: 'name_of_event', // Taken from $event.type in payload
  message: { /* … */ } // Original incoming payload
}
```

### OAuth

*TBD*

### Slash Commands

[Slash commands](https://api.slack.com/slash-commands) are triggered by users posting a message that begins with the character `/`. Every custom slash command you configure requires its own URL to be configured in your Slack App.

Slash command payloads are sent as a query string in the body of the POST request. The name of the slash command is extracted from the final item in the request URL path.

Example incoming payload:

```javascript
// curl -X POST -d '...' /slash/weather
{
  token:'gIkuvaNzQIHg97ATvDxqgjtO',
  team_id: 'T0001',
  team_domain: 'example',
  enterprise_id: 'E0001',
  enterprise_name: 'Globular Construct Inc',
  channel_id: 'C2147483705',
  channel_name: 'test',
  user_id: 'U2147483697',
  user_name: 'Steve',
  command: '/weather',
  text: '94070',
  response_url: 'https://hooks.slack.com/commands/1234/5678',
  trigger_id: '13345224609.738474920.8088930838d88f008e0'
}
```

Processed payload to forward:

```javascript
{
  type: 'slash',       // Slack event type
  id: 'weather',       // Taken from request URL
  message: { /* … */ } // Original incoming payload
}
```

## Serverless Deployment

<img alt="AWS" src="./docs/aws.png" width=640/>

Deploying a version of this app to Amazon Web Services (AWS) serverless offerings might take the above shape, where incoming requests from Slack to your app are handled as follows:

**API Gateway** receives and routes all requests using the catchall `/{proxy+}` resource and processed using a single **Lambda function** integration.

On cold starts, the **Lambda function** pulls its Slack tokens/secrets from its encrypted **SecretsManager** secret, starts a proxy express server, and publishes the request to an **SNS topic** where it is sorted and subscribers are notified.

On warm starts the environment and server are cached and the request is published to **SNS** without needing to re-fetch the app secrets.

Once the request &mdash; an OAuth request, a workspace event, a user-initiated callback, or a custom slash command &mdash; is published, the API responds to Slack with a `204 - No Content` status code.

If the topic does not exist, the API responds with a `400 - Bad Request` status code.

Using this method, each feature of your app can be added one-by-one independently of the API and is highly scalable.

## NodeJS Usage

At its core, `slackend` is middleware for [ExpressJS](https://expressjs.com) with several routes predefined for handling Slack messages. None of the routes are configured to respond to the request. This is done deliberately so users can customize the behavior of the app.

The Slack message and an inferred topic name are stored in the `res.locals` object and can be used to publish the request to your preferred messaging/queueing service.

Here is an example usage that simply logs the request to the console:

```javascript
const slackend = require('slackend');

// Create express app
const app = slackend({
  client_id:          process.env.SLACK_CLIENT_ID,
  client_secret:      process.env.SLACK_CLIENT_SECRET,
  oauth_error_uri:    process.env.SLACK_OAUTH_ERROR_URI,
  oauth_redirect_uri: process.env.SLACK_OAUTH_REDIRECT_URI,
  oauth_success_uri:  process.env.SLACK_OAUTH_SUCCESS_URI,
  signing_secret:     process.env.SLACK_SIGNING_SECRET,
  signing_version:    process.env.SLACK_SIGNING_VERSION,
  token:              process.env.SLACK_TOKEN,
});

// You *must* add a callback that responds to the request
app.use((req, res) => {
  console.log(res.locals);
  res.json({ok: true});
});
```

*WARNING &mdash; All of the configuration options to `slackend()` are optional, but omitting the `signing_secret` will disable the verification step where received requests are confirmed as originating from Slack. Disabling verification can also be done by setting the environmental variable `DISABLE_VERIFICATION=1`.*

## Local Development

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

## AWS

A module is provided to deploy to Lambda using SecretsManager to store the Slack secrets.

Example Lambda handler:

```javascript
const slackend = require('slackend/aws');
module.exports = slackend();
```

## Deploy with Terraform

Deploy directly to AWS using [`terraform`](https://terraform.io) and the [`slackbot`](https://github.com/amancevice/terraform-aws-slackbot) + [`slackbot-secrets`](https://github.com/amancevice/terraform-aws-slackbot-secrets) modules:


```hcl
module slackbot_secret {
  source               = "amancevice/slackbot-secrets/aws"
  kms_key_alias        = "alias/slack/your-kms-key-alias"
  secret_name          = "slack/your-secret-name"
  slack_bot_token      = var.slack_bot_token
  slack_client_id      = var.slack_client_id
  slack_client_secret  = var.slack_client_secret
  slack_signing_secret = var.slack_signing_secret
  slack_user_token     = var.slack_user_token

  // Optional additional secrets
  secrets = {
    FIZZ = "buzz"
  }
}

module slackbot {
  source          = "amancevice/slackbot/aws"
  api_description = "My Slack REST API"
  api_name        = "<my-api-name>"
  api_stage_name  = "<my-api-stage>"
  secret_name     = module.slackbot_secrets.secret_name
  kms_key_id      = module.slackbot_secret.kms_key_id
}
```
