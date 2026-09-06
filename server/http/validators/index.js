'use strict';

/**
 * Request schemas.
 *
 * Every mutating endpoint declares the exact shape it accepts. Unknown keys
 * are stripped, strings are trimmed and length-capped, and enumerations are
 * checked here rather than by hand-rolled `String(x).trim().slice(0, n)` calls
 * scattered through the handlers.
 */

const { z } = require('zod');

const { VALID_CLASSIFICATIONS } = require('../../templates/classifications');

const ROLES = ['superadmin', 'admin', 'analyst', 'auditor', 'user'];
const STATUSES = ['active', 'suspended'];
const CLEARANCE_LEVELS = ['top_secret', 'secret', 'official', 'unclassified'];

/** A trimmed, length-capped string. */
const text = (max, message) => z.string().trim().max(max, message ?? `النص يتجاوز ${max} حرفاً`);

/** A trimmed string that must not be empty. */
const requiredText = (max, message) => text(max).min(1, message);

const objectId = (prefix) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,64}$`), 'المعرف غير صالح')
    .optional();

// ---------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------
const loginSchema = z.object({
  username: requiredText(128, 'يرجى إدخال اسم المستخدم'),
  password: z.string().min(1, 'يرجى إدخال كلمة المرور').max(256)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'كلمة المرور الحالية مطلوبة').max(256),
  newPassword: z.string().min(1, 'كلمة المرور الجديدة مطلوبة').max(256)
});

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------
const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9._-]{3,32}$/,
      'اسم المستخدم يجب أن يتكون من 3 إلى 32 خانة (أحرف لاتينية صغيرة وأرقام و . _ - فقط)'
    ),
  password: z.string().min(1, 'كلمة المرور مطلوبة').max(256),
  displayName: text(255).optional(),
  role: z.enum(ROLES, { message: 'الصلاحية المحددة غير معتمدة' }).optional(),
  categoryId: requiredText(64, 'يجب تحديد التصنيف / الإدارة المؤسسية للمستخدم (حقل إلزامي)'),
  jobTitle: text(255).optional(),
  notes: text(2000).optional()
});

const updateUserSchema = z
  .object({
    displayName: text(255).optional(),
    role: z.enum(ROLES, { message: 'الصلاحية المحددة غير معتمدة' }).optional(),
    categoryId: text(64).optional(),
    jobTitle: text(255).optional(),
    status: z.enum(STATUSES, { message: 'حالة الحساب المحددة غير معتمدة' }).optional(),
    notes: text(2000).optional(),
    newPassword: z.string().max(256).optional()
  })
  .strict();

const userIdParam = z.object({
  id: z.coerce.number().int().positive('معرف المستخدم غير صالح')
});

// ---------------------------------------------------------------
// Categories
// ---------------------------------------------------------------
const createCategorySchema = z.object({
  name: requiredText(255, 'اسم التصنيف مطلوب'),
  code: requiredText(32, 'رمز التصنيف الكودي مطلوب (مثال: SEC, LAW)'),
  description: text(1000).optional(),
  clearance_level: z
    .enum(CLEARANCE_LEVELS, { message: 'درجة السرية المحددة غير معتمدة' })
    .default('official'),
  color: text(32).default('#02443A'),
  prompt_context: text(4000).optional()
});

// ---------------------------------------------------------------
// Chats
// ---------------------------------------------------------------
const createChatSchema = z.object({
  id: objectId('chat'),
  title: text(300).default('جلسة عمل جديدة'),
  model: text(255).default(''),
  systemPrompt: z.string().max(20000).default(''),
  classification: z
    .enum(VALID_CLASSIFICATIONS, { message: 'درجة التصنيف المحددة غير معتمدة' })
    .default('official')
});

const updateChatSchema = z
  .object({
    title: text(300).optional(),
    pinned: z
      .union([z.boolean(), z.number().int().min(0).max(1)])
      .transform((v) => Boolean(v))
      .optional(),
    model: text(255).optional(),
    systemPrompt: z.string().max(20000).optional(),
    classification: z
      .enum(VALID_CLASSIFICATIONS, { message: 'درجة التصنيف المحددة غير معتمدة' })
      .optional()
  })
  .strict();

const createMessageSchema = z.object({
  id: objectId('msg'),
  role: z.enum(['user', 'assistant', 'system'], { message: 'نوع الرسالة غير صالح' }),
  content: z.string().max(1_000_000, 'محتوى الرسالة يتجاوز الحد المسموح'),
  attachments: z.array(z.unknown()).default([]),
  modelUsed: text(255).optional()
});

// ---------------------------------------------------------------
// Templates
// ---------------------------------------------------------------
const createTemplateSchema = z
  .object({
    title: requiredText(300, 'عنوان النموذج مطلوب'),
    category: requiredText(150, 'تصنيف النموذج مطلوب'),
    description: text(600).optional(),
    // Accepted for backwards compatibility with clients that still send `desc`.
    desc: text(600).optional(),
    prompt: requiredText(20000, 'نص وهيكل النموذج الإجرائي مطلوب'),
    icon: text(40).default('FileText')
  })
  .strict();

const updateTemplateSchema = z
  .object({
    title: requiredText(300, 'عنوان النموذج مطلوب').optional(),
    category: requiredText(150, 'تصنيف النموذج مطلوب').optional(),
    description: text(600).optional(),
    desc: text(600).optional(),
    prompt: requiredText(20000, 'نص النموذج مطلوب').optional(),
    icon: text(40).optional()
  })
  .strict();

// ---------------------------------------------------------------
// Settings
// ---------------------------------------------------------------
// Values are strings; which keys are permitted is enforced by the service,
// which owns the allowlist.
const updateSettingsSchema = z.record(z.string(), z.string().max(20000));

// ---------------------------------------------------------------
// Model
// ---------------------------------------------------------------
const chatCompletionSchema = z.object({
  model: text(255).optional(),
  // Optional: when supplied and owned by the caller, the chat's own
  // classification and session note feed into the composed system prompt.
  chatId: text(96).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant'], { message: 'بنية الرسائل غير صالحة' }),
        content: z.string()
      })
    )
    .min(1, 'قائمة الرسائل غير صالحة'),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  max_tokens: z.coerce.number().int().min(1).max(32768).default(4096)
});

// ---------------------------------------------------------------
// Exports
// ---------------------------------------------------------------
const exportDocumentSchema = z.object({
  ticket: z.string().min(1),
  title: text(300).default('وثيقة صادرة عن المنظومة'),
  content: z.string().default(''),
  // Arrives as a JSON string from a form post.
  metadata: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .default({})
    .transform((value) => {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch (e) {
        return {};
      }
    })
});

const exportDatasetSchema = z.object({
  ticket: z.string().min(1),
  csvData: z.string().default(''),
  filename: text(255).default('shaheen_gov_table.xlsx'),
  title: text(200).optional(),
  tableTitle: text(200).default('مصفوفة البيانات وجداول المؤشرات')
});

// ---------------------------------------------------------------
// System prompt library
// ---------------------------------------------------------------
const createPromptModuleSchema = z
  .object({
    name: requiredText(200, 'اسم وحدة التعليمات مطلوب'),
    description: text(1000).optional(),
    content: requiredText(20000, 'نص وحدة التعليمات مطلوب')
  })
  .strict();

const updatePromptModuleSchema = z
  .object({
    name: requiredText(200, 'اسم وحدة التعليمات مطلوب').optional(),
    description: text(1000).optional(),
    content: requiredText(20000, 'نص وحدة التعليمات مطلوب').optional()
  })
  .strict();

const setCategoryModulesSchema = z
  .object({
    // Order is meaningful: it fixes the assembly order of the prompt.
    moduleIds: z.array(requiredText(64)).max(20, 'لا يمكن ربط أكثر من 20 وحدة بتصنيف واحد')
  })
  .strict();

const promptPreviewSchema = z.object({
  classification: z.enum(VALID_CLASSIFICATIONS).default('official')
});

// ---------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

module.exports = {
  ROLES,
  STATUSES,
  CLEARANCE_LEVELS,
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  userIdParam,
  createCategorySchema,
  createChatSchema,
  updateChatSchema,
  createMessageSchema,
  createTemplateSchema,
  updateTemplateSchema,
  updateSettingsSchema,
  chatCompletionSchema,
  createPromptModuleSchema,
  updatePromptModuleSchema,
  setCategoryModulesSchema,
  promptPreviewSchema,
  exportDocumentSchema,
  exportDatasetSchema,
  paginationSchema
};
