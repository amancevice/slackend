const crypto   = require('crypto');
const express  = require('express');
const qs       = require('querystring');
const request  = require('supertest');
const slackend = require('../index');

const mockslack = {
  oauth: {
    access: async (options) => { return {token: 'fizz'}; },
    v2: { access: async (options) => { return {token: 'fizz'}; }},
  }
};
const mockslackerr = {
  oauth: {
    access: async (options) => { return Promise.reject('BOOM'); },
    v2: { access: async (options) => { return Promise.reject('BOOM'); }},
  }
};

const app = (options = {}) => {
  return slackend(Object.assign({ slack: mockslack }, options))
    .use((req, res) => res.json(res.locals.slack));
};
const err = (options = {}) => {
  return slackend(Object.assign({ slack: mockslackerr, signing_secret: 'fake' }, options))
    .use((req, res) => res.json(res.locals.slack));
};

const blockActions   = { type: 'block_actions', actions: [ { action_id: 'my_action' } ] };
const callback       = { type: 'callback', callback_id: 'my_callback' };
const viewSubmission = { type: 'view_submission', view: { callback_id: 'my_callback' } };

describe('API | GET /install', function() {
  it('Responds with 302', function(done) {
    request(app())
      .get('/install')
      .expect('location', 'https://slack.com/oauth/v2/authorize', done);
  });
})

describe('API | GET /health', function() {
  it('Responds OK', function(done) {
    request(app())
      .get('/health')
      .expect(200, { ok: true }, done);
  });
})

describe('API | GET /oauth', function() {
  it('Completes the OAuth workflow', function(done) {
    let exp = { token: 'fizz' };
    request(app())
      .get('/oauth?code=buzz')
      .set('accept', 'application/json')
      .expect(200, exp, done);
  });

  it('Redirects to the OAuth error URI', function(done) {
    request(err({oauth_error_uri: 'https://example.com/error.html'}))
      .get('/oauth')
      .set('accept', 'application/json')
      .expect('location', 'https://example.com/error.html', done);
  });

  it('Rejects the OAuth workflow', function(done) {
    request(err())
      .get('/oauth?code=buzz')
      .set('accept', 'application/json')
      .expect(403, done);
  });
});

describe('API | GET /oauth/v2', function() {
  it('Completes the OAuth workflow', function(done) {
    let exp = { token: 'fizz' };
    request(app())
      .get('/oauth/v2?code=buzz')
      .set('accept', 'application/json')
      .expect(200, exp, done);
  });

  it('Redirects to the OAuth error URI', function(done) {
    request(err({ oauth_error_uri: 'https://example.com/error.html' }))
      .get('/oauth/v2')
      .set('accept', 'application/json')
      .expect('location', 'https://example.com/error.html', done);
  });

  it('Redirects to the OAuth error URI', function(done) {
    request(app({ oauth_error_uri: 'https://example.com/error.html' }))
      .get('/oauth/v2?error=fizz')
      .set('accept', 'application/json')
      .expect('location', 'https://example.com/error.html', done);
  });

  it('Rejects the OAuth workflow', function(done) {
    request(err())
      .get('/oauth/v2?code=buzz')
      .set('accept', 'application/json')
      .expect(403, done);
  });
});

describe('API | POST /callbacks', function() {
  it('Responds with message and topic', function(done) {
    request(app())
      .post('/callbacks')
      .send(`payload=${ qs.escape(JSON.stringify(callback)) }`)
      .set('accept', 'application/json')
      .expect(200, callback, done);
  });

  it('Responds with message and topic (block_actions)', function(done) {
    request(app())
      .post('/callbacks')
      .send(`payload=${ qs.escape(JSON.stringify(blockActions)) }`)
      .set('accept', 'application/json')
      .expect(200, blockActions, done);
  });

  it('Responds with message and topic (view)', function(done) {
    request(app())
      .post('/callbacks')
      .send(`payload=${ qs.escape(JSON.stringify(viewSubmission)) }`)
      .set('accept', 'application/json')
      .expect(200, viewSubmission, done);
  });
});

describe('API | POST /events', function() {
  it('Responds with message and topic', function(done) {
    let exp = { event: { type: 'team_join' }, type: 'event_callback' };
    request(app())
      .post('/events')
      .send({ type: 'event_callback', event: { type: 'team_join' } })
      .set('accept', 'application/json')
      .expect(200, exp, done);
  });

  it('Responds with challenge', function(done) {
    request(app())
      .post('/events')
      .send({ type: 'url_verification', challenge: 'fizzbuzz' })
      .set('Accept', 'application/json')
      .expect(200, { challenge: 'fizzbuzz' }, done);
  });
});

describe('API | POST /slash/:cmd', function() {
  it('Responds with message and topic', function(done) {
    let exp = { fizz: 'buzz' };
    request(app())
      .post('/slash/fizz')
      .send('fizz=buzz')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('API | Verification', function() {
  it('Errors with bad signature', function(done) {
    request(err())
      .post('/callbacks')
      .send(`payload=${ qs.escape(JSON.stringify(blockActions)) }`)
      .set('Accept', 'application/json')
      .expect(403, {error: 'Signatures do not match'}, done);
  });

  it('Errors with bad timestamp', function(done) {
    request(err())
      .post('/callbacks')
      .send(`payload=${ qs.escape(JSON.stringify(blockActions)) }`)
      .set('Accept', 'application/json')
      .set('x-slack-request-timestamp', '0')
      .set('x-slack-signature', 'v0=c340868077bc902f57e4f721a98a957880c7365bea1bb1a9e6fad1a5ebc8ce9c')
      .expect(403, { error: 'Request too old' }, done);
  });

  it('Skips verification', function(done) {
    let exp = { fizz: 'buzz' };
    process.env.SLACK_DISABLE_VERIFICATION = '1';
    request(app())
      .post('/slash/fizz')
      .send('fizz=buzz')
      .set('Accept', 'application/json')
      .expect(200, exp)
      .then(() => {
        delete process.env.SLACK_DISABLE_VERIFICATION;
        done();
      })
  });

  it('Verifies the request', function(done) {
    let ts   = new Date() / 1000;
    let hmac = crypto.createHmac('sha256', 'fake');
    let data = `v0:${ ts }:payload=${ qs.escape(JSON.stringify(blockActions)) }`;
    let sig  = `v0=${ hmac.update(data).digest('hex') }`;
    request(err())
      .post('/callbacks')
      .send(`payload=${ qs.escape(JSON.stringify(blockActions)) }`)
      .set('Accept', 'application/json')
      .set('x-slack-request-timestamp', `${ ts }`)
      .set('x-slack-signature', sig)
      .expect(200, blockActions, done);
  });
});
