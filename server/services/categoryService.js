'use strict';

const crypto = require('node:crypto');

const categoryRepository = require('../repositories/categoryRepository');
const userRepository = require('../repositories/userRepository');
const auditService = require('./auditService');
const { BadRequestError, ConflictError, NotFoundError } = require('../lib/errors');

function list() {
  return categoryRepository.listWithUserCounts();
}

async function create(input, actor, ipAddress) {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();

  if (await categoryRepository.findByNameOrCode(name, code)) {
    throw new ConflictError('اسم التصنيف أو رمزه الكودي مسجل مسبقاً');
  }

  const id = `cat_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

  const category = await categoryRepository.insert({
    id,
    name,
    code,
    description: input.description?.trim() || '',
    clearanceLevel: input.clearance_level,
    color: input.color,
    promptContext: input.prompt_context?.trim() || ''
  });

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.CATEGORY_CREATED,
    details: { categoryId: id, name, code },
    ipAddress
  });

  return { message: 'تم إنشاء التصنيف المؤسسي بنجاح', category };
}

async function remove(id, actor, ipAddress) {
  const category = await categoryRepository.findById(id);
  if (!category) throw new NotFoundError('التصنيف غير موجود');

  // Users reference their category as their department; orphaning them would
  // silently strip the institutional context injected into every prompt.
  const assigned = await userRepository.countByCategory(id);
  if (assigned > 0) {
    throw new BadRequestError(
      `لا يمكن حذف هذا التصنيف لوجود ${assigned} مستخدم مرتبط به حالياً. يرجى نقل المستخدمين إلى تصنيف آخر أولاً.`
    );
  }

  await categoryRepository.remove(id);

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.CATEGORY_DELETED,
    details: { categoryId: id, name: category.name },
    ipAddress
  });

  return { message: 'تم حذف التصنيف المؤسسي بنجاح' };
}

module.exports = { list, create, remove };
