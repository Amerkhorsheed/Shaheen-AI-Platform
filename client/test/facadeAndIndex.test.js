import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockBrowser } from './setup.js';
import { api, SESSION_ENDED_EVENT, PASSWORD_CHANGE_EVENT } from '../src/services/api.js';
import * as servicesIndex from '../src/services/index.js';

describe('API Facade & Index Suite', () => {
  let env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env = setupMockBrowser();
  });

  afterEach(() => {
    env.cleanup();
    globalThis.fetch = originalFetch;
  });

  it('exports session lifecycle constants from api.js', () => {
    assert.equal(SESSION_ENDED_EVENT, 'shaheen:session-ended');
    assert.equal(PASSWORD_CHANGE_EVENT, 'shaheen:password-change-required');
  });

  it('delegates all auth operations through the api facade', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/auth/me')) {
        return new Response(JSON.stringify({ id: 1, username: 'admin' }), { status: 200 });
      }
      return new Response(JSON.stringify({ token: 't', user: { id: 1, username: 'admin' } }), { status: 200 });
    };

    const loginRes = await api.login('u', 'p');
    assert.equal(loginRes.token, 't');

    const me = await api.getMe();
    assert.equal(me.id, 1);
    assert.deepEqual(api.getStoredUser(), { id: 1, username: 'admin' });

    const pwRes = await api.changePassword('old', 'new');
    assert.equal(pwRes.token, 't');

    api.logout();
    assert.equal(api.getStoredUser(), null);
  });

  it('delegates user management calls through the api facade', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    assert.deepEqual(await api.getUsers(), { ok: true });
    assert.deepEqual(await api.getUserStats(), { ok: true });
    assert.deepEqual(await api.createUser({ name: 'test' }), { ok: true });
    assert.deepEqual(await api.updateUser(1, { name: 'updated' }), { ok: true });
    assert.deepEqual(await api.deleteUser(1), { ok: true });
  });

  it('delegates categories calls through the api facade', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    assert.deepEqual(await api.getCategories(), { ok: true });
    assert.deepEqual(await api.createCategory({ name: 'cat' }), { ok: true });
    assert.deepEqual(await api.deleteCategory('c1'), { ok: true });
  });

  it('delegates chats calls through the api facade', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    assert.deepEqual(await api.getChats(), { ok: true });
    assert.deepEqual(await api.getChat('c1'), { ok: true });
    assert.deepEqual(await api.createChat({ title: 't' }), { ok: true });
    assert.deepEqual(await api.updateChat('c1', { title: 't2' }), { ok: true });
    assert.deepEqual(await api.deleteChat('c1'), { ok: true });
    assert.deepEqual(await api.saveMessage('c1', { content: 'hi' }), { ok: true });
    assert.deepEqual(await api.clearChat('c1'), { ok: true });
  });

  it('delegates files, llm, settings, and templates calls through the api facade', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ files: ['f1'], ok: true }), { status: 200 });

    assert.deepEqual(await api.uploadFiles([]), ['f1']);
    assert.deepEqual(await api.getModels(), { files: ['f1'], ok: true });
    assert.deepEqual(await api.getSettings(), { files: ['f1'], ok: true });
    assert.deepEqual(await api.updateSettings({ k: 'v' }), { files: ['f1'], ok: true });
    assert.deepEqual(await api.getTemplates(), { files: ['f1'], ok: true });
    assert.deepEqual(await api.createTemplate({ t: 1 }), { files: ['f1'], ok: true });
    assert.deepEqual(await api.updateTemplate(1, { t: 2 }), { files: ['f1'], ok: true });
    assert.deepEqual(await api.deleteTemplate(1), { files: ['f1'], ok: true });

    let streamRan = false;
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true })
        })
      }
    });

    await api.streamChat({
      model: 'm',
      messages: [],
      onDone: () => {
        streamRan = true;
      }
    });
    assert.equal(streamRan, true);
  });

  it('delegates export calls through the api facade', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ticket: 'tk', verified: true }), { status: 200 });

    await api.exportPdf('PDF', 'Body', { meta: 1 });
    await api.exportXlsx('col1\n1', 'table.xlsx', 'Title');
    api.exportCsv('col1\n1', 'file.csv');
    await api.openCsvPreviewPage('col1\n1', 'table.xlsx', 'Title');

    const verify = await api.verifyDocument('REF-1');
    assert.equal(verify.verified, true);
  });

  it('delegates prompt library calls through the api facade', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, prompt: 'p' }), { status: 200 });

    assert.deepEqual(await api.getPromptCharter(), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.getPromptModules(), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.getPromptModule('mod_1'), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.createPromptModule({ name: 'm' }), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.updatePromptModule('mod_1', { name: 'm2' }), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.deletePromptModule('mod_1'), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.getCategoryPromptModules('cat_1'), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.setCategoryPromptModules('cat_1', ['mod_1']), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.previewPrompt('cat_1', 'official'), { ok: true, prompt: 'p' });
    assert.deepEqual(await api.getEffectivePrompt('official'), { ok: true, prompt: 'p' });
  });

  it('verifies index.js exports all services and core utilities', () => {
    assert.ok(servicesIndex.api);
    assert.ok(servicesIndex.authService);
    assert.ok(servicesIndex.usersService);
    assert.ok(servicesIndex.categoriesService);
    assert.ok(servicesIndex.chatsService);
    assert.ok(servicesIndex.filesService);
    assert.ok(servicesIndex.llmService);
    assert.ok(servicesIndex.settingsService);
    assert.ok(servicesIndex.templatesService);
    assert.ok(servicesIndex.promptsService);
    assert.ok(servicesIndex.exportService);
    assert.ok(servicesIndex.HttpClient);
    assert.ok(servicesIndex.http);
    assert.ok(servicesIndex.storage);
    assert.ok(servicesIndex.ApiError);
    assert.ok(servicesIndex.SESSION_ENDED_EVENT);
    assert.ok(servicesIndex.PASSWORD_CHANGE_EVENT);
    assert.equal(typeof servicesIndex.announce, 'function');
    assert.equal(typeof servicesIndex.subscribe, 'function');
  });
});
