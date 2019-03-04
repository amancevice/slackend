const crypto   = require('crypto');
const express  = require('express');
const request  = require('supertest');
const slackend = require('../index');

const mockaccess    = async (options) => { return {token: 'fizz'}; };
const mockaccesserr = async (options) => { return Promise.reject('BOOM'); };
const mockslack     = {oauth: {access: mockaccess}};
const mockslackerr  = {oauth: {access: mockaccesserr}};

const app = slackend({
  slack:        mockslack,
  topic_prefix: 'fizz_',
  topic_suffix: '_buzz',
}).use((req, res) => res.json(res.locals));
const err = slackend({
  slack:          mockslackerr,
  signing_secret: 'fake',
}).use((req, res) => res.json(res.locals));

describe('API | GET /oauth', function() {

  it('Completes the OAuth workflow', function(done) {
    let exp = {
      message: {token: 'fizz'},
      topic: 'oauth',
    };
    request(app)
      .get('/oauth')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });

  it('Rejects the OAuth workflow', function(done) {
    let exp = {error: 'BOOM'};
    request(err)
      .get('/oauth')
      .set('Accept', 'application/json')
      .expect(500, exp, done);
  });
});

describe('API | POST /callbacks', function() {
  it('responds with message and topic', function(done) {
    let exp = {
      message: {callback_id: 'fizz'},
      topic:   'fizz_callback_fizz_buzz',
    };
    request(app)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('API | POST /events', function() {
  it('responds with message and topic', function(done) {
    let exp = {
      message: {event: {type: 'team_join'}, type: 'event_callback'},
      topic:   'fizz_event_team_join_buzz',
    };
    request(app)
      .post('/events')
      .send({type: 'event_callback', event: {type: 'team_join'}})
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });

  it('responds with challenge', function(done) {
    request(app)
      .post('/events')
      .send({type: 'url_verification', challenge: 'fizzbuzz'})
      .set('Accept', 'application/json')
      .expect(200, {challenge: 'fizzbuzz'}, done);
  });
});

describe('API | POST /slash/:cmd', function() {
  it('responds with message and topic', function(done) {
    let exp = {
      message: {fizz: 'buzz'},
      topic:   'fizz_slash_fizz_buzz',
    };
    request(app)
      .post('/slash/fizz')
      .send('fizz=buzz')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('API | Verification', function() {
  it('Errors with bad signature', function(done) {
    request(err)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .expect(403, {error: 'Signatures do not match'}, done);
  });

  it('Errors with bad timestamp', function(done) {
    request(err)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .set('x-slack-request-timestamp', '0')
      .set('x-slack-signature', 'v0=c340868077bc902f57e4f721a98a957880c7365bea1bb1a9e6fad1a5ebc8ce9c')
      .expect(403, {error: 'Request too old'}, done);
  });

  it('Skips verification', function(done) {
    let exp = {
      message: {fizz: 'buzz'},
      topic:   'fizz_slash_fizz_buzz',
    };
    process.env.DISABLE_VERIFICATION = '1';
    request(app)
      .post('/slash/fizz')
      .send('fizz=buzz')
      .set('Accept', 'application/json')
      .expect(200, exp)
      .then(() => {
        delete process.env.DISABLE_VERIFICATION;
        done();
      })
  });

  it('Verifies the request', function(done) {
    let ts   = new Date() / 1000;
    let hmac = crypto.createHmac('sha256', 'fake');
    let data = `v0:${ts}:payload=%7B%22callback_id%22%3A%22fizz%22%7D`;
    let sig  = `v0=${hmac.update(data).digest('hex')}`;
    let exp  = {
      message: {callback_id: 'fizz'},
      topic:   'callback_fizz',
    };
    request(err)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .set('x-slack-request-timestamp', `${ts}`)
      .set('x-slack-signature', sig)
      .expect(200, exp, done);
  });
});
