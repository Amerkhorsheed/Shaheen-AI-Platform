import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockBrowser } from './setup.js';
import { storage } from '../src/services/core/storage.js';

describe('storage.js service', () => {
  let env;

  beforeEach(() => {
    env = setupMockBrowser();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('gets, sets, and removes token', () => {
    assert.equal(storage.getToken(), null);

    storage.setToken('test-jwt-token');
    assert.equal(storage.getToken(), 'test-jwt-token');
    assert.equal(env.store.get('shaheen_token'), 'test-jwt-token');

    // Passing empty or null token removes it
    storage.setToken('');
    assert.equal(storage.getToken(), null);

    storage.setToken('another-token');
    storage.removeToken();
    assert.equal(storage.getToken(), null);
  });

  it('safely handles errors in getToken, setToken, and removeToken', () => {
    // Force localStorage.getItem to throw
    globalThis.localStorage.getItem = () => {
      throw new Error('Access denied');
    };
    assert.equal(storage.getToken(), null);

    // Force localStorage.setItem to throw
    globalThis.localStorage.setItem = () => {
      throw new Error('Quota exceeded');
    };
    assert.doesNotThrow(() => storage.setToken('will-fail'));

    // Force localStorage.removeItem to throw
    globalThis.localStorage.removeItem = () => {
      throw new Error('Storage corrupted');
    };
    assert.doesNotThrow(() => storage.removeToken());
  });

  it('gets, sets, and removes user profiles', () => {
    assert.equal(storage.getUser(), null);

    const userObj = { id: 1, username: 'admin', role: 'superadmin' };
    storage.setUser(userObj);
    assert.deepEqual(storage.getUser(), userObj);

    // Setting falsy user removes user
    storage.setUser(null);
    assert.equal(storage.getUser(), null);

    storage.setUser(userObj);
    storage.removeUser();
    assert.equal(storage.getUser(), null);
  });

  it('safely handles corrupted user JSON or storage errors in getUser, setUser, removeUser', () => {
    // Corrupted JSON in localStorage
    env.store.set('shaheen_user', 'invalid-json-{[}');
    assert.equal(storage.getUser(), null);

    // Force localStorage.getItem to throw
    globalThis.localStorage.getItem = () => {
      throw new Error('Blocked');
    };
    assert.equal(storage.getUser(), null);

    // Force localStorage.setItem to throw
    globalThis.localStorage.setItem = () => {
      throw new Error('Quota exceeded');
    };
    assert.doesNotThrow(() => storage.setUser({ id: 2 }));

    // Force localStorage.removeItem to throw
    globalThis.localStorage.removeItem = () => {
      throw new Error('Storage error');
    };
    assert.doesNotThrow(() => storage.removeUser());
  });

  it('clears active session completely', () => {
    storage.setToken('session-token');
    storage.setUser({ username: 'officer1' });

    assert.equal(storage.getToken(), 'session-token');
    assert.equal(storage.getUser().username, 'officer1');

    storage.clearSession();
    assert.equal(storage.getToken(), null);
    assert.equal(storage.getUser(), null);
  });
});
