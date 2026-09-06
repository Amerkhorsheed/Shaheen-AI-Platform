/**
 * File & Document Attachment Service
 *
 * Manages multipart uploads and document attachments for processing and indexing.
 */

import { http } from './core/httpClient.js';

/**
 * Fix filenames that may have been decoded as Latin-1 / Windows-1252 instead of UTF-8.
 * Preserves normal UTF-8 Arabic text, ASCII, and legitimately accented text.
 * @param {string} name
 * @returns {string}
 */
export function decodeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  if (/[\u00C0-\u00FF]/.test(name)) {
    try {
      const bytes = new Uint8Array([...name].map((c) => c.charCodeAt(0)));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (decoded && decoded !== name) {
        return decoded;
      }
    } catch (_) {}
  }
  return name;
}

export const filesService = {
  /**
   * Upload an iterable list of browser File objects.
   * @param {FileList|Array<File>} fileList
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async uploadFiles(fileList) {
    const formData = new FormData();
    for (const file of fileList) {
      formData.append('files', file);
    }
    const data = await http.upload('/upload', formData);
    const files = Array.isArray(data?.files) ? data.files : [];
    return files.map((file) => {
      if (file && typeof file === 'object') {
        return {
          ...file,
          filename: decodeFilename(file.filename)
        };
      }
      if (typeof file === 'string') {
        return decodeFilename(file);
      }
      return file;
    });
  }
};

