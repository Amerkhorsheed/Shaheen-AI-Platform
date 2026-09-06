import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockBrowser } from './setup.js';
import { HttpClient, http, API_BASE } from '../src/services/core/httpClient.js';
import { storage } from '../src/services/core/storage.js';
import { SESSION_ENDED_EVENT, PASSWORD_CHANGE_EVENT } from '../src/services/core/events.js';
import { ApiError } from '../src/services/core/errors.js';

describe('httpClient.js service', () => {
  let env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env = setupMockBrowser();
  });

  afterEach(() => {
    env.cleanup();
    globalThis.fetch = originalFetch;
  });

  it('initializes with default and custom base URLs', () => {
    assert.equal(http.baseUrl, API_BASE);
    const custom = new HttpClient('/custom-api');
    assert.equal(custom.baseUrl, '/custom-api');
  });

  it('builds headers correctly with token and content-type options', () => {
    const client = new HttpClient();

    // 1. Without token, isJson = true
    const h1 = client.getHeaders();
    assert.equal(h1['Content-Type'], 'application/json');
    assert.equal(h1['Authorization'], undefined);

    // 2. With token in storage
    storage.setToken('mock-jwt-token');
    const h2 = client.getHeaders();
    assert.equal(h2['Authorization'], 'Bearer mock-jwt-token');
    assert.equal(h2['Content-Type'], 'application/json');

    // 3. isJson = false
    const h3 = client.getHeaders({}, false);
    assert.equal(h3['Content-Type'], undefined);
    assert.equal(h3['Authorization'], 'Bearer mock-jwt-token');

    // 4. Custom existing Authorization & Content-Type
    const h4 = client.getHeaders({
      headers: {
        Authorization: 'Custom Auth',
        'Content-Type': 'text/plain'
      }
    });
    assert.equal(h4['Authorization'], 'Custom Auth');
    assert.equal(h4['Content-Type'], 'text/plain');
  });

  it('handles successful requests with path normalization', async () => {
    const client = new HttpClient('/api');
    let requestedUrl = '';

    globalThis.fetch = async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    // With leading slash
    const res1 = await client.request('/test');
    assert.equal(requestedUrl, '/api/test');
    assert.ok(res1.ok);

    // Without leading slash
    const res2 = await client.request('test');
    assert.equal(requestedUrl, '/api/test');
    assert.ok(res2.ok);
  });

  it('handles 401 unauthorized and announces session ended for standard routes', async () => {
    const client = new HttpClient('/api');
    storage.setToken('active-token');
    storage.setUser({ username: 'user1' });

    let sessionEndedReason = null;
    env.listeners.set(SESSION_ENDED_EVENT, [(e) => { sessionEndedReason = e.detail?.reason; }]);

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: 'جلسة منتهية' }), { status: 401 });
    };

    await assert.rejects(
      async () => client.request('/chats'),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 401);
        assert.equal(err.message, 'جلسة منتهية');
        return true;
      }
    );

    assert.equal(storage.getToken(), null);
    assert.equal(storage.getUser(), null);
    assert.equal(sessionEndedReason, 'جلسة منتهية');
  });

  it('handles 401 on login route without announcing session ended', async () => {
    const client = new HttpClient('/api');
    let sessionEndedCalled = false;
    env.listeners.set(SESSION_ENDED_EVENT, [() => { sessionEndedCalled = true; }]);

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: 'بيانات غير صحيحة' }), { status: 401 });
    };

    await assert.rejects(
      async () => client.request('/auth/login'),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );

    assert.equal(sessionEndedCalled, false);
  });

  it('handles 403 PASSWORD_CHANGE_REQUIRED and announces password change event', async () => {
    const client = new HttpClient('/api');
    let passwordChangeAnnounced = false;
    env.listeners.set(PASSWORD_CHANGE_EVENT, [() => { passwordChangeAnnounced = true; }]);

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ error: 'كلمة المرور منتهية', code: 'PASSWORD_CHANGE_REQUIRED' }),
        { status: 403 }
      );
    };

    await assert.rejects(
      async () => client.request('/me'),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'PASSWORD_CHANGE_REQUIRED');
        return true;
      }
    );

    assert.equal(passwordChangeAnnounced, true);
  });

  it('handles non-JSON error response bodies gracefully', async () => {
    const client = new HttpClient('/api');

    globalThis.fetch = async () => {
      return new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      });
    };

    await assert.rejects(
      async () => client.request('/some/route'),
      (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.message, 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً');
        return true;
      }
    );
  });

  it('executes GET requests returning parsed JSON', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.equal(opts.method, 'GET');
      return new Response(JSON.stringify({ items: [1, 2, 3] }), { status: 200 });
    };

    const data = await http.get('/items');
    assert.deepEqual(data, { items: [1, 2, 3] });
  });

  it('executes POST requests with JSON body, FormData body, and empty body', async () => {
    let capturedBody = null;
    let capturedHeaders = null;

    globalThis.fetch = async (url, opts) => {
      capturedBody = opts.body;
      capturedHeaders = opts.headers;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    // 1. JSON object body
    const r1 = await http.post('/items', { name: 'Item1' });
    assert.deepEqual(r1, { success: true });
    assert.equal(capturedBody, JSON.stringify({ name: 'Item1' }));
    assert.equal(capturedHeaders['Content-Type'], 'application/json');

    // 2. FormData body
    const fd = new FormData();
    fd.append('file', 'test');
    await http.post('/upload', fd);
    assert.equal(capturedBody, fd);
    assert.equal(capturedHeaders['Content-Type'], undefined);

    // 3. Undefined body
    await http.post('/action');
    assert.equal(capturedBody, undefined);

    // 4. Non-JSON response falling back to empty object
    globalThis.fetch = async () => new Response('Created', { status: 201 });
    const r4 = await http.post('/empty-res');
    assert.deepEqual(r4, {});
  });

  it('executes PUT requests with JSON body, FormData body, and empty body', async () => {
    let capturedBody = null;
    let capturedHeaders = null;

    globalThis.fetch = async (url, opts) => {
      capturedBody = opts.body;
      capturedHeaders = opts.headers;
      return new Response(JSON.stringify({ updated: true }), { status: 200 });
    };

    // 1. JSON body
    const r1 = await http.put('/items/1', { name: 'NewName' });
    assert.deepEqual(r1, { updated: true });
    assert.equal(capturedBody, JSON.stringify({ name: 'NewName' }));

    // 2. FormData body
    const fd = new FormData();
    await http.put('/items/1/file', fd);
    assert.equal(capturedBody, fd);
    assert.equal(capturedHeaders['Content-Type'], undefined);

    // 3. Undefined body
    await http.put('/items/1/ping');
    assert.equal(capturedBody, undefined);

    // 4. Non-JSON response
    globalThis.fetch = async () => new Response('Updated', { status: 200 });
    const r4 = await http.put('/items/1/non-json');
    assert.deepEqual(r4, {});
  });

  it('executes DELETE requests handling JSON and non-JSON responses', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.equal(opts.method, 'DELETE');
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    };

    const r1 = await http.delete('/items/1');
    assert.deepEqual(r1, { deleted: true });

    // Non-JSON response falling back to empty object
    globalThis.fetch = async () => new Response(null, { status: 204 });
    const r2 = await http.delete('/items/2');
    assert.deepEqual(r2, {});
  });

  it('executes upload with FormData', async () => {
    const fd = new FormData();
    fd.append('doc', 'blob-data');

    globalThis.fetch = async (url, opts) => {
      assert.equal(opts.method, 'POST');
      assert.equal(opts.body, fd);
      return new Response(JSON.stringify({ files: [{ id: 1 }] }), { status: 200 });
    };

    const res = await http.upload('/upload', fd);
    assert.deepEqual(res, { files: [{ id: 1 }] });
  });

  it('executes raw requests returning native Response', async () => {
    globalThis.fetch = async () => new Response('raw-stream-content', { status: 200 });

    const raw = await http.raw('/stream');
    assert.equal(await raw.text(), 'raw-stream-content');
  });
});
