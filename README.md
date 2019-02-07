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

## Usage

At its core, `slackend` is an [Express](https://expressjs.com) application with several routes defined for handling Slack events. None of the routes are configured to respond to the request. This is done deliberately so users can customize the behavior of the app.

The Slack message and an inferred topic name are stored in the `res.locals` object and can be used to publish the request to your preferred messaging/queueing service.

Here is an example usage that simply logs the request to the console:

```javascript
const slackend = require('slackend');

// Create express app
const app = slackend({
  client_id:       process.env.SLACK_CLIENT_ID,
  client_secret:   process.env.SLACK_CLIENT_SECRET,
  redirect_uri:    process.env.SLACK_OAUTH_REDIRECT_URI,
  signing_secret:  process.env.SLACK_SIGNING_SECRET,
  signing_version: process.env.SLACK_SIGNING_VERSION,
  token:           process.env.SLACK_TOKEN,
});

// You *must* add a callback that responds to the request
app.use((req, res) => {
  console.log(res.locals);
  res.json({ok: true});
});
```

All of the configuration options to `slackend()` are optional, but omitting the `signing_secret` will disable the verification step where received requests are confirmed as originating from Slack. Disabling verification can also be done by setting the environmental variable `DISABLE_VERIFICATION=1`.

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
  source               = "amancevice/slackbot-secrets/aws"
  kms_key_alias        = "alias/slack/your-kms-key-alias"
  secret_name          = "slack/your-secret-name"
  slack_bot_token      = "${var.slack_bot_token}"
  slack_client_id      = "${var.slack_client_id}"
  slack_client_secret  = "${var.slack_client_secret}"
  slack_signing_secret = "${var.slack_signing_secret}"
  slack_user_token     = "${var.slack_user_token}"
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
