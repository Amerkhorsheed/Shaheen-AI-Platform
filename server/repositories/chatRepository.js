'use strict';

/**
 * Chat and message persistence.
 *
 * Every read and write is scoped by `user_id`. Ownership is enforced in the
 * WHERE clause rather than by a separate check, so there is no code path that
 * can reach another user's conversation by supplying its id.
 */

const { queryOne, queryMany, execute } = require('../db/pool');

function listForUser(userId) {
  return queryMany(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM messages m WHERE m.chat_id = c.id) AS message_count,
            (SELECT m.content FROM messages m WHERE m.chat_id = c.id
             ORDER BY m.created_at DESC LIMIT 1)                          AS last_message
     FROM chats c
     WHERE c.user_id = $1
     ORDER BY c.pinned DESC, c.updated_at DESC`,
    [userId]
  );
}

/** Returns the chat only if it belongs to this user. */
function findOwned(chatId, userId) {
  return queryOne('SELECT * FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
}

function findById(chatId) {
  return queryOne('SELECT * FROM chats WHERE id = $1', [chatId]);
}

function insert(chat) {
  return queryOne(
    `INSERT INTO chats (id, user_id, title, model, system_prompt, classification)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [chat.id, chat.userId, chat.title, chat.model, chat.systemPrompt, chat.classification]
  );
}

function update(chatId, userId, fields) {
  return queryOne(
    `UPDATE chats
     SET title = $1, pinned = $2, model = $3, system_prompt = $4,
         classification = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $6 AND user_id = $7
     RETURNING *`,
    [
      fields.title,
      fields.pinned ? 1 : 0,
      fields.model,
      fields.systemPrompt,
      fields.classification,
      chatId,
      userId
    ]
  );
}

function touch(chatId) {
  return execute('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);
}

/** Messages cascade via the foreign key. */
function remove(chatId, userId) {
  return execute('DELETE FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
}

function listMessages(chatId) {
  return queryMany('SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chatId]);
}

function countMessages(chatId) {
  return queryOne('SELECT COUNT(*)::int AS count FROM messages WHERE chat_id = $1', [
    chatId
  ]).then((r) => r.count);
}

function insertMessage(message) {
  return queryOne(
    `INSERT INTO messages (id, chat_id, role, content, attachments, model_used)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      message.id,
      message.chatId,
      message.role,
      message.content,
      message.attachments,
      message.modelUsed ?? null
    ]
  );
}

function deleteMessages(chatId) {
  return execute('DELETE FROM messages WHERE chat_id = $1', [chatId]);
}

module.exports = {
  listForUser,
  findOwned,
  findById,
  insert,
  update,
  touch,
  remove,
  listMessages,
  countMessages,
  insertMessage,
  deleteMessages
};
