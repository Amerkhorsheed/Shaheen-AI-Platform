/**
 * Document & Data Export Service
 *
 * Coordinates server-side single-use ticket acquisition, form navigation exports (PDF, XLSX),
 * client-side UTF-8 CSV generation, and sovereign document verification.
 */

import { http, API_BASE } from './core/httpClient.js';

/**
 * Submit an export request via a temporary hidden form to enable browser-level downloads or print views.
 * @param {string} action
 * @param {Record<string, string>} fields
 */
export function submitExportForm(action, fields) {
  if (typeof document === 'undefined') return;

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${API_BASE}${action.startsWith('/') ? action : `/${action}`}`;
  form.target = '_blank';

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export const exportService = {
  /**
   * Acquire a short-lived single-use ticket for form-based exports.
   * @returns {Promise<string>}
   */
  async getExportTicket() {
    const data = await http.post('/export/ticket');
    return data.ticket;
  },

  /**
   * Export content as a styled official government PDF document.
   * @param {string} title
   * @param {string} content
   * @param {Record<string, unknown>} [metadata={}]
   */
  async exportPdf(title, content, metadata = {}) {
    const ticket = await this.getExportTicket();
    submitExportForm('/export/pdf-page', {
      ticket,
      title,
      content,
      metadata: JSON.stringify(metadata)
    });
  },

  /**
   * Export CSV data as a styled Excel (.xlsx) file via server-side generation.
   * @param {string} csvData
   * @param {string} [filename='shaheen_gov_table.xlsx']
   * @param {string} [title='مصفوفة بيانات رسمية']
   */
  async exportXlsx(csvData, filename = 'shaheen_gov_table.xlsx', title = 'مصفوفة بيانات رسمية') {
    const ticket = await this.getExportTicket();
    const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    submitExportForm('/export/xlsx', {
      ticket,
      csvData,
      filename: safeFilename,
      title
    });
  },

  /**
   * Export CSV data completely client-side with UTF-8 BOM encoding.
   * @param {string} csvData
   * @param {string} [filename='shaheen_table.csv']
   */
  exportCsv(csvData, filename = 'shaheen_table.csv') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Open the official CSV interactive preview inspection portal in a new tab.
   * @param {string} csvData
   * @param {string} [filename='shaheen_gov_table.xlsx']
   * @param {string} [tableTitle='مصفوفة البيانات']
   */
  async openCsvPreviewPage(csvData, filename = 'shaheen_gov_table.xlsx', tableTitle = 'مصفوفة البيانات') {
    const ticket = await this.getExportTicket();
    submitExportForm('/export/csv-page', { ticket, csvData, filename, tableTitle });
  },

  /**
   * Verify an official government document using its sovereign verification reference.
   * @param {string} ref
   * @returns {Promise<Record<string, unknown>>}
   */
  async verifyDocument(ref) {
    return http.get(`/export/verify/${encodeURIComponent(ref)}`);
  }
};
