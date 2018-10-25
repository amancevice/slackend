const assert = require('assert');
const request = require('supertest');
const slackend = require('../index');
slackend.app.use('/', slackend.router);

describe('GET /', () => {
  it('responds with empty json', (done) => {
    request(slackend.app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(200, {}, done);
  });
});
