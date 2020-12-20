const assert   = require('assert');
const express  = require('express');
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
    topic: 'slack_test_topic',
    callback_id: 'fizz',
    message: {
      ok:      true,
      team: { id: 'T12345678' },
      callback_id: 'fizz',
      incoming_webhook: { channel_id: 'C12345678' },
    },
  };
  next();
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
      promise: () => Promise.resolve('SNS SUCCESS!'),
    };
  },
};

const mockSnsFail = {
  publish: (options) => {
    return {
      promise: () => Promise.reject('SNS ERROR!'),
    };
  },
};

const mockSlack = {
  chat: {
    postMessage:   (options) => Promise.resolve(Object.assign(options, {type: 'in_channel'})),
    postEphemeral: (options) => Promise.resolve(Object.assign(options, {type: 'ephemeral'})),
  },
};

let app, lambda;

describe('AWS | getApp', function() {
  before(() => { lambda = slackend({secretsmanager: mockSecretsManager}); });

  it('Creates the app', async function() {
    const app = await lambda.getApp();
    assert.ok(app);
  });
});

describe('AWS | getEnv', function() {
  before(() => { lambda = slackend({secretsmanager: mockSecretsManager}); });

  it('Assigns the secret to process.env', async function() {
    await lambda.getEnv();
    Object.keys(MOCK_SECRET).map((key) => {
      assert.equal(process.env[key], MOCK_SECRET[key]);
    });
  });
});

describe('AWS | getSlack', function() {
  before(() => { lambda = slackend({secretsmanager: mockSecretsManager}); });

  it('Creates the Slack client', async function() {
    const slack = await lambda.getSlack();
    assert.equal(slack.token, MOCK_SECRET.SLACK_TOKEN);
  });
});

describe('AWS | post[Message|Ephemeral]', function() {
  before(() => { lambda = slackend({slack: mockSlack}); });

  it('Calls slack.chat.postMessage', async function() {
    const msg = {channel: 'C1234567', text: 'Hello, world!'};
    const sns = {Records: [{Sns: {Message: JSON.stringify(msg)}}]};
    const ret = await lambda.postMessage(sns);
    const exp = [Object.assign(msg, {type: 'in_channel'})];
    assert.deepEqual(ret, exp);
  });

  it('Calls slack.chat.postEphemeral', async function() {
    const msg = {channel: 'C1234567', text: 'Hello, world!'};
    const sns = {Records: [{Sns: {Message: JSON.stringify(msg)}}]};
    const ret = await lambda.postEphemeral(sns);
    const exp = [Object.assign(msg, {type: 'ephemeral'})];
    assert.deepEqual(ret, exp);
  });
});

describe('AWS | publish', function() {
  it('Succeeds with 204', function(done) {
    lambda = slackend({sns: mockSns});
    app = express();
    app.use(mockRoute, lambda.publish);
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(204, done);
  });

  it('Fails with 400', function(done) {
    lambda = slackend({sns: mockSnsFail});
    app = express();
    app.use(mockRoute, lambda.publish);
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(400, 'SNS ERROR!', done);
  });

  it('OAuth redirects to Slack', function(done) {
    lambda = slackend({sns: mockSns});
    app = express();
    app.use(mockRoute, lambda.publish);
    request(app)
      .get('/oauth/v2')
      .set('Accept', 'application/json')
      .expect('Location', 'slack://channel?team=T12345678&id=C12345678', done);
  });
})

describe('AWS | handler', function() {
  it('Succeeds with 204', async function() {
    lambda = slackend({secretsmanager: mockSecretsManager, sns: mockSns});
    const event   = {path: '/slash/fizz', httpMethod: 'POST', body: 'fizz=buzz'};
    const context = {succeed: () => {}};
    const res     = await lambda.handler(event, context);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');

  });

  it('Fails with 400', async function() {
    lambda = slackend({secretsmanager: mockSecretsManager, sns: mockSnsFail});
    const event   = {path: '/slash/fizz', httpMethod: 'POST', body: 'fizz=buzz'};
    const context = {succeed: () => {}};
    const res     = await lambda.handler(event, context);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body, 'SNS ERROR!');
  });
});
