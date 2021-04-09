const assert   = require('assert');
const express  = require('express');
const qs       = require('querystring');
const request  = require('supertest');
const slackend = require('../aws');

const MOCK_SECRET = {
  SLACK_CLIENT_ID:          '123456789012.123456789012',
  SLACK_CLIENT_SECRET:      '1234567890abcdef1234567890abcdef',
  SLACK_OAUTH_INSTALL_URI:  'https://slack.com/oauth/v2/authorize',
  SLACK_OAUTH_REDIRECT_URI: 'http://localhost:3000/oauth/callback',
  SLACK_OAUTH_SUCCESS_URI:  'slack://channel?team={TEAM_ID}&id={CHANNEL_ID}',
  SLACK_SIGNING_VERSION:    'v0',
  SLACK_TOKEN:              'xoxb-123456789012-abcdefghijklmnopqrstuvwx',
};

const mockRoute = (req, res, next) => {
  res.locals.slack = {
    ok:      true,
    team: { id: 'T12345678' },
    callback_id: 'fizz',
    incoming_webhook: { channel_id: 'C12345678' },
  };
  next();
};

const mockSecretsManager = {
  getSecretValue: (options) => {
    return { promise: () => Promise.resolve({ SecretString: JSON.stringify(MOCK_SECRET) }) };
  },
};

const mockEventBridge = {
  putEvents: (options) => {
    return { promise: () => Promise.resolve('EVENTBRIDGE SUCCESS!') };
  },
};

const mockEventBridgeFail = {
  putEvents: (options) => {
    return { promise: () => Promise.reject('EVENTBRIDGE ERROR!') };
  },
};

const mockSlack = {
  chat: {
    postMessage:   (options) => Promise.resolve(Object.assign(options, { type: 'in_channel' })),
    postEphemeral: (options) => Promise.resolve(Object.assign(options, { type: 'ephemeral' })),
  },
};

const blockActions   = { type: 'block_actions', actions: [ { action_id: 'my_action' } ] };
const callback       = { type: 'callback', callback_id: 'my_callback' };
const viewSubmission = { type: 'view_submission', view: { callback_id: 'my_callback' } };

let app, lambda;

describe('AWS | getApp', function() {
  before(() => { lambda = slackend({ secretsmanager: mockSecretsManager }); });

  it('Creates the app', async function() {
    const app = await lambda.getApp();
    assert.ok(app);
  });
});

describe('AWS | getEnv', function() {
  before(() => { lambda = slackend({ secretsmanager: mockSecretsManager }); });

  it('Assigns the secret to process.env', async function() {
    await lambda.getEnv();
    Object.keys(MOCK_SECRET).map((key) => {
      assert.equal(process.env[key], MOCK_SECRET[key]);
    });
  });
});

describe('AWS | getSlack', function() {
  before(() => { lambda = slackend({ secretsmanager: mockSecretsManager }); });

  it('Creates the Slack client', async function() {
    const slack = await lambda.getSlack();
    assert.equal(slack.token, MOCK_SECRET.SLACK_TOKEN);
  });
});

describe('AWS | post[Message|Ephemeral]', function() {
  before(() => { lambda = slackend({ slack: mockSlack }); });

  it('Calls slack.chat.postMessage', async function() {
    const msg = { detail: { channel: 'C1234567', text: 'Hello, world!' } };
    const ret = await lambda.postMessage(msg);
    const exp = Object.assign(msg.detail, { type: 'in_channel' });
    assert.deepEqual(ret, exp);
  });

  it('Calls slack.chat.postEphemeral', async function() {
    const msg = { detail: { channel: 'C1234567', text: 'Hello, world!' } };
    const ret = await lambda.postEphemeral(msg);
    const exp = Object.assign(msg.detail, { type: 'ephemeral' });
    assert.deepEqual(ret, exp);
  });
});

describe('AWS | publish', function() {
  it('Succeeds with 204', function(done) {
    lambda = slackend({ eventbridge: mockEventBridge });
    app = express();
    app.use(mockRoute, lambda.publish);
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(204, done);
  });

  it('Fails with 400', function(done) {
    lambda = slackend({ eventbridge: mockEventBridgeFail });
    app = express();
    app.use(mockRoute, lambda.publish);
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(400, 'EVENTBRIDGE ERROR!', done);
  });

  it('OAuth redirects to Slack', function(done) {
    lambda = slackend({ eventbridge: mockEventBridge });
    app = express();
    app.use(mockRoute, lambda.publish);
    request(app)
      .get('/oauth/v2')
      .set('accept', 'application/json')
      .expect('location', 'slack://channel?team=T12345678&id=C12345678', done);
  });
})

describe('AWS | handler', function() {
  it('Succeeds with 204', async function() {
    lambda = slackend({ secretsmanager: mockSecretsManager, eventbridge: mockEventBridge });
    const event   = { path: '/slash/fizz', httpMethod: 'POST', body: 'fizz=buzz' };
    const context = { awsRequestId: 'awsRequestId', succeed: () => {} };
    const res     = await lambda.handler(event, context);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
  });

  it('Succeeds with 204 (block_actions)', async function() {
    lambda = slackend({ secretsmanager: mockSecretsManager, eventbridge: mockEventBridge });
    const event = {
      path: '/callbacks',
      httpMethod: 'POST',
      body: `payload=${ qs.escape(JSON.stringify(blockActions)) }`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
    };
    const context = { awsRequestId: 'awsRequestId', succeed: () => {} };
    const res     = await lambda.handler(event, context);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
  });

  it('Succeeds with 204 (view_submission)', async function() {
    lambda = slackend({ secretsmanager: mockSecretsManager, eventbridge: mockEventBridge });
    const event = {
      path: '/callbacks',
      httpMethod: 'POST',
      body: `payload=${qs.escape(JSON.stringify(viewSubmission))}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
    };
    const context = { awsRequestId: 'awsRequestId', succeed: () => {} };
    const res     = await lambda.handler(event, context);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
  });

  it('Fails with 400', async function() {
    lambda = slackend({ secretsmanager: mockSecretsManager, eventbridge: mockEventBridgeFail });
    const event   = { path: '/slash/fizz', httpMethod: 'POST', body: 'fizz=buzz' };
    const context = { awsRequestId: 'awsRequestId', succeed: () => {} };
    const res     = await lambda.handler(event, context);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body, 'EVENTBRIDGE ERROR!');
  });
});
