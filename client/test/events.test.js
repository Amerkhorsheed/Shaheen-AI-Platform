import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockBrowser } from './setup.js';
import {
  SESSION_ENDED_EVENT,
  PASSWORD_CHANGE_EVENT,
  announce,
  announceSessionEnded,
  announcePasswordChangeRequired,
  subscribe
} from '../src/services/core/events.js';

describe('events.js service', () => {
  let env;

  beforeEach(() => {
    env = setupMockBrowser();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('exports valid event constants', () => {
    assert.equal(SESSION_ENDED_EVENT, 'shaheen:session-ended');
    assert.equal(PASSWORD_CHANGE_EVENT, 'shaheen:password-change-required');
  });

  it('announces events with custom details when window is present', () => {
    let captured = null;
    env.listeners.set(SESSION_ENDED_EVENT, [(e) => { captured = e.detail; }]);

    announce(SESSION_ENDED_EVENT, { reason: 'Token expired' });
    assert.deepEqual(captured, { reason: 'Token expired' });
  });

  it('announces events with default empty detail parameter', () => {
    let captured = null;
    env.listeners.set('custom:event', [(e) => { captured = e.detail; }]);

    announce('custom:event');
    assert.deepEqual(captured, {});
  });

  it('handles announce when window is undefined', () => {
    const origWindow = globalThis.window;
    delete globalThis.window;
    try {
      assert.doesNotThrow(() => announce(SESSION_ENDED_EVENT));
    } finally {
      globalThis.window = origWindow;
    }
  });

  it('announces session ended with reason', () => {
    let captured = null;
    env.listeners.set(SESSION_ENDED_EVENT, [(e) => { captured = e.detail; }]);

    announceSessionEnded('Session expired');
    assert.deepEqual(captured, { reason: 'Session expired' });
  });

  it('announces password change required with reason', () => {
    let captured = null;
    env.listeners.set(PASSWORD_CHANGE_EVENT, [(e) => { captured = e.detail; }]);

    announcePasswordChangeRequired('Mandatory update');
    assert.deepEqual(captured, { reason: 'Mandatory update' });
  });

  it('subscribes and unsubscribes from events when window is defined', () => {
    let callCount = 0;
    let received = null;

    const unsubscribe = subscribe('test:sub', (detail) => {
      callCount++;
      received = detail;
    });

    announce('test:sub', { val: 42 });
    assert.equal(callCount, 1);
    assert.deepEqual(received, { val: 42 });

    unsubscribe();
    announce('test:sub', { val: 99 });
    assert.equal(callCount, 1);
  });

  it('returns a no-op function when window is undefined in subscribe', () => {
    const origWindow = globalThis.window;
    delete globalThis.window;
    try {
      const unsub = subscribe('test:sub', () => {});
      assert.equal(typeof unsub, 'function');
      assert.doesNotThrow(() => unsub());
    } finally {
      globalThis.window = origWindow;
    }
  });
});
