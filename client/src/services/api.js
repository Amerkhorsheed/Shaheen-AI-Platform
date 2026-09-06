const API_BASE = '/api';

// The server can end a session at any moment: the token expires, the account
// is suspended or deleted, or a privilege change invalidates it. The SPA has
// to react to that instead of showing a signed-in shell with no data.
export const SESSION_ENDED_EVENT = 'shaheen:session-ended';
export const PASSWORD_CHANGE_EVENT = 'shaheen:password-change-required';

function announce(eventName, detail) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

/**
 * Inspect a failed response and raise the matching application-level signal.
 * Returns the parsed error body so callers can still show a message.
 */
async function handleFailure(res) {
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON error body */ }

  if (res.status === 401) {
    localStorage.removeItem('shaheen_token');
    localStorage.removeItem('shaheen_user');
    announce(SESSION_ENDED_EVENT, { reason: data.error });
  } else if (res.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') {
    announce(PASSWORD_CHANGE_EVENT, { reason: data.error });
  }
  return data;
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const data = await handleFailure(res);
    const error = new Error(data.error || `خطأ من الخادم (${res.status})`);
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  return res;
}

// Helper for authorized headers
function getHeaders(isJson = true) {
  const token = localStorage.getItem('shaheen_token');
  const headers = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Export targets are reached by a form navigation so the browser can print or
 * download the result, and a form cannot carry an Authorization header. The
 * server issues a short-lived single-use ticket for exactly this purpose.
 */
async function getExportTicket() {
  const res = await request('/export/ticket', { method: 'POST', headers: getHeaders() });
  const { ticket } = await res.json();
  return ticket;
}

function submitExportForm(action, fields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${API_BASE}${action}`;
  form.target = '_blank';

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export const api = {
  // --- AUTH ---
  async login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تسجيل الدخول');
    localStorage.setItem('shaheen_token', data.token);
    localStorage.setItem('shaheen_user', JSON.stringify(data.user));
    return data;
  },

  async getMe() {
    const res = await request('/auth/me', { headers: getHeaders() });
    const user = await res.json();
    // Keep the cached copy authoritative: role and status are read from here.
    localStorage.setItem('shaheen_user', JSON.stringify(user));
    return user;
  },

  logout() {
    localStorage.removeItem('shaheen_token');
    localStorage.removeItem('shaheen_user');
  },

  getStoredUser() {
    const user = localStorage.getItem('shaheen_user');
    return user ? JSON.parse(user) : null;
  },

  // --- USERS MANAGEMENT (Admin) ---
  async getUsers() {
    const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل جلب قائمة المستخدمين');
    return res.json();
  },

  async getUserStats() {
    const res = await fetch(`${API_BASE}/users/stats`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل جلب إحصاءات الكوادر');
    return res.json();
  },

  async createUser(userData) {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(userData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل إنشاء المستخدم');
    return data;
  },

  async updateUser(userId, userData) {
    const res = await fetch(`${API_BASE}/users/${userId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(userData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحديث بيانات المستخدم');
    return data;
  },

  async deleteUser(userId) {
    const res = await fetch(`${API_BASE}/users/${userId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل حذف المستخدم');
    return data;
  },

  // --- CATEGORIES & ORG STRUCTURE ---
  async getCategories() {
    const res = await fetch(`${API_BASE}/categories`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل جلب التصنيفات المؤسسية');
    return res.json();
  },

  async createCategory(categoryData) {
    const res = await fetch(`${API_BASE}/categories`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(categoryData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل إنشاء التصنيف المؤسسي');
    return data;
  },

  async deleteCategory(categoryId) {
    const res = await fetch(`${API_BASE}/categories/${categoryId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل حذف التصنيف المؤسسي');
    return data;
  },

  // --- CHATS & MESSAGES ---
  async getChats() {
    const res = await fetch(`${API_BASE}/chats`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل جلب المحادثات');
    return res.json();
  },

  async getChat(id) {
    const res = await fetch(`${API_BASE}/chats/${id}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل جلب تفاصيل المحادثة');
    return res.json();
  },

  async createChat(chatData) {
    const res = await fetch(`${API_BASE}/chats`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(chatData)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل إنشاء محادثة');
    return data;
  },

  async updateChat(id, updates) {
    const res = await fetch(`${API_BASE}/chats/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل تحديث المحادثة');
    return data;
  },

  async deleteChat(id) {
    const res = await fetch(`${API_BASE}/chats/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('فشل حذف المحادثة');
    return res.json();
  },

  async saveMessage(chatId, message) {
    const res = await fetch(`${API_BASE}/chats/${chatId}/messages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(message)
    });
    if (!res.ok) throw new Error('فشل حفظ الرسالة');
    return res.json();
  },

  async clearChat(chatId) {
    const res = await fetch(`${API_BASE}/chats/${chatId}/messages`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('فشل مسح رسائل المحادثة');
    return res.json();
  },

  // --- FILE UPLOADS ---
  async uploadFiles(fileList) {
    const formData = new FormData();
    for (const file of fileList) {
      formData.append('files', file);
    }
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: getHeaders(false),
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل رفع الملفات');
    return data.files;
  },

  // --- LM STUDIO MODELS & STREAMING ---
  async getModels() {
    const res = await fetch(`${API_BASE}/llm/models`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل فحص اتصال LM Studio');
    return res.json();
  },

  async streamChat({ model, messages, temperature = 0.7, max_tokens = 4096, signal, onChunk, onDone, onError }) {
    try {
      const res = await fetch(`${API_BASE}/llm/chat`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ model, messages, temperature, max_tokens }),
        signal
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'فشل الاتصال بالنموذج' }));
        throw new Error(errorData.error || `خطأ من الخادم (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') {
            if (onDone) onDone();
            return;
          }

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta && onChunk) {
              onChunk(delta);
            }
          } catch (e) {
            // Ignore parse errors on trailing or intermediate lines
          }
        }
      }

      if (onDone) onDone();
    } catch (err) {
      if (err.name === 'AbortError') {
        if (onDone) onDone();
        return;
      }
      if (onError) onError(err);
      else throw err;
    }
  },

  // --- SETTINGS ---
  async getSettings() {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) throw new Error('فشل جلب الإعدادات');
    return res.json();
  },

  async updateSettings(settings) {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(settings)
    });
    if (!res.ok) throw new Error('فشل حفظ الإعدادات');
    return res.json();
  },

  // --- GOVERNMENT TEMPLATES (DYNAMIC REPOSITORY) ---
  async getTemplates() {
    const res = await fetch(`${API_BASE}/templates`, { headers: getHeaders() });
    if (!res.ok) throw new Error('فشل جلب نماذج المراسلات الحكومية');
    return res.json();
  },

  async createTemplate(templateData) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(templateData)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل إنشاء النموذج الإداري');
    return data;
  },

  async updateTemplate(id, templateData) {
    const res = await fetch(`${API_BASE}/templates/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(templateData)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل تعديل النموذج الإداري');
    return data;
  },

  async deleteTemplate(id) {
    const res = await fetch(`${API_BASE}/templates/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل حذف النموذج');
    return data;
  },

  // --- EXPORTS ---
  // Each of these obtains a single-use ticket first; the server rejects an
  // export request that does not carry one.

  async exportPdf(title, content, metadata = {}) {
    const ticket = await getExportTicket();
    submitExportForm('/export/pdf-page', {
      ticket,
      title,
      content,
      metadata: JSON.stringify(metadata)
    });
  },

  async exportXlsx(csvData, filename = 'shaheen_gov_table.xlsx', title = 'مصفوفة بيانات رسمية') {
    const ticket = await getExportTicket();
    submitExportForm('/export/xlsx', {
      ticket,
      csvData,
      filename: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
      title
    });
  },

  exportCsv(csvData, filename = 'shaheen_table.csv') {
    // Generated entirely in the browser; no server round-trip is required.
    const bom = '﻿';
    const blob = new Blob([bom + csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  async openCsvPreviewPage(csvData, filename = 'shaheen_gov_table.xlsx', tableTitle = 'مصفوفة البيانات') {
    const ticket = await getExportTicket();
    submitExportForm('/export/csv-page', { ticket, csvData, filename, tableTitle });
  },

  async verifyDocument(ref) {
    const res = await request(`/export/verify/${encodeURIComponent(ref)}`, { headers: getHeaders() });
    return res.json();
  },

  // --- PASSWORD ---
  async changePassword(currentPassword, newPassword) {
    const res = await request('/auth/change-password', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    localStorage.setItem('shaheen_token', data.token);
    localStorage.setItem('shaheen_user', JSON.stringify(data.user));
    return data;
  }
};
