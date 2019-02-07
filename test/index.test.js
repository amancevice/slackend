const assert   = require('assert');
const express  = require('express');
const request  = require('supertest');
const slackend = require('../index');

const mockslackapi = {
  oauth: {
    access: async (options) => {
      return {token: 'fizz'};
    },
  },
}

const app = slackend({slackapi: mockslackapi}).use((req, res) => res.json(res.locals));
const err = slackend({signing_secret: 'fake'}).use((req, res) => res.json(res.locals));

describe('GET /oauth', () => {
  it('Completes the OAuth workflow', (done) => {
    let exp = {
      message: {token: 'fizz'},
      topic: 'oauth',
    };
    request(app)
      .get('/oauth')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('POST /callbacks', () => {
  it('responds with message and topic', (done) => {
    let exp = {
      message: {callback_id: 'fizz'},
      topic: 'callback_fizz',
    };
    request(app)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('POST /events', () => {
  it('responds with message and topic', (done) => {
    let exp = {
      message: {event: {type: 'team_join'}, type: 'event_callback'},
      topic: 'event_team_join',
    };
    request(app)
      .post('/events')
      .send({type: 'event_callback', event: {type: 'team_join'}})
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('POST /events challenge', () => {
  it('responds with challenge', (done) => {
    request(app)
      .post('/events')
      .send({type: 'url_verification', challenge: 'fizzbuzz'})
      .set('Accept', 'application/json')
      .expect(200, {challenge: 'fizzbuzz'}, done);
  });
});

describe('POST /slash/:cmd', () => {
  it('responds with message and topic', (done) => {
    let exp = {
      message: {fizz: 'buzz'},
      topic: 'slash_fizz',
    };
    request(app)
      .post('/slash/fizz')
      .send('fizz=buzz')
      .set('Accept', 'application/json')
      .expect(200, exp, done);
  });
});

describe('Signature Error', () => {
  it('Errors with bad signature', (done) => {
    request(err)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .expect(403, {error: 'Signatures do not match'}, done);
  });
});

describe('Timestamp Error', () => {
  it('Errors with bad timestamp', (done) => {
    request(err)
      .post('/callbacks')
      .send('payload=%7B%22callback_id%22%3A%22fizz%22%7D')
      .set('Accept', 'application/json')
      .set('x-slack-request-timestamp', '0')
      .set('x-slack-signature', 'v0=c340868077bc902f57e4f721a98a957880c7365bea1bb1a9e6fad1a5ebc8ce9c')
      .expect(403, {error: 'Request too old'}, done);
  });
});
