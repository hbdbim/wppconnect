import * as sessionmanager from '../controllers/sessionmanager';
import * as assert from 'assert';
import { sleep } from '../utils/sleep';

describe('Session Manager test', function () {
  this.timeout(20000);

  it('Get All Session Names', async function () {
    const result = await sessionmanager.getSessionNames();
    assert.ok(result);
  });

  it('Init All Sessions', async function () {
    const result = await sessionmanager.initAllSessions();
    assert.ok(result);
  });
});
