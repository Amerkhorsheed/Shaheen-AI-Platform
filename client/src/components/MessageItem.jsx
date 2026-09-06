import React, { useState } from 'react';
import { Copy, Check, RotateCcw, Printer, FileSpreadsheet, FileText, User, Shield } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import MarkdownRenderer from './MarkdownRenderer';
import { api } from '../services/api';

function extractMarkdownTablesToCsv(text) {
  const lines = text.split('\n');
  const tableRows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        continue;
      }
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => {
          let val = c.trim().replace(/"/g, '""');
          if (val.includes(',') || val.includes('\n') || val.includes('"')) {
            return `"${val}"`;
          }
          return val;
        });
      tableRows.push(cells.join(','));
      inTable = true;
    } else if (inTable) {
      tableRows.push('');
      inTable = false;
    }
  }

  return tableRows.join('\r\n');
}

export default function MessageItem({ message, isStreaming = false, onRegenerate, currentModel = '', classification = 'official' }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPdf = () => {
    const title = 'مستخرج قرار ومذكرة رسمية — منظومة OSS للذكاء الاصطناعي';
    api.exportPdf(title, message.content, { 
      model: currentModel || 'النموذج المحلي المعتمد',
      classification 
    });
  };

  const handleExportXlsx = () => {
    const csvData = extractMarkdownTablesToCsv(message.content);
    if (!csvData || !csvData.trim()) {
      alert('لم يتم العثور على جداول بيانات منسقة في هذا الرد لتصديرها.');
      return;
    }
    const filename = `shaheen_gov_tables_${Date.now()}.xlsx`;
    api.exportXlsx(csvData, filename, 'مصفوفة البيانات وجداول المؤشرات الرسمية');
  };

  const handleExportCsv = () => {
    const csvData = extractMarkdownTablesToCsv(message.content);
    if (!csvData || !csvData.trim()) {
      alert('لم يتم العثور على جداول بيانات منسقة في هذا الرد لتصديرها.');
      return;
    }
    const filename = `shaheen_gov_tables_${Date.now()}.xlsx`;
    api.openCsvPreviewPage(csvData, filename, 'بوابة فحص وتصدير جداول البيانات الرسمية');
  };

  const hasTable = message.content && /\|.+\|.+\|/.test(message.content);

  return (
    <div className={`py-5 px-4 md:px-6 transition-colors ${isUser ? 'bg-transparent' : 'bg-[#FBFAF6]/80 border-y border-[#EDE7D8]'}`}>
      <div className="max-w-4xl mx-auto flex gap-4 md:gap-5 items-start">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-0.5">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-[#EBE6D9] text-[#02443A] flex items-center justify-center border border-[#DDD8CA] shadow-2xs font-bold">
              <User className="w-4 h-4" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#02443A] to-[#002723] p-1.5 flex items-center justify-center border border-[#B79E6A]/70 shadow-xs">
              <EagleEmblem className="w-6 h-4.5" fill="#E8D9A8" />
            </div>
          )}
        </div>

        {/* Message Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs md:text-sm text-[#02443A]">
                {isUser ? 'الجهة المستفسرة (المستخدم)' : 'منظومة OSS السيادية'}
              </span>
              {!isUser && (
                <span className="px-2 py-0.5 rounded-full bg-[#E7F0EA] text-[#2E6B4F] text-[10px] font-bold border border-[#2E6B4F]/20">
                  معتمد رسمياً
                </span>
              )}
            </div>
            <span className="text-[11px] text-[#7A7A7B]">
              {message.created_at ? new Date(message.created_at).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>

          {/* Attached files preview */}
          {isUser && message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.attachments.map((file, idx) => (
                <div key={idx} className="flex items-center gap-1.5 px-3 py-1 bg-[#F0EDE4] border border-[#DDD8CA] rounded-lg text-xs text-[#02443A] font-semibold">
                  <FileText className="w-3.5 h-3.5 text-[#B79E6A]" />
                  <span className="truncate max-w-[200px]">{file.filename || file.name}</span>
                  <span className="text-[10px] text-[#7A7A7B] font-normal">
                    {file.size ? `(${(file.size / 1024).toFixed(1)} KB)` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Text Content */}
          <div className="break-words">
            {isUser ? (
              <p className="whitespace-pre-wrap text-sm md:text-base text-[#14201C] leading-relaxed">
                {message.content}
              </p>
            ) : (
              <div>
                <MarkdownRenderer content={message.content} />
                {isStreaming && <span className="typing-cursor"></span>}
              </div>
            )}
          </div>

          {/* Official Action Bar */}
          {!isUser && !isStreaming && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-[#EDE7D8] text-xs text-[#5E6B64]">
              {/* Copy */}
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#EDE7D8] hover:text-[#02443A] font-semibold transition-colors"
                title="نسخ نص الوثيقة"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#2E6B4F]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
              </button>

              {/* Official PDF Print Export */}
              <button
                onClick={handleExportPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold transition-all shadow-xs"
                title="فتح صفحة الطباعة الرسمية لحفظ الرد كملف PDF مروّس"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>تصدير كوثيقة رسمية (PDF)</span>
              </button>

              {/* Sovereign Excel (.xlsx) Export (if table detected) */}
              {hasTable && (
                <button
                  onClick={handleExportXlsx}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#107C41] hover:bg-[#0c5c30] text-white font-bold transition-all shadow-xs"
                  title="تصدير جداول البيانات كملف Excel (.xlsx) رسمي مروّس وموجه من اليمين لليسار"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
                  <span>تصدير مصنّف Excel (.xlsx)</span>
                </button>
              )}

              {/* Government Table Inspection Portal */}
              {hasTable && (
                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E7F0EA] hover:bg-[#d8e7dc] text-[#2E6B4F] font-bold transition-colors border border-[#2E6B4F]/30"
                  title="فتح بوابة فحص وتصفية وتحليل الجداول والبيانات الرسمية"
                >
                  <span>👁️ فحص وبحث في الجداول</span>
                </button>
              )}

              {/* Regenerate if handler provided */}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-[#EDE7D8] hover:text-[#02443A] font-semibold transition-colors mr-auto"
                  title="إعادة المعالجة"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة الصياغة</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
