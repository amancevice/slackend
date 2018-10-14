# Serverless Slackbot

Simple Slack app backend.

By default this app does nothing but (optionally) verify requests and log them to the console. In production this app is intended to publish messages from Slack to a messaging service like Amazon SNS, or Google Pub/Sub.

The fetching of additional/secret environmental values and the method of publication is configurable.

## Usage

Run a local instance of your slack app by cloning this repository, configuring settings, installing dependencies, and starting the express server.

Copy [`.env.example`](./.env.example) to `.env` and supply keys/settings.

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
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"callback_id": "fizz"}' \
  'http://localhost:3000/callbacks'

# Event
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"type": "event_callback", "event": {"type": "team_join"}}' \
  'http://localhost:3000/events'


# Slash command
curl -X POST -d 'fizz=buzz' 'http://localhost:3000/slash/fizz'
```

## Lambda

The [`lambda.js`](./lambda.js) script shows how to deploy the app to Lambda.

The script shows how to fetch additional environment variables using SecretsManager and publishing to SNS.

## Customization

Set app values for `fetchEnv` and `publish` to customize the app's behavior.

### Environment

Supply additional environmental variables by setting the `fetchEnv` value of the app to a function that takes no arguments and returns a promise to update and return `process.env`.

Example:

```javascript
app.set('fetchEnv', () => {
  // Update env here...
});
```

### Publishing

Set the `publish` value of the app to a function that takes a `payload` and `topic` and returns a promise to publish.

Example:

```javascript
app.set('publish', (payload, topic) => {
  // Publish your payload here...
});
```
