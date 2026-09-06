'use strict';

/**
 * End-to-End Client/Server Integration Test Suite.
 *
 * Verifies that the client service contracts and server API routes
 * cooperate properly over live HTTP requests:
 * 1. Health & Server Info
 * 2. Auth Flow (login, token validation, user profile retrieval)
 * 3. Institutional Categories
 * 4. Document Templates
 * 5. Prompt Engineering Library & Charters
 * 6. Chat Lifecycle & Pinning (verifying both boolean and integer 0/1 compatibility)
 * 7. LLM Model Discovery & Chat Payload Structure
 * 8. Export Ticket Generation
 * 9. Settings Configuration
 */

const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';

let authToken = '';
let testChatId = '';

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (body !== undefined && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  if (token) {
    reqHeaders.Authorization = 'Bearer ' + token;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // raw text
  }

  return { status: res.status, headers: res.headers, json, text };
}

test('Client/Server Integration: System Health', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.database, 'up');
});

test('Client/Server Integration: Authentication & Profile', async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const bcrypt = require('bcryptjs');
  
  const testUsername = 'int_tester_' + Date.now();
  const testPass = 'IntTest-Pass-2026!';
  const cat = await pool.query('SELECT id, name FROM categories LIMIT 1');
  await pool.query(
    'INSERT INTO users (username, password_hash, display_name, role, department, category_id, job_title, status, must_change_password, token_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 1)',
    [testUsername, bcrypt.hashSync(testPass, 10), 'Integration Tester', 'superadmin', cat.rows[0].name, cat.rows[0].id, 'Tester', 'active']
  );

  const res = await request('/api/auth/login', {
    method: 'POST',
    body: { username: testUsername, password: testPass }
  });
  assert.equal(res.status, 200, `Login failed: ${res.text}`);
  assert.ok(res.json.token, 'Token must be present');
  assert.equal(res.json.user.username, testUsername);
  authToken = res.json.token;

  const meRes = await request('/api/auth/me', { token: authToken });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.json.username, testUsername);
  assert.ok(meRes.json.categoryName);

  await pool.end();
});

test('Client/Server Integration: Categories & Templates', async () => {
  const catRes = await request('/api/categories', { token: authToken });
  assert.equal(catRes.status, 200);
  assert.ok(Array.isArray(catRes.json));
  assert.ok(catRes.json.length >= 5);

  const tmplRes = await request('/api/templates', { token: authToken });
  assert.equal(tmplRes.status, 200);
  assert.ok(Array.isArray(tmplRes.json));
  assert.ok(tmplRes.json.length > 0);
});

test('Client/Server Integration: Prompt Library & Institutional Modules', async () => {
  const charterRes = await request('/api/prompts/charter', { token: authToken });
  assert.equal(charterRes.status, 200);
  assert.ok(charterRes.json.charter.includes('نزاهة المعلومة'));

  const modulesRes = await request('/api/prompts/modules', { token: authToken });
  assert.equal(modulesRes.status, 200);
  assert.ok(Array.isArray(modulesRes.json));
  assert.ok(modulesRes.json.length >= 10);

  // Exact client call: promptsService.preview('cat_exec', 'official')
  const previewRes = await request('/api/prompts/preview/cat_exec?classification=official', {
    token: authToken
  });
  assert.equal(previewRes.status, 200);
  assert.ok(previewRes.json.prompt.length > 0);

  // Exact client call: promptsService.getEffective('official')
  const effectiveRes = await request('/api/prompts/effective?classification=official', {
    token: authToken
  });
  assert.equal(effectiveRes.status, 200);
  assert.ok(effectiveRes.json.prompt.length > 0);
});

test('Client/Server Integration: Chat Lifecycle & Pinning Compatibility', async () => {
  // 1. Create chat
  const createRes = await request('/api/chats', {
    method: 'POST',
    token: authToken,
    body: {
      title: 'جلسة اختبار التكامل الشامل',
      classification: 'official',
      model: 'default'
    }
  });
  assert.equal(createRes.status, 201);
  assert.ok(createRes.json.id);
  testChatId = createRes.json.id;

  // 2. Add message
  const msgRes = await request(`/api/chats/${testChatId}/messages`, {
    method: 'POST',
    token: authToken,
    body: {
      role: 'user',
      content: 'رسالة فحص التكامل بين العميل والخادم'
    }
  });
  assert.equal(msgRes.status, 201);
  assert.equal(msgRes.json.role, 'user');

  // 3. Test pinning with boolean (true) - exact client updateChat call
  const pinBoolRes = await request(`/api/chats/${testChatId}`, {
    method: 'PUT',
    token: authToken,
    body: { pinned: true }
  });
  assert.equal(pinBoolRes.status, 200, `Pin with boolean failed: ${pinBoolRes.text}`);
  assert.equal(pinBoolRes.json.pinned, 1);

  // 4. Test unpinning with integer (0) - backwards compatibility
  const unpinIntRes = await request(`/api/chats/${testChatId}`, {
    method: 'PUT',
    token: authToken,
    body: { pinned: 0 }
  });
  assert.equal(unpinIntRes.status, 200, `Unpin with integer 0 failed: ${unpinIntRes.text}`);
  assert.equal(unpinIntRes.json.pinned, 0);

  // 5. Test pinning with integer (1) - backwards compatibility
  const pinIntRes = await request(`/api/chats/${testChatId}`, {
    method: 'PUT',
    token: authToken,
    body: { pinned: 1 }
  });
  assert.equal(pinIntRes.status, 200, `Pin with integer 1 failed: ${pinIntRes.text}`);
  assert.equal(pinIntRes.json.pinned, 1);

  // 6. Test unpinning with boolean (false) - exact client updateChat call
  const unpinBoolRes = await request(`/api/chats/${testChatId}`, {
    method: 'PUT',
    token: authToken,
    body: { pinned: false }
  });
  assert.equal(unpinBoolRes.status, 200, `Unpin with boolean false failed: ${unpinBoolRes.text}`);
  assert.equal(unpinBoolRes.json.pinned, 0);

  // 7. Verify chat messages retrieval via getChat (as client chatsService.getChat does)
  const getChatRes = await request(`/api/chats/${testChatId}`, { token: authToken });
  assert.equal(getChatRes.status, 200);
  assert.ok(Array.isArray(getChatRes.json.messages));
  assert.equal(getChatRes.json.messages.length, 1);

  // 8. Test clearing chat messages
  const clearRes = await request(`/api/chats/${testChatId}/messages`, {
    method: 'DELETE',
    token: authToken
  });
  assert.equal(clearRes.status, 200);
  assert.ok(clearRes.json.message.includes('إفراغ'));

  // 9. Clean up chat
  const delRes = await request(`/api/chats/${testChatId}`, {
    method: 'DELETE',
    token: authToken
  });
  assert.equal(delRes.status, 200);
  assert.ok(delRes.json.message.includes('حذف'));
});

test('Client/Server Integration: LLM Models Discovery & Chat Schema Validation', async () => {
  const modelsRes = await request('/api/llm/models', { token: authToken });
  assert.equal(modelsRes.status, 200);
  assert.ok(modelsRes.json.hasOwnProperty('connected'));
  assert.ok(Array.isArray(modelsRes.json.models));

  // Verify chat endpoint validates schema and handles optional chatId
  const valRes = await request('/api/llm/chat', {
    method: 'POST',
    token: authToken,
    body: {
      model: 'default',
      messages: [{ role: 'user', content: 'test' }],
      chatId: '00000000-0000-0000-0000-000000000000'
    }
  });
  // LM Studio may or may not be connected, but validation must pass (not 400 Bad Request)
  assert.notEqual(valRes.status, 400, 'Payload with chatId must not fail schema validation');
});

test('Client/Server Integration: Export Tickets & Settings', async () => {
  const ticketRes = await request('/api/export/ticket', {
    method: 'POST',
    token: authToken,
    body: { format: 'pdf' }
  });
  assert.equal(ticketRes.status, 200);
  assert.ok(ticketRes.json.ticket, 'Export ticket must be issued');

  const settingsRes = await request('/api/settings', { token: authToken });
  assert.equal(settingsRes.status, 200);
  assert.ok(typeof settingsRes.json === 'object');
});
