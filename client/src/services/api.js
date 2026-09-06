/**
 * Shaheen Platform API Facade
 *
 * Provides a unified, 100% backwards-compatible interface for all client-side operations
 * while delegating internally to focused, single-responsibility domain services.
 *
 * @module api
 */

import { SESSION_ENDED_EVENT, PASSWORD_CHANGE_EVENT } from './core/events.js';
import { authService } from './auth.service.js';
import { usersService } from './users.service.js';
import { categoriesService } from './categories.service.js';
import { chatsService } from './chats.service.js';
import { filesService } from './files.service.js';
import { llmService } from './llm.service.js';
import { settingsService } from './settings.service.js';
import { templatesService } from './templates.service.js';
import { promptsService } from './prompts.service.js';
import { exportService } from './export.service.js';

export { SESSION_ENDED_EVENT, PASSWORD_CHANGE_EVENT };

/**
 * Consolidated API object preserving exact legacy signatures.
 */
export const api = {
  // --- AUTHENTICATION & SESSION ---
  login: (username, password) => authService.login(username, password),
  getMe: () => authService.getMe(),
  logout: () => authService.logout(),
  getStoredUser: () => authService.getStoredUser(),
  changePassword: (currentPassword, newPassword) => authService.changePassword(currentPassword, newPassword),

  // --- USER ADMINISTRATION ---
  getUsers: () => usersService.getUsers(),
  getUserStats: () => usersService.getUserStats(),
  createUser: (userData) => usersService.createUser(userData),
  updateUser: (userId, userData) => usersService.updateUser(userId, userData),
  deleteUser: (userId) => usersService.deleteUser(userId),

  // --- CATEGORIES & ORG STRUCTURE ---
  getCategories: () => categoriesService.getCategories(),
  createCategory: (categoryData) => categoriesService.createCategory(categoryData),
  deleteCategory: (categoryId) => categoriesService.deleteCategory(categoryId),

  // --- CHATS & MESSAGES ---
  getChats: () => chatsService.getChats(),
  getChat: (id) => chatsService.getChat(id),
  createChat: (chatData) => chatsService.createChat(chatData),
  updateChat: (id, updates) => chatsService.updateChat(id, updates),
  deleteChat: (id) => chatsService.deleteChat(id),
  saveMessage: (chatId, message) => chatsService.saveMessage(chatId, message),
  clearChat: (chatId) => chatsService.clearChat(chatId),

  // --- FILE UPLOADS ---
  uploadFiles: (fileList) => filesService.uploadFiles(fileList),

  // --- LM STUDIO MODELS & STREAMING ---
  getModels: () => llmService.getModels(),
  streamChat: (options) => llmService.streamChat(options),

  // --- SETTINGS ---
  getSettings: () => settingsService.getSettings(),
  updateSettings: (settings) => settingsService.updateSettings(settings),

  // --- GOVERNMENT TEMPLATES ---
  getTemplates: () => templatesService.getTemplates(),
  createTemplate: (templateData) => templatesService.createTemplate(templateData),
  updateTemplate: (id, templateData) => templatesService.updateTemplate(id, templateData),
  deleteTemplate: (id) => templatesService.deleteTemplate(id),

  // --- PROMPT LIBRARY & COMPOSABLE PROMPTS ---
  getPromptCharter: () => promptsService.getCharter(),
  getPromptModules: () => promptsService.getModules(),
  getPromptModule: (id) => promptsService.getModule(id),
  createPromptModule: (data) => promptsService.createModule(data),
  updatePromptModule: (id, data) => promptsService.updateModule(id, data),
  deletePromptModule: (id) => promptsService.deleteModule(id),
  getCategoryPromptModules: (categoryId) => promptsService.getCategoryModules(categoryId),
  setCategoryPromptModules: (categoryId, moduleIds) => promptsService.setCategoryModules(categoryId, moduleIds),
  previewPrompt: (categoryId, classification) => promptsService.preview(categoryId, classification),
  getEffectivePrompt: (classification) => promptsService.getEffective(classification),

  // --- EXPORTS & DOCUMENT VERIFICATION ---
  exportPdf: (title, content, metadata) => exportService.exportPdf(title, content, metadata),
  exportXlsx: (csvData, filename, title) => exportService.exportXlsx(csvData, filename, title),
  exportCsv: (csvData, filename) => exportService.exportCsv(csvData, filename),
  openCsvPreviewPage: (csvData, filename, tableTitle) => exportService.openCsvPreviewPage(csvData, filename, tableTitle),
  verifyDocument: (ref) => exportService.verifyDocument(ref)
};

export default api;
