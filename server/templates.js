const crypto = require('crypto');
const { db, logAudit } = require('./db');
const { writeLimiter } = require('./auth');

const MAX_TITLE = 200;
const MAX_CATEGORY = 100;
const MAX_DESCRIPTION = 600;
const MAX_PROMPT = 20000;

// The column is `description` (`desc` is a reserved SQL keyword). The alias
// keeps older clients that still read `desc` working during the transition.
// better-sqlite3 is synchronous — none of these calls return a promise.
const TEMPLATE_SELECT = `
  SELECT t.id, t.title, t.category, t.description, t.description as "desc",
         t.prompt, t.icon, t.is_system, t.created_by, t.created_at, t.updated_at,
         u.display_name as creator_name
  FROM templates t
  LEFT JOIN users u ON t.created_by = u.id
`;

/**
 * System templates are editable by administrators only; custom templates by
 * their author or an administrator.
 */
function canModify(template, user) {
  if (user.role === 'admin') return true;
  if (template.is_system === 1) return false;
  return template.created_by === user.id;
}

function registerTemplateRoutes(app, authMiddleware) {
  // 1. List all templates
  app.get('/api/templates', authMiddleware, async (req, res) => {
    const templates = await db.prepare(`${TEMPLATE_SELECT} ORDER BY t.is_system DESC, t.created_at DESC`).all();
    res.json(templates);
  });

  // 2. Create a custom template
  app.post('/api/templates', authMiddleware, writeLimiter, async (req, res) => {
    const { title, category, description, desc, prompt, icon = 'FileText' } = req.body || {};
    const summary = description !== undefined ? description : (desc || '');

    if (!title || !String(title).trim()) return res.status(400).json({ error: 'عنوان النموذج مطلوب' });
    if (!category || !String(category).trim()) return res.status(400).json({ error: 'تصنيف النموذج مطلوب' });
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'نص وهيكل النموذج الإجرائي مطلوب' });

    if (String(title).length > MAX_TITLE) return res.status(400).json({ error: `العنوان يتجاوز ${MAX_TITLE} حرفاً` });
    if (String(prompt).length > MAX_PROMPT) return res.status(400).json({ error: `نص النموذج يتجاوز ${MAX_PROMPT} حرفاً` });

    const templateId = 'tmpl_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');

    try {
      await db.prepare(`
        INSERT INTO templates (id, title, category, description, prompt, icon, is_system, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        templateId,
        String(title).trim().slice(0, MAX_TITLE),
        String(category).trim().slice(0, MAX_CATEGORY),
        String(summary).trim().slice(0, MAX_DESCRIPTION),
        String(prompt).trim().slice(0, MAX_PROMPT),
        String(icon || 'FileText').slice(0, 40),
        req.user.id
      );

      logAudit(req.user.id, 'TEMPLATE_CREATED', { templateId, title: String(title).trim().slice(0, 120) }, req.ip);
      res.status(201).json(await db.prepare(`${TEMPLATE_SELECT} WHERE t.id = ?`).get(templateId));
    } catch (err) {
      console.error('Error creating template:', err);
      res.status(500).json({ error: 'فشل إنشاء النموذج' });
    }
  });

  // 3. Update a template
  app.put('/api/templates/:id', authMiddleware, writeLimiter, async (req, res) => {
    const existing = await db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'النموذج غير موجود' });

    if (!canModify(existing, req.user)) {
      return res.status(403).json({
        error: existing.is_system === 1
          ? 'لا يمكن تعديل النماذج الأساسية المعتمدة إلا من قبل مسؤول المنظومة'
          : 'غير مصرح لك بتعديل هذا النموذج'
      });
    }

    const { title, category, description, desc, prompt, icon } = req.body || {};
    const summary = description !== undefined ? description : desc;

    if (title !== undefined && !String(title).trim()) return res.status(400).json({ error: 'عنوان النموذج مطلوب' });
    if (prompt !== undefined && !String(prompt).trim()) return res.status(400).json({ error: 'نص النموذج مطلوب' });
    if (prompt !== undefined && String(prompt).length > MAX_PROMPT) {
      return res.status(400).json({ error: `نص النموذج يتجاوز ${MAX_PROMPT} حرفاً` });
    }

    try {
      await db.prepare(`
        UPDATE templates
        SET title = ?, category = ?, description = ?, prompt = ?, icon = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title !== undefined ? String(title).trim().slice(0, MAX_TITLE) : existing.title,
        category !== undefined ? String(category).trim().slice(0, MAX_CATEGORY) : existing.category,
        summary !== undefined ? String(summary).trim().slice(0, MAX_DESCRIPTION) : (existing.description || ''),
        prompt !== undefined ? String(prompt).trim().slice(0, MAX_PROMPT) : existing.prompt,
        icon !== undefined ? String(icon).slice(0, 40) : existing.icon,
        req.params.id
      );

      logAudit(req.user.id, 'TEMPLATE_UPDATED', { templateId: req.params.id }, req.ip);
      res.json(await db.prepare(`${TEMPLATE_SELECT} WHERE t.id = ?`).get(req.params.id));
    } catch (err) {
      console.error('Error updating template:', err);
      res.status(500).json({ error: 'فشل تعديل النموذج' });
    }
  });

  // 4. Delete a template
  app.delete('/api/templates/:id', authMiddleware, async (req, res) => {
    const existing = await db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'النموذج غير موجود' });

    if (!canModify(existing, req.user)) {
      return res.status(403).json({
        error: existing.is_system === 1
          ? 'لا يمكن حذف النماذج الأساسية المعتمدة إلا من قبل مسؤول المنظومة'
          : 'غير مصرح لك بحذف هذا النموذج'
      });
    }

    await db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    logAudit(req.user.id, 'TEMPLATE_DELETED', { templateId: req.params.id, title: existing.title }, req.ip);
    res.json({ message: 'تم حذف النموذج بنجاح' });
  });
}

module.exports = { registerTemplateRoutes };
