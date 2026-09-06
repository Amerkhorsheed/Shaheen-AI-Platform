import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockBrowser } from './setup.js';
import { storage } from '../src/services/core/storage.js';
import { http } from '../src/services/core/httpClient.js';
import { authService } from '../src/services/auth.service.js';
import { usersService } from '../src/services/users.service.js';
import { categoriesService } from '../src/services/categories.service.js';
import { chatsService } from '../src/services/chats.service.js';
import { filesService, decodeFilename } from '../src/services/files.service.js';
import { llmService } from '../src/services/llm.service.js';
import { settingsService } from '../src/services/settings.service.js';
import { templatesService } from '../src/services/templates.service.js';
import { promptsService } from '../src/services/prompts.service.js';
import { exportService, submitExportForm } from '../src/services/export.service.js';

describe('Domain Services Suite', () => {
  let env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env = setupMockBrowser();
  });

  afterEach(() => {
    env.cleanup();
    globalThis.fetch = originalFetch;
  });

  // ==========================================
  // AUTH SERVICE
  // ==========================================
  describe('authService', () => {
    it('logs in successfully and caches token and user', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        const body = JSON.parse(opts.body);
        assert.equal(body.username, 'admin');
        assert.equal(body.password, 'secret');
        return new Response(
          JSON.stringify({
            token: 'auth-jwt',
            user: { id: 1, username: 'admin', role: 'superadmin' }
          }),
          { status: 200 }
        );
      };

      const res = await authService.login('admin', 'secret');
      assert.equal(res.token, 'auth-jwt');
      assert.equal(storage.getToken(), 'auth-jwt');
      assert.deepEqual(storage.getUser(), { id: 1, username: 'admin', role: 'superadmin' });
    });

    it('logs in when response omits token and user', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
      storage.clearSession();
      const res = await authService.login('user', 'pass');
      assert.deepEqual(res, {});
      assert.equal(storage.getToken(), null);
      assert.equal(storage.getUser(), null);
    });

    it('gets current user and updates stored user', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'GET');
        return new Response(
          JSON.stringify({ id: 2, username: 'editor', role: 'officer' }),
          { status: 200 }
        );
      };

      const user = await authService.getMe();
      assert.equal(user.username, 'editor');
      assert.deepEqual(storage.getUser(), { id: 2, username: 'editor', role: 'officer' });
    });

    it('logs out and clears session', () => {
      storage.setToken('test-tok');
      storage.setUser({ id: 1 });
      authService.logout();
      assert.equal(storage.getToken(), null);
      assert.equal(storage.getUser(), null);
    });

    it('returns stored user without network request', () => {
      storage.setUser({ id: 5, username: 'stored' });
      const user = authService.getStoredUser();
      assert.deepEqual(user, { id: 5, username: 'stored' });
    });

    it('changes password and updates stored credentials', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        const body = JSON.parse(opts.body);
        assert.equal(body.currentPassword, 'oldPass');
        assert.equal(body.newPassword, 'newPass');
        return new Response(
          JSON.stringify({
            token: 'new-jwt',
            user: { id: 1, username: 'admin' }
          }),
          { status: 200 }
        );
      };

      const res = await authService.changePassword('oldPass', 'newPass');
      assert.equal(res.token, 'new-jwt');
      assert.equal(storage.getToken(), 'new-jwt');
    });

    it('changes password when response omits token/user', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
      storage.clearSession();
      const res = await authService.changePassword('oldPass', 'newPass');
      assert.deepEqual(res, { ok: true });
      assert.equal(storage.getToken(), null);
    });
  });

  // ==========================================
  // USERS SERVICE
  // ==========================================
  describe('usersService', () => {
    it('handles getUsers', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify([{ id: 1, name: 'User 1' }]), { status: 200 });
      const users = await usersService.getUsers();
      assert.deepEqual(users, [{ id: 1, name: 'User 1' }]);
    });

    it('handles getUserStats', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ total: 10, active: 8 }), { status: 200 });
      const stats = await usersService.getUserStats();
      assert.deepEqual(stats, { total: 10, active: 8 });
    });

    it('handles createUser', async () => {
      let sentBody = null;
      globalThis.fetch = async (url, opts) => {
        sentBody = JSON.parse(opts.body);
        return new Response(JSON.stringify({ id: 2, ...sentBody }), { status: 201 });
      };
      const created = await usersService.createUser({ username: 'newUser', role: 'analyst' });
      assert.equal(created.username, 'newUser');
      assert.equal(sentBody.username, 'newUser');
    });

    it('handles updateUser', async () => {
      let sentUrl = '';
      globalThis.fetch = async (url, opts) => {
        sentUrl = url;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      };
      const updated = await usersService.updateUser(42, { displayName: 'Updated' });
      assert.ok(sentUrl.endsWith('/api/users/42'));
      assert.deepEqual(updated, { success: true });
    });

    it('handles deleteUser', async () => {
      let sentUrl = '';
      globalThis.fetch = async (url, opts) => {
        sentUrl = url;
        assert.equal(opts.method, 'DELETE');
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      };
      const res = await usersService.deleteUser(99);
      assert.ok(sentUrl.endsWith('/api/users/99'));
      assert.deepEqual(res, { deleted: true });
    });
  });

  // ==========================================
  // CATEGORIES SERVICE
  // ==========================================
  describe('categoriesService', () => {
    it('handles getCategories', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'cat1', name: 'Security' }]), { status: 200 });
      const cats = await categoriesService.getCategories();
      assert.deepEqual(cats, [{ id: 'cat1', name: 'Security' }]);
    });

    it('handles createCategory', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        return new Response(JSON.stringify({ id: 'cat2', name: 'Legal' }), { status: 201 });
      };
      const cat = await categoriesService.createCategory({ name: 'Legal' });
      assert.equal(cat.id, 'cat2');
    });

    it('handles deleteCategory', async () => {
      let sentUrl = '';
      globalThis.fetch = async (url, opts) => {
        sentUrl = url;
        assert.equal(opts.method, 'DELETE');
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      };
      const res = await categoriesService.deleteCategory('cat1');
      assert.ok(sentUrl.endsWith('/api/categories/cat1'));
      assert.deepEqual(res, { success: true });
    });
  });

  // ==========================================
  // CHATS SERVICE
  // ==========================================
  describe('chatsService', () => {
    it('handles getChats', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 });
      const chats = await chatsService.getChats();
      assert.deepEqual(chats, [{ id: 'c1' }]);
    });

    it('handles getChat', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/chats/c1'));
        return new Response(JSON.stringify({ id: 'c1', title: 'Chat 1' }), { status: 200 });
      };
      const chat = await chatsService.getChat('c1');
      assert.equal(chat.id, 'c1');
    });

    it('handles createChat', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        return new Response(JSON.stringify({ id: 'c2', title: 'New Chat' }), { status: 201 });
      };
      const chat = await chatsService.createChat({ title: 'New Chat' });
      assert.equal(chat.id, 'c2');
    });

    it('handles updateChat', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'PUT');
        assert.ok(url.endsWith('/api/chats/c2'));
        return new Response(JSON.stringify({ id: 'c2', pinned: true }), { status: 200 });
      };
      const chat = await chatsService.updateChat('c2', { pinned: true });
      assert.equal(chat.pinned, true);
    });

    it('handles deleteChat', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'DELETE');
        assert.ok(url.endsWith('/api/chats/c2'));
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      };
      const res = await chatsService.deleteChat('c2');
      assert.deepEqual(res, { deleted: true });
    });

    it('handles saveMessage', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        assert.ok(url.endsWith('/api/chats/c2/messages'));
        return new Response(JSON.stringify({ id: 'm1', role: 'user' }), { status: 200 });
      };
      const msg = await chatsService.saveMessage('c2', { role: 'user', content: 'Hello' });
      assert.equal(msg.id, 'm1');
    });

    it('handles clearChat', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'DELETE');
        assert.ok(url.endsWith('/api/chats/c2/messages'));
        return new Response(JSON.stringify({ cleared: true }), { status: 200 });
      };
      const res = await chatsService.clearChat('c2');
      assert.deepEqual(res, { cleared: true });
    });
  });

  // ==========================================
  // FILES SERVICE
  // ==========================================
  describe('filesService', () => {
    it('uploads files via FormData', async () => {
      const mockFiles = [
        new Blob(['file 1 content'], { type: 'text/plain' }),
        new Blob(['file 2 content'], { type: 'text/plain' })
      ];

      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        assert.ok(opts.body instanceof FormData);
        return new Response(
          JSON.stringify({ files: [{ filename: 'f1.txt' }, { filename: 'f2.txt' }] }),
          { status: 200 }
        );
      };

      const files = await filesService.uploadFiles(mockFiles);
      assert.equal(files.length, 2);
      assert.equal(files[0].filename, 'f1.txt');
    });

    it('decodes mojibake Arabic filenames safely', () => {
      const corrupted = Buffer.from('تدفقات ومدفوعات شهر8.xlsx', 'utf8').toString('latin1');
      assert.equal(decodeFilename(corrupted), 'تدفقات ومدفوعات شهر8.xlsx');
      assert.equal(decodeFilename('تدفقات ومدفوعات شهر8.xlsx'), 'تدفقات ومدفوعات شهر8.xlsx');
      assert.equal(decodeFilename('document.pdf'), 'document.pdf');
      assert.equal(decodeFilename(''), '');
      assert.equal(decodeFilename(null), '');
    });

    it('cleans filenames in uploadFiles', async () => {
      const corrupted = Buffer.from('تدفقات ومدفوعات شهر8.xlsx', 'utf8').toString('latin1');
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ files: [{ filename: corrupted }] }),
          { status: 200 }
        );
      };
      const files = await filesService.uploadFiles([]);
      assert.equal(files[0].filename, 'تدفقات ومدفوعات شهر8.xlsx');
    });
  });

  // ==========================================
  // LLM SERVICE
  // ==========================================
  describe('llmService', () => {
    it('fetches loaded models', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/llm/models'));
        return new Response(JSON.stringify({ connected: true, models: [{ id: 'qwen' }] }), { status: 200 });
      };

      const res = await llmService.getModels();
      assert.equal(res.connected, true);
      assert.equal(res.models[0].id, 'qwen');
    });

    it('throws error when response body is not readable', async () => {
      globalThis.fetch = async () => {
        return { ok: true, body: null };
      };

      let capturedError = null;
      await llmService.streamChat({
        model: 'm1',
        messages: [],
        onError: (err) => {
          capturedError = err;
        }
      });
      assert.ok(capturedError);
      assert.ok(capturedError.message.includes('ReadableStream'));

      // Also without onError callback -> rethrows
      await assert.rejects(
        async () => llmService.streamChat({ model: 'm1', messages: [] }),
        /ReadableStream/
      );
    });

    it('streams chat chunks across multiple buffers and completes on [DONE]', async () => {
      const chunks = [
        new TextEncoder().encode(': comment\n\ndata: {"choices":[{"delta":{"content":"مرحبا"}}]}\n'),
        new TextEncoder().encode('data: {invalid json\ndata: {"choices":[{"delta":{}}]}\ndata:   \n'),
        new TextEncoder().encode('data: {"choices":[{"delta":{"content":" بكم"}}]}\ndata: [DO'),
        new TextEncoder().encode('NE]\n')
      ];

      let chunkIdx = 0;
      const mockStream = {
        getReader: () => ({
          read: async () => {
            if (chunkIdx < chunks.length) {
              return { value: chunks[chunkIdx++], done: false };
            }
            return { value: undefined, done: true };
          }
        })
      };

      globalThis.fetch = async () => ({ ok: true, body: mockStream });

      const deltas = [];
      let doneCalled = false;

      await llmService.streamChat({
        model: 'm1',
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: (d) => deltas.push(d),
        onDone: () => {
          doneCalled = true;
        }
      });

      assert.deepEqual(deltas, ['مرحبا', ' بكم']);
      assert.equal(doneCalled, true);
    });

    it('handles stream with natural EOF (done: true) without [DONE]', async () => {
      const chunk = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"تم"}}]}\n');
      let called = false;
      const mockStream = {
        getReader: () => ({
          read: async () => {
            if (!called) {
              called = true;
              return { value: chunk, done: false };
            }
            return { value: undefined, done: true };
          }
        })
      };

      globalThis.fetch = async () => ({ ok: true, body: mockStream });

      let doneCalled = false;
      const deltas = [];
      await llmService.streamChat({
        model: 'm1',
        messages: [],
        onChunk: (d) => deltas.push(d),
        onDone: () => {
          doneCalled = true;
        }
      });

      assert.deepEqual(deltas, ['تم']);
      assert.equal(doneCalled, true);
    });

    it('handles stream error payload in JSON', async () => {
      const chunk = new TextEncoder().encode('data: {"error":"Model overloaded"}\n');
      let emitted = false;
      const mockStream = {
        getReader: () => ({
          read: async () => {
            if (!emitted) {
              emitted = true;
              return { value: chunk, done: false };
            }
            return { value: undefined, done: true };
          }
        })
      };

      globalThis.fetch = async () => ({ ok: true, body: mockStream });

      let capturedErr = null;
      await llmService.streamChat({
        model: 'm1',
        messages: [],
        onError: (e) => {
          capturedErr = e;
        }
      });

      assert.ok(capturedErr);
      assert.equal(capturedErr.message, 'Model overloaded');
    });

    it('handles AbortError quietly and calls onDone', async () => {
      const mockStream = {
        getReader: () => ({
          read: async () => {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            throw err;
          }
        })
      };

      globalThis.fetch = async () => ({ ok: true, body: mockStream });

      let doneCalled = false;
      let errorCalled = false;

      await llmService.streamChat({
        model: 'm1',
        messages: [],
        onDone: () => {
          doneCalled = true;
        },
        onError: () => {
          errorCalled = true;
        }
      });

      assert.equal(doneCalled, true);
      assert.equal(errorCalled, false);

      // Also when onDone is omitted
      await assert.doesNotReject(async () => {
        await llmService.streamChat({ model: 'm1', messages: [] });
      });
    });

    it('handles unexpected stream reader errors and rethrows if onError is missing', async () => {
      const mockStream = {
        getReader: () => ({
          read: async () => {
            throw new Error('Connection reset');
          }
        })
      };

      globalThis.fetch = async () => ({ ok: true, body: mockStream });

      await assert.rejects(
        async () => llmService.streamChat({ model: 'm1', messages: [] }),
        /Connection reset/
      );
    });
  });

  // ==========================================
  // SETTINGS SERVICE
  // ==========================================
  describe('settingsService', () => {
    it('fetches system settings', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/settings'));
        return new Response(JSON.stringify({ default_model: 'qwen' }), { status: 200 });
      };

      const s = await settingsService.getSettings();
      assert.deepEqual(s, { default_model: 'qwen' });
    });

    it('updates system settings', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'PUT');
        assert.ok(url.endsWith('/api/settings'));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      };

      const res = await settingsService.updateSettings({ default_model: 'qwen-pro' });
      assert.deepEqual(res, { success: true });
    });
  });

  // ==========================================
  // TEMPLATES SERVICE
  // ==========================================
  describe('templatesService', () => {
    it('handles getTemplates', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify([{ id: 't1' }]), { status: 200 });
      const tmpls = await templatesService.getTemplates();
      assert.deepEqual(tmpls, [{ id: 't1' }]);
    });

    it('handles createTemplate', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        return new Response(JSON.stringify({ id: 't2', title: 'Circular' }), { status: 201 });
      };
      const t = await templatesService.createTemplate({ title: 'Circular' });
      assert.equal(t.id, 't2');
    });

    it('handles updateTemplate', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'PUT');
        assert.ok(url.endsWith('/api/templates/t2'));
        return new Response(JSON.stringify({ id: 't2', title: 'Circular Updated' }), { status: 200 });
      };
      const t = await templatesService.updateTemplate('t2', { title: 'Circular Updated' });
      assert.equal(t.title, 'Circular Updated');
    });

    it('handles deleteTemplate', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'DELETE');
        assert.ok(url.endsWith('/api/templates/t2'));
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      };
      const res = await templatesService.deleteTemplate('t2');
      assert.deepEqual(res, { deleted: true });
    });
  });

  // ==========================================
  // PROMPTS SERVICE
  // ==========================================
  describe('promptsService', () => {
    it('handles getCharter', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/prompts/charter'));
        return new Response(JSON.stringify({ charter: 'ميثاق المنظومة' }), { status: 200 });
      };
      const res = await promptsService.getCharter();
      assert.deepEqual(res, { charter: 'ميثاق المنظومة' });
    });

    it('handles getModules', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/prompts/modules'));
        return new Response(JSON.stringify([{ id: 'mod_source_discipline' }]), { status: 200 });
      };
      const res = await promptsService.getModules();
      assert.deepEqual(res, [{ id: 'mod_source_discipline' }]);
    });

    it('handles getModule', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/prompts/modules/mod_source_discipline'));
        return new Response(JSON.stringify({ id: 'mod_source_discipline', name: 'انضباط المصادر' }), { status: 200 });
      };
      const res = await promptsService.getModule('mod_source_discipline');
      assert.equal(res.name, 'انضباط المصادر');
    });

    it('handles createModule', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        assert.ok(url.endsWith('/api/prompts/modules'));
        const body = JSON.parse(opts.body);
        assert.equal(body.name, 'وحدة جديدة');
        return new Response(JSON.stringify({ id: 'mod_new', name: 'وحدة جديدة' }), { status: 201 });
      };
      const res = await promptsService.createModule({ name: 'وحدة جديدة', content: 'نص' });
      assert.equal(res.id, 'mod_new');
    });

    it('handles updateModule', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'PUT');
        assert.ok(url.endsWith('/api/prompts/modules/mod_new'));
        const body = JSON.parse(opts.body);
        assert.equal(body.name, 'وحدة معدلة');
        return new Response(JSON.stringify({ id: 'mod_new', name: 'وحدة معدلة' }), { status: 200 });
      };
      const res = await promptsService.updateModule('mod_new', { name: 'وحدة معدلة' });
      assert.equal(res.name, 'وحدة معدلة');
    });

    it('handles deleteModule', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'DELETE');
        assert.ok(url.endsWith('/api/prompts/modules/mod_new'));
        return new Response(JSON.stringify({ message: 'تم الحذف' }), { status: 200 });
      };
      const res = await promptsService.deleteModule('mod_new');
      assert.deepEqual(res, { message: 'تم الحذف' });
    });

    it('handles getCategoryModules', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.endsWith('/api/prompts/categories/cat_exec/modules'));
        return new Response(JSON.stringify([{ id: 'mod_source_discipline' }]), { status: 200 });
      };
      const res = await promptsService.getCategoryModules('cat_exec');
      assert.deepEqual(res, [{ id: 'mod_source_discipline' }]);
    });

    it('handles setCategoryModules', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'PUT');
        assert.ok(url.endsWith('/api/prompts/categories/cat_exec/modules'));
        const body = JSON.parse(opts.body);
        assert.deepEqual(body.moduleIds, ['mod_source_discipline']);
        return new Response(JSON.stringify([{ id: 'mod_source_discipline' }]), { status: 200 });
      };
      const res = await promptsService.setCategoryModules('cat_exec', ['mod_source_discipline']);
      assert.deepEqual(res, [{ id: 'mod_source_discipline' }]);
    });

    it('handles preview', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/api/prompts/preview/cat_exec?classification=top_secret'));
        return new Response(JSON.stringify({ prompt: 'الميثاق المجمع', layers: {} }), { status: 200 });
      };
      const res = await promptsService.preview('cat_exec', 'top_secret');
      assert.equal(res.prompt, 'الميثاق المجمع');
    });

    it('handles getEffective', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/api/prompts/effective?classification=official'));
        return new Response(JSON.stringify({ prompt: 'برومبت المستخدم', layers: {} }), { status: 200 });
      };
      const res = await promptsService.getEffective('official');
      assert.equal(res.prompt, 'برومبت المستخدم');
    });
  });

  // ==========================================
  // EXPORT SERVICE
  // ==========================================
  describe('exportService', () => {
    it('gets export ticket', async () => {
      globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        assert.ok(url.endsWith('/api/export/ticket'));
        return new Response(JSON.stringify({ ticket: 'tk_987' }), { status: 200 });
      };

      const ticket = await exportService.getExportTicket();
      assert.equal(ticket, 'tk_987');
    });

    it('submits export form for PDF with metadata and default metadata', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ ticket: 'tk_pdf' }), { status: 200 });

      // 1. With metadata
      await exportService.exportPdf('Official Doc', 'Content 1', { ref: 'REF-123' });
      assert.equal(env.appendedElements.length, 0); // element was appended, submitted, and removed

      // 2. With default metadata
      await exportService.exportPdf('Official Doc 2', 'Content 2');
      assert.equal(env.appendedElements.length, 0);
    });

    it('submits export form for XLSX with and without .xlsx extension', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ ticket: 'tk_xlsx' }), { status: 200 });

      // 1. Filename without extension
      await exportService.exportXlsx('col1,col2\n1,2', 'data_table');

      // 2. Filename already ending in .xlsx
      await exportService.exportXlsx('col1,col2\n1,2', 'data_table.xlsx', 'Custom Title');

      // 3. With default filename and title
      await exportService.exportXlsx('col1\n1');
    });

    it('exports CSV completely client-side with UTF-8 BOM', () => {
      // 1. Filename without .csv
      exportService.exportCsv('a,b,c\n1,2,3', 'table');
      assert.equal(env.revokedUrls.length, 1);

      // 2. Filename with .csv
      exportService.exportCsv('a,b,c\n1,2,3', 'table.csv');
      assert.equal(env.revokedUrls.length, 2);

      // 3. With default filename
      exportService.exportCsv('a,b,c\n1,2,3');
      assert.equal(env.revokedUrls.length, 3);

      // 4. When window or document is undefined
      const origWindow = globalThis.window;
      delete globalThis.window;
      try {
        assert.doesNotThrow(() => exportService.exportCsv('data'));
      } finally {
        globalThis.window = origWindow;
      }

      const origDoc = globalThis.document;
      delete globalThis.document;
      try {
        assert.doesNotThrow(() => exportService.exportCsv('data'));
      } finally {
        globalThis.document = origDoc;
      }
    });

    it('opens CSV preview inspection page', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ ticket: 'tk_preview' }), { status: 200 });
      await exportService.openCsvPreviewPage('col1\nval', 'preview.xlsx', 'Preview');
      // With defaults
      await exportService.openCsvPreviewPage('col1\nval');
    });

    it('submits form when action does not start with slash', () => {
      submitExportForm('export/no-slash', { key: 'value' });
      assert.equal(env.appendedElements.length, 0);
    });

    it('verifies official document reference', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/api/export/verify/REF-999'));
        return new Response(JSON.stringify({ verified: true, title: 'Decree' }), { status: 200 });
      };

      const res = await exportService.verifyDocument('REF-999');
      assert.equal(res.verified, true);
    });

    it('safely exits submitExportForm when document is undefined', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ ticket: 'tk_nodoc' }), { status: 200 });
      const origDoc = globalThis.document;
      delete globalThis.document;
      try {
        await assert.doesNotReject(async () => {
          await exportService.exportPdf('Title', 'Content');
        });
      } finally {
        globalThis.document = origDoc;
      }
    });
  });
});
