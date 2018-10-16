const assert = require('assert');
const request = require('supertest');
const app = require('../index');

describe('GET /', () => {
  it('responds with empty json', (done) => {
    request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(200, {}, done);
  });
});
