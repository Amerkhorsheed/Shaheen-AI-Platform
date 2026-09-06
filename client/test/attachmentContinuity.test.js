import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareUserAttachments,
  formatMessageWithAttachments
} from '../src/hooks/useLlm.js';

describe('Attachment Continuity & Multi-Turn Context', () => {
  it('prepareUserAttachments normalises file fields and preserves text/preview', () => {
    const rawFiles = [
      {
        filename: 'جدول_البيانات_المالي.csv',
        size: 614,
        mimeType: 'text/csv',
        text: 'الرقم التسلسلي,المبلغ\nTXN-001,15000\nTXN-002,8500',
        preview: 'الرقم التسلسلي,المبلغ...',
        truncated: false
      }
    ];

    const prepared = prepareUserAttachments(rawFiles);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].filename, 'جدول_البيانات_المالي.csv');
    assert.equal(prepared[0].size, 614);
    assert.equal(prepared[0].type, 'text/csv');
    assert.equal(prepared[0].text, 'الرقم التسلسلي,المبلغ\nTXN-001,15000\nTXN-002,8500');
    assert.equal(prepared[0].preview, 'الرقم التسلسلي,المبلغ...');
    assert.equal(prepared[0].truncated, false);
  });

  it('prepareUserAttachments gracefully handles empty, missing, or malformed inputs', () => {
    assert.deepEqual(prepareUserAttachments([]), []);
    assert.deepEqual(prepareUserAttachments(null), []);
    assert.deepEqual(prepareUserAttachments(undefined), []);
  });

  it('formatMessageWithAttachments returns plain content when no attachments exist', () => {
    const msg = {
      role: 'user',
      content: 'هل غطيت الملف كامل'
    };
    assert.equal(formatMessageWithAttachments(msg), 'هل غطيت الملف كامل');
  });

  it('formatMessageWithAttachments re-injects full document text for historical messages', () => {
    const msg = {
      role: 'user',
      content: 'حلل هذا',
      attachments: [
        {
          filename: 'جدول_البيانات_المالي.csv',
          size: 614,
          type: 'text/csv',
          text: 'الرقم التسلسلي,المبلغ\nTXN-001,15000\nTXN-002,8500\nTXN-003,120000',
          preview: 'الرقم التسلسلي...'
        }
      ]
    };

    const formatted = formatMessageWithAttachments(msg);
    assert.ok(formatted.startsWith('حلل هذا'));
    assert.ok(formatted.includes('[محتوى الملف المرفق: جدول_البيانات_المالي.csv]'));
    assert.ok(formatted.includes('TXN-003,120000'));
  });

  it('formatMessageWithAttachments avoids duplicate injection if marker already present', () => {
    const msg = {
      role: 'user',
      content: 'حلل هذا\n\n[محتوى الملف المرفق: جدول_البيانات_المالي.csv]\n```\nTXN-001\n```',
      attachments: [
        {
          filename: 'جدول_البيانات_المالي.csv',
          text: 'TXN-001'
        }
      ]
    };

    const formatted = formatMessageWithAttachments(msg);
    const count = (formatted.match(/\[محتوى الملف المرفق: جدول_البيانات_المالي\.csv\]/g) || []).length;
    assert.equal(count, 1, 'must not duplicate attachment block');
  });

  it('formatMessageWithAttachments provides legacy fallback for older chats lacking stored text', () => {
    const legacyMsg = {
      role: 'user',
      content: 'حلل هذا',
      attachments: [
        {
          filename: 'جدول_البيانات_المالي.csv',
          size: 614,
          type: 'text/csv'
        }
      ]
    };

    const formatted = formatMessageWithAttachments(legacyMsg);
    assert.ok(formatted.includes('[مرفق معتمد في الجلسة: جدول_البيانات_المالي.csv] (بحجم 0.6 KB)'));
  });

  it('simulates multi-turn conversation preserving file content across turns', () => {
    const conversationHistory = [
      {
        role: 'user',
        content: 'حلل هذا',
        attachments: [
          {
            filename: 'جدول_البيانات_المالي.csv',
            size: 614,
            type: 'text/csv',
            text: 'TXN-001,15000\nTXN-002,8500\nTXN-003,120000\nTXN-004,5250\nTXN-005,45000'
          }
        ]
      },
      {
        role: 'assistant',
        content: 'الخلاصة التنفيذية: يتضمن الجدول 5 معاملات مالية بإجمالي 193,750.00 ريالاً.'
      }
    ];

    // Next turn prompt construction:
    const promptMessages = [];
    conversationHistory.forEach((m) => {
      promptMessages.push({ role: m.role, content: formatMessageWithAttachments(m) });
    });
    promptMessages.push({ role: 'user', content: 'هل غطيت الملف كامل' });

    // Verify Turn 2 prompt contains the original file data:
    assert.equal(promptMessages.length, 3);
    assert.ok(promptMessages[0].content.includes('TXN-003,120000'));
    assert.ok(promptMessages[0].content.includes('[محتوى الملف المرفق: جدول_البيانات_المالي.csv]'));
    assert.equal(promptMessages[2].content, 'هل غطيت الملف كامل');
  });
});
