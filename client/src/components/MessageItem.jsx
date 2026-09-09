import React, { useState } from 'react';
import { Copy, Check, RotateCcw, Printer, FileSpreadsheet, FileText, User, Shield, Loader2, ChevronDown, ChevronUp, Brain } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import MarkdownRenderer from './MarkdownRenderer';
import { exportService } from '../services/export.service.js';
import { decodeFilename } from '../services/files.service.js';
import { useDialog } from '../context/DialogContext.jsx';

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
      break;
    }
  }

  return tableRows.join('\r\n');
}

export default function MessageItem({ message, isStreaming = false, streamingReasoning = '', onRegenerate, currentModel = '', classification = 'official' }) {
  const [copied, setCopied] = useState(false);
  const [isReasoningOpen, setIsReasoningOpen] = useState(true);
  const dialog = useDialog();
  const isUser = message.role === 'user';

  const safeAttachments = (() => {
    if (!isUser || !message?.attachments) return [];
    let list = [];
    if (Array.isArray(message.attachments)) list = message.attachments;
    else if (typeof message.attachments === 'string') {
      try {
        const parsed = JSON.parse(message.attachments);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
    return list.map((file) => ({
      ...file,
      filename: decodeFilename(file.filename || file.name)
    }));
  })();

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPdf = () => {
    const title = 'مستخرج قرار ومذكرة رسمية — منظومة OSS للذكاء الاصطناعي';
    exportService.exportPdf(title, message.content, { 
      model: currentModel || 'النموذج المحلي المعتمد',
      classification 
    });
  };

  const handleExportXlsx = async () => {
    const csvData = extractMarkdownTablesToCsv(message.content);
    if (!csvData || !csvData.trim()) {
      await dialog.alert({
        title: 'تنبيه تصدير البيانات',
        message: 'لم يتم العثور على جداول بيانات منسقة في هذا الرد لتصديرها.',
        description: 'تأكد من أن الرد يحتوي على جدول بصيغة Markdown صالحة لاستخراج البيانات.',
        variant: 'warning'
      });
      return;
    }
    let title = 'مصفوفة البيانات وجداول المؤشرات الرسمية';
    const firstHeading = message.content.match(/^#+\s*(.+)$/m);
    if (firstHeading && firstHeading[1]) {
      title = firstHeading[1].trim();
    }
    const filename = `shaheen_gov_tables_${Date.now()}.xlsx`;
    exportService.exportXlsx(csvData, filename, title);
  };

  const handleExportCsv = async () => {
    const csvData = extractMarkdownTablesToCsv(message.content);
    if (!csvData || !csvData.trim()) {
      await dialog.alert({
        title: 'تنبيه تصدير البيانات',
        message: 'لم يتم العثور على جداول بيانات منسقة في هذا الرد لتصديرها.',
        description: 'تأكد من أن الرد يحتوي على جدول بصيغة Markdown صالحة لاستخراج البيانات.',
        variant: 'warning'
      });
      return;
    }
    let title = 'بوابة فحص وتصدير جداول البيانات الرسمية';
    const firstHeading = message.content.match(/^#+\s*(.+)$/m);
    if (firstHeading && firstHeading[1]) {
      title = firstHeading[1].trim();
    }
    const filename = `shaheen_gov_tables_${Date.now()}.xlsx`;
    exportService.openCsvPreviewPage(csvData, filename, title);
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
                {isUser ? 'الجهة المستفسرة (المستخدم)' : 'منظومة OSS'}
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
          {safeAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {safeAttachments.map((file, idx) => {
                const isSpreadsheet = /\.(xlsx?|xlsm|xlsb|csv)$/i.test(file.filename || file.name || '');
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border ${
                      isSpreadsheet
                        ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                        : 'bg-[#F0EDE4] border-[#DDD8CA] text-[#02443A]'
                    }`}
                  >
                    {isSpreadsheet ? (
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[#B79E6A] shrink-0" />
                    )}
                    <span className="truncate max-w-[200px]">{file.filename || file.name}</span>
                    <span className="text-[10px] text-[#5E6B64] font-normal">
                      {file.size ? `(${(file.size / 1024).toFixed(1)} KB)` : ''}
                    </span>
                    {file.isProfiled && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-medium border text-emerald-900 bg-emerald-100 border-emerald-400 font-mono">
                        100% ({file.totalRows?.toLocaleString('en-US')} سطر)
                      </span>
                    )}
                  </div>
                );
              })}
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
                {/* Live Reasoning / Processing Status Box */}
                {isStreaming && (streamingReasoning || !message.content) && (
                  <div className="mb-3 rounded-xl border border-[#B79E6A]/50 bg-[#FBF9F3] p-3 text-xs shadow-2xs">
                    <div
                      className="flex items-center justify-between cursor-pointer select-none"
                      onClick={() => setIsReasoningOpen(!isReasoningOpen)}
                    >
                      <div className="flex items-center gap-2 text-[#02443A] font-bold">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#B79E6A]" />
                        <span>
                          {streamingReasoning
                            ? 'جاري التحليل والتفكير المنطقي السيادي...'
                            : 'جاري فحص وتدقيق البيانات ومطابقتها مع الميثاق السيادي...'}
                        </span>
                      </div>
                      {streamingReasoning && (
                        <button
                          type="button"
                          className="text-[#8B6F3E] hover:text-[#02443A] flex items-center gap-1 text-[11px] font-semibold"
                        >
                          <span>{isReasoningOpen ? 'إخفاء التفكير' : 'عرض التفكير'}</span>
                          {isReasoningOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                    {isReasoningOpen && streamingReasoning && (
                      <div className="mt-2.5 pt-2 border-t border-[#DDD8CA]/60 text-[#5E6B64] font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap dir-ltr text-left">
                        {streamingReasoning}
                      </div>
                    )}
                  </div>
                )}

                {message.content ? (
                  <>
                    <MarkdownRenderer content={message.content} />
                    {isStreaming && <span className="typing-cursor"></span>}
                  </>
                ) : isStreaming ? (
                  <div className="flex items-center gap-2 text-xs text-[#5E6B64] py-1">
                    <span className="typing-cursor"></span>
                    <span>
                      {streamingReasoning
                        ? 'يجري التحقق والتدقيق المنطقي، وسيبدأ إخراج التقرير النهائي فور اكتمال التفكير...'
                        : 'في انتظار استجابة خادم النموذج المحلي...'}
                    </span>
                  </div>
                ) : null}
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
