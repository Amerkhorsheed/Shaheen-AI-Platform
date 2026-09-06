'use strict';

const crypto = require('node:crypto');

const templateRepository = require('../repositories/templateRepository');
const auditService = require('./auditService');
const { NotFoundError, ForbiddenError } = require('../lib/errors');

/**
 * System templates are editable by administrators only; a custom template by
 * its author or an administrator.
 */
function assertCanModify(template, actor, verb) {
  if (actor.role === 'admin' || actor.role === 'superadmin') return;

  if (template.is_system === 1) {
    throw new ForbiddenError(
      `لا يمكن ${verb} النماذج الأساسية المعتمدة إلا من قبل مسؤول المنظومة`
    );
  }
  if (template.created_by !== actor.id) {
    throw new ForbiddenError(`غير مصرح لك ب${verb} هذا النموذج`);
  }
}

function list() {
  return templateRepository.listAll();
}

async function create(input, actor, ipAddress) {
  const id = `tmpl_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

  await templateRepository.insert({
    id,
    title: input.title.trim(),
    category: input.category.trim(),
    description: (input.description ?? input.desc ?? '').trim(),
    prompt: input.prompt.trim(),
    icon: input.icon,
    createdBy: actor.id
  });

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.TEMPLATE_CREATED,
    details: { templateId: id, title: input.title.trim().slice(0, 120) },
    ipAddress
  });

  return templateRepository.findById(id);
}

async function update(id, input, actor, ipAddress) {
  const existing = await templateRepository.findRawById(id);
  if (!existing) throw new NotFoundError('النموذج غير موجود');
  assertCanModify(existing, actor, 'تعديل');

  const description = input.description !== undefined ? input.description : input.desc;

  await templateRepository.update(id, {
    title: input.title !== undefined ? input.title.trim() : existing.title,
    category: input.category !== undefined ? input.category.trim() : existing.category,
    description: description !== undefined ? description.trim() : existing.description || '',
    prompt: input.prompt !== undefined ? input.prompt.trim() : existing.prompt,
    icon: input.icon !== undefined ? input.icon : existing.icon
  });

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.TEMPLATE_UPDATED,
    details: { templateId: id },
    ipAddress
  });

  return templateRepository.findById(id);
}

async function remove(id, actor, ipAddress) {
  const existing = await templateRepository.findRawById(id);
  if (!existing) throw new NotFoundError('النموذج غير موجود');
  assertCanModify(existing, actor, 'حذف');

  await templateRepository.remove(id);

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.TEMPLATE_DELETED,
    details: { templateId: id, title: existing.title },
    ipAddress
  });

  return { message: 'تم حذف النموذج بنجاح' };
}

module.exports = { list, create, update, remove };
