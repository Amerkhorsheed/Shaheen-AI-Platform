const { db, logAudit } = require('./db');

function registerTemplateRoutes(app, authMiddleware) {
  // 1. List all templates (system templates + custom user templates)
  app.get('/api/templates', authMiddleware, (req, res) => {
    try {
      const templates = db.prepare(`
        SELECT t.*, u.display_name as creator_name
        FROM templates t
        LEFT JOIN users u ON t.created_by = u.id
        ORDER BY t.is_system DESC, t.created_at DESC
      `).all();

      res.json(templates);
    } catch (err) {
      console.error('Error fetching templates:', err);
      res.status(500).json({ error: 'فشل جلب نماذج المراسلات الحكومية: ' + err.message });
    }
  });

  // 2. Create a new custom template
  app.post('/api/templates', authMiddleware, (req, res) => {
    const { title, category, desc = '', prompt, icon = 'FileText' } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'عنوان النموذج مطلوب' });
    }
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'نص وهيكل النموذج الإجرائي مطلوب' });
    }
    if (!category || !category.trim()) {
      return res.status(400).json({ error: 'تصنيف النموذج مطلوب' });
    }

    const templateId = 'tmpl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    try {
      db.prepare(`
        INSERT INTO templates (id, title, category, desc, prompt, icon, is_system, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        templateId,
        title.trim(),
        category.trim(),
        (desc || '').trim(),
        prompt.trim(),
        icon || 'FileText',
        req.user.id
      );

      const created = db.prepare(`
        SELECT t.*, u.display_name as creator_name
        FROM templates t
        LEFT JOIN users u ON t.created_by = u.id
        WHERE t.id = ?
      `).get(templateId);

      if (typeof logAudit === 'function') {
        logAudit(req.user.id, 'CREATE_TEMPLATE', `إنشاء نموذج إداري جديد: ${title.trim()} (${templateId})`, req.ip);
      }

      res.status(201).json(created);
    } catch (err) {
      console.error('Error creating template:', err);
      res.status(500).json({ error: 'فشل إنشاء النموذج: ' + err.message });
    }
  });

  // 3. Update an existing template
  app.put('/api/templates/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const { title, category, desc, prompt, icon } = req.body;

    const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'النموذج غير موجود' });
    }

    // Regular users can only edit templates they created; admins can edit any template
    if (existing.is_system === 1 && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'لا يمكن تعديل النماذج السيادية المعتمدة إلا من قبل مسؤول المنظومة' });
    }

    if (existing.is_system === 0 && existing.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا النموذج' });
    }

    try {
      const updatedTitle = title !== undefined ? title.trim() : existing.title;
      const updatedCategory = category !== undefined ? category.trim() : existing.category;
      const updatedDesc = desc !== undefined ? desc.trim() : existing.desc;
      const updatedPrompt = prompt !== undefined ? prompt.trim() : existing.prompt;
      const updatedIcon = icon !== undefined ? icon : existing.icon;

      db.prepare(`
        UPDATE templates 
        SET title = ?, category = ?, desc = ?, prompt = ?, icon = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updatedTitle, updatedCategory, updatedDesc, updatedPrompt, updatedIcon, id);

      const updated = db.prepare(`
        SELECT t.*, u.display_name as creator_name
        FROM templates t
        LEFT JOIN users u ON t.created_by = u.id
        WHERE t.id = ?
      `).get(id);

      if (typeof logAudit === 'function') {
        logAudit(req.user.id, 'UPDATE_TEMPLATE', `تعديل نموذج إداري: ${updatedTitle} (${id})`, req.ip);
      }

      res.json(updated);
    } catch (err) {
      console.error('Error updating template:', err);
      res.status(500).json({ error: 'فشل تعديل النموذج: ' + err.message });
    }
  });

  // 4. Delete a custom template
  app.delete('/api/templates/:id', authMiddleware, (req, res) => {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'النموذج غير موجود' });
    }

    if (existing.is_system === 1 && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'لا يمكن حذف النماذج السيادية الأساسية إلا من قبل مدير المنظومة' });
    }

    if (existing.is_system === 0 && existing.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح لك بحذف هذا النموذج' });
    }

    try {
      db.prepare('DELETE FROM templates WHERE id = ?').run(id);

      if (typeof logAudit === 'function') {
        logAudit(req.user.id, 'DELETE_TEMPLATE', `حذف نموذج إداري: ${existing.title} (${id})`, req.ip);
      }

      res.json({ message: 'تم حذف النموذج بنجاح' });
    } catch (err) {
      console.error('Error deleting template:', err);
      res.status(500).json({ error: 'فشل حذف النموذج: ' + err.message });
    }
  });
}

module.exports = {
  registerTemplateRoutes
};
