process.env.NODE_ENV = 'test';

const assert   = require('assert');
const express  = require('express');
const request  = require('supertest');
const slackend = require('../aws');

const app = express();
app.use((req, res, next) => {
  res.locals.topic   = 'slack_test_topic';
  res.locals.message = {ok: true};
  next();
});

const MOCK_SECRET = {
  SLACK_CLIENT_ID:               '123456789012.123456789012',
  SLACK_CLIENT_SECRET:           '1234567890abcdef1234567890abcdef',
  SLACK_OAUTH_REDIRECT_URI:      'http://localhost:3000/oauth/callback',
  SLACK_SIGNING_SECRET:          '1234567890abcdef1234567890abcdef',
  SLACK_SIGNING_VERSION:         'v0',
  SLACK_TOKEN:                   'xoxb-123456789012-abcdefghijklmnopqrstuvwx',
  SLACKEND_DISABLE_VERIFICATION: '1',
};

const mockSecretsManager = {
  getSecretValue: (options) => {
    return {
      promise: () => Promise.resolve({SecretString: JSON.stringify(MOCK_SECRET)}),
    };
  },
};

const mockSns = {
  publish: (options) => {
    return {
      promise: () => Promise.resolve({ok: true}),
    };
  },
};

const mockSnsFail = {
  publish: (options) => {
    return {
      promise: () => Promise.reject({ok: false}),
    };
  },
};

const mockSlack = {
  chat: {
    postMessage:   (options) => Promise.resolve(Object.assign(options, {type: 'in_channel'})),
    postEphemeral: (options) => Promise.resolve(Object.assign(options, {type: 'ephemeral'})),
  },
};

slackend.clients.secretsmanager = mockSecretsManager;
slackend.clients.sns            = mockSns;
slackend.clients.slack          = mockSlack;

describe('AWS | getEnv', function() {
  it('Assigns the secret to process.env', async function() {
    await slackend.getEnv({SecretId: 'slack/fizz'});
    Object.keys(MOCK_SECRET).map((key) => {
      assert.equal(process.env[key], MOCK_SECRET[key]);
    });
  });
});

describe('AWS | post[Message|Ephemeral]', function() {
  it('Calls slack.chat.postMessage', async function() {
    const msg = {channel: 'C1234567', text: 'Hello, world!'};
    const ret = await slackend.postMessage({Records: [{Sns: {Message: JSON.stringify(msg)}}]});
    const exp = [Object.assign(msg, {type: 'in_channel'})];
    assert.deepEqual(ret, exp);
  });

  it('Calls slack.chat.postEphemeral', async function() {
    const msg = {channel: 'C1234567', text: 'Hello, world!'};
    const ret = await slackend.postEphemeral({Records: [{Sns: {Message: JSON.stringify(msg)}}]});
    const exp = [Object.assign(msg, {type: 'ephemeral'})];
    assert.deepEqual(ret, exp);
  });
});

describe('AWS | Publish SNS', function() {
  after(() => { slackend.clients.sns = mockSns; });

  it('Succeeds', function(done) {
    app.use(slackend.publish);
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(204, done);
  });

  it('Fails', function(done) {
    slackend.clients.sns = mockSnsFail;
    app.use(slackend.publish);
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(400, done);
  });
})

describe('AWS | Handler', function() {
  it('Handles the request', async function() {
    const event   = {path: '/fizz', httpMethod: 'POST'};
    const context = {succeed: () => {}};
    const ret     = await slackend.handler(event, context);
    assert.equal(ret.statusCode, 204);
    assert.equal(ret.body, '');
    slackend.server.close();
  });
});
