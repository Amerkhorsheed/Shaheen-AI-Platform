/**
 * Centralized Services Export & API Facade
 *
 * Exposes domain services individually for modern tree-shaking and modular usage,
 * as well as a consolidated facade for unified access.
 */

export * from './core/events.js';
export * from './core/storage.js';
export * from './core/errors.js';
export * from './core/httpClient.js';

export { authService } from './auth.service.js';
export { usersService } from './users.service.js';
export { categoriesService } from './categories.service.js';
export { chatsService } from './chats.service.js';
export { filesService } from './files.service.js';
export { llmService } from './llm.service.js';
export { settingsService } from './settings.service.js';
export { templatesService } from './templates.service.js';
export { promptsService } from './prompts.service.js';
export { exportService } from './export.service.js';

export { api } from './api.js';
