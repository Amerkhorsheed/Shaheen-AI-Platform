'use strict';

/**
 * Chat sessions.
 *
 * Every operation takes the caller's id and resolves the chat through
 * `findOwned`. A chat that belongs to someone else is reported as not found,
 * so an id cannot be used to probe for another user's conversations.
 */

const crypto = require('node:crypto');

const { transaction } = require('../db/pool');
const chatRepository = require('../repositories/chatRepository');
const auditService = require('./auditService');
const { decodeFilename } = require('./fileService');
const { NotFoundError, ConflictError } = require('../lib/errors');

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function list(userId) {
  return chatRepository.listForUser(userId);
}

/** @throws {NotFoundError} when the chat is missing *or* owned by someone else. */
async function requireOwned(chatId, userId) {
  const chat = await chatRepository.findOwned(chatId, userId);
  if (!chat) throw new NotFoundError('المحادثة غير موجودة');
  return chat;
}

async function get(chatId, userId) {
  const chat = await requireOwned(chatId, userId);
  const messages = await chatRepository.listMessages(chatId);

  return {
    ...chat,
    messages: messages.map((message) => ({
      ...message,
      attachments: parseAttachments(message.attachments)
    }))
  };
}

function parseAttachments(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((att) => {
      if (att && typeof att === 'object' && att.filename) {
        return { ...att, filename: decodeFilename(att.filename) };
      }
      return att;
    });
  } catch (e) {
    // A malformed attachment blob must not break loading the conversation.
    return [];
  }
}

async function create(input, userId) {
  const id = input.id || generateId('chat');

  if (await chatRepository.findById(id)) {
    throw new ConflictError('معرف الجلسة مستخدم مسبقاً');
  }

  return chatRepository.insert({
    id,
    userId,
    title: input.title,
    model: input.model,
    systemPrompt: input.systemPrompt,
    classification: input.classification
  });
}

async function update(chatId, userId, input) {
  const existing = await requireOwned(chatId, userId);

  return chatRepository.update(chatId, userId, {
    title: input.title !== undefined ? input.title.trim() : existing.title,
    pinned: input.pinned !== undefined ? input.pinned : Boolean(existing.pinned),
    model: input.model !== undefined ? input.model : existing.model,
    systemPrompt: input.systemPrompt !== undefined ? input.systemPrompt : existing.system_prompt,
    classification: input.classification !== undefined ? input.classification : existing.classification
  });
}

async function remove(chatId, userId, ipAddress) {
  const chat = await requireOwned(chatId, userId);

  // Messages cascade, but the delete is wrapped so a partial removal can never
  // be observed by a concurrent reader.
  await transaction(() => chatRepository.remove(chatId, userId));

  await auditService.record({
    userId,
    action: auditService.ACTIONS.DELETE_CHAT,
    details: { chatId, title: chat.title },
    ipAddress
  });

  return { message: 'تم حذف المحادثة بنجاح' };
}

async function addMessage(chatId, userId, input) {
  await requireOwned(chatId, userId);

  const id = input.id || generateId('msg');

  return transaction(async () => {
    const cleanAttachments = (Array.isArray(input.attachments) ? input.attachments : []).map((att) => {
      if (att && typeof att === 'object' && att.filename) {
        return { ...att, filename: decodeFilename(att.filename) };
      }
      return att;
    });

    const message = await chatRepository.insertMessage({
      id,
      chatId,
      role: input.role,
      content: input.content,
      attachments: JSON.stringify(cleanAttachments),
      modelUsed: input.modelUsed
    });
    await chatRepository.touch(chatId);
    return {
      ...message,
      attachments: parseAttachments(message.attachments)
    };
  });
}

async function clearMessages(chatId, userId, ipAddress) {
  const chat = await requireOwned(chatId, userId);
  const removed = await chatRepository.countMessages(chatId);

  await transaction(async () => {
    await chatRepository.deleteMessages(chatId);
    await chatRepository.touch(chatId);
  });

  await auditService.record({
    userId,
    action: auditService.ACTIONS.CLEAR_CHAT_MESSAGES,
    details: { chatId, title: chat.title, messagesRemoved: removed },
    ipAddress
  });

  return { message: 'تم إفراغ سجل الرسائل بنجاح', messagesRemoved: removed };
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  addMessage,
  clearMessages,
  requireOwned
};
