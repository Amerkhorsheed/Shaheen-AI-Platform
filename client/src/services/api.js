const API_BASE = '/api';

// Helper for authorized headers
function getHeaders(isJson = true) {
  const token = localStorage.getItem('shaheen_token');
  const headers = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
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
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('غير مصرح');
    return res.json();
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

  async createUser(userData) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(userData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل إنشاء المستخدم');
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
  exportPdf(title, content, metadata = {}) {
    // Open a new printable window with auto-trigger print
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${API_BASE}/export/pdf-page`;
    form.target = '_blank';

    const inputTitle = document.createElement('input');
    inputTitle.type = 'hidden';
    inputTitle.name = 'title';
    inputTitle.value = title;
    form.appendChild(inputTitle);

    const inputContent = document.createElement('input');
    inputContent.type = 'hidden';
    inputContent.name = 'content';
    inputContent.value = content;
    form.appendChild(inputContent);

    const inputMeta = document.createElement('input');
    inputMeta.type = 'hidden';
    inputMeta.name = 'metadata';
    inputMeta.value = JSON.stringify(metadata);
    form.appendChild(inputMeta);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  },

  exportXlsx(csvData, filename = 'shaheen_gov_table.xlsx', title = 'مصفوفة بيانات حكومية رسمية') {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${API_BASE}/export/xlsx`;
    form.target = '_blank';

    const inputCsv = document.createElement('input');
    inputCsv.type = 'hidden';
    inputCsv.name = 'csvData';
    inputCsv.value = csvData;
    form.appendChild(inputCsv);

    const inputFilename = document.createElement('input');
    inputFilename.type = 'hidden';
    inputFilename.name = 'filename';
    inputFilename.value = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    form.appendChild(inputFilename);

    const inputTitle = document.createElement('input');
    inputTitle.type = 'hidden';
    inputTitle.name = 'title';
    inputTitle.value = title;
    form.appendChild(inputTitle);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  },

  exportCsv(csvData, filename = 'shaheen_table.csv') {
    // 1. Direct UTF-8 BOM download in browser
    const bom = '\uFEFF';
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

  openCsvPreviewPage(csvData, filename = 'shaheen_gov_table.xlsx', tableTitle = 'مصفوفة البيانات وجداول المؤشرات الرسمية') {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${API_BASE}/export/csv-page`;
    form.target = '_blank';

    const inputCsv = document.createElement('input');
    inputCsv.type = 'hidden';
    inputCsv.name = 'csvData';
    inputCsv.value = csvData;
    form.appendChild(inputCsv);

    const inputFilename = document.createElement('input');
    inputFilename.type = 'hidden';
    inputFilename.name = 'filename';
    inputFilename.value = filename;
    form.appendChild(inputFilename);

    const inputTitle = document.createElement('input');
    inputTitle.type = 'hidden';
    inputTitle.name = 'tableTitle';
    inputTitle.value = tableTitle;
    form.appendChild(inputTitle);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }
};
