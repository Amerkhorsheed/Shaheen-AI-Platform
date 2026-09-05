import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, FileSpreadsheet, Download } from 'lucide-react';
import { api } from '../services/api';

// Helper to convert an HTML table node or text rows into clean CSV
function tableNodeToCsv(tableElement) {
  if (!tableElement) return '';
  const rows = Array.from(tableElement.querySelectorAll('tr'));
  return rows.map(tr => {
    const cells = Array.from(tr.querySelectorAll('th, td'));
    return cells.map(cell => {
      let text = cell.innerText.trim().replace(/"/g, '""');
      if (text.includes(',') || text.includes('\n') || text.includes('"')) {
        return `"${text}"`;
      }
      return text;
    }).join(',');
  }).join('\r\n');
}

export default function MarkdownRenderer({ content }) {
  const [copiedCodeIndex, setCopiedCodeIndex] = useState(null);

  const handleCopyCode = (codeText, index) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCodeIndex(index);
    setTimeout(() => setCopiedCodeIndex(null), 2000);
  };

  const handleExportXlsx = (e) => {
    const tableContainer = e.currentTarget.closest('.custom-table-container');
    const table = tableContainer ? tableContainer.querySelector('table') : null;
    if (!table) return;

    const csvData = tableNodeToCsv(table);
    const filename = `shaheen_table_${Date.now()}.xlsx`;
    api.exportXlsx(csvData, filename, 'جدول بيانات رسمي — منظومة شاهين');
  };

  const handleInspectTable = (e) => {
    const tableContainer = e.currentTarget.closest('.custom-table-container');
    const table = tableContainer ? tableContainer.querySelector('table') : null;
    if (!table) return;

    const csvData = tableNodeToCsv(table);
    const filename = `shaheen_table_${Date.now()}.xlsx`;
    api.openCsvPreviewPage(csvData, filename, 'بوابة فحص وتصدير جداول البيانات الرسمية');
  };

  let codeBlockCounter = 0;
  let tableCounter = 0;

  return (
    <div className="prose max-w-none text-[#14201C] leading-relaxed text-sm md:text-base">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Code blocks
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');

            if (!inline && (match || codeString.includes('\n'))) {
              const currentIdx = ++codeBlockCounter;
              const isCopied = copiedCodeIndex === currentIdx;

              return (
                <div className="relative my-4 rounded-lg overflow-hidden border border-[#1A4638] bg-[#0A241C] text-[#FBFAF6] shadow-sm">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[#02443A]/80 border-b border-[#1A4638] text-xs text-[#E8D9A8]">
                    <span className="font-mono uppercase">{match ? match[1] : 'كود'}</span>
                    <button
                      onClick={() => handleCopyCode(codeString, currentIdx)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[#103228] hover:bg-[#1A4638] text-[#FBFAF6] transition-colors"
                      title="نسخ الكود"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopied ? 'تم النسخ' : 'نسخ'}</span>
                    </button>
                  </div>
                  <pre className="p-4 overflow-x-auto text-xs md:text-sm font-mono leading-relaxed" dir="ltr" style={{ textAlign: 'left' }}>
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            }

            return (
              <code className="px-1.5 py-0.5 rounded bg-[#EDE7D8] text-[#02443A] font-mono text-xs font-semibold" {...props}>
                {children}
              </code>
            );
          },

          // Tables with Sovereign High-Grade Excel (.xlsx) Export & Inspection Portal
          table({ node, children, ...props }) {
            return (
              <div className="custom-table-container my-5 rounded-lg border border-[#DDD8CA] bg-white overflow-hidden shadow-sm">
                <div className="flex flex-wrap items-center justify-between px-3.5 py-2.5 bg-[#F0EDE4] border-b border-[#DDD8CA] text-xs gap-2">
                  <div className="flex items-center gap-2 font-bold text-[#02443A]">
                    <FileSpreadsheet className="w-4 h-4 text-[#B79E6A]" />
                    <span>جدول بيانات رسمي معتمد</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportXlsx}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#107C41] hover:bg-[#0c5c30] text-white font-bold transition-all shadow-xs"
                      title="تحميل هذا الجدول مباشرة بصيغة Microsoft Excel (.xlsx) مروّس وموجه من اليمين لليسار"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تصدير مصنّف Excel (.xlsx)</span>
                    </button>
                    <button
                      onClick={handleInspectTable}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold transition-all shadow-xs"
                      title="فتح بوابة فحص وتحليل وتصفية وطباعة الجدول"
                    >
                      <span>👁️ فحص وبحث في الجدول</span>
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs md:text-sm" {...props}>
                    {children}
                  </table>
                </div>
              </div>
            );
          },

          // Quotes with Amiri aesthetic
          blockquote({ node, children, ...props }) {
            return (
              <blockquote className="border-r-4 border-[#B79E6A] pr-4 py-1.5 my-3 bg-[#FBFAF6] rounded-l font-serif text-[#14201C]/90 italic" {...props}>
                {children}
              </blockquote>
            );
          },

          // Headings
          h1: ({ node, ...props }) => <h1 className="text-xl md:text-2xl font-bold text-[#02443A] mt-6 mb-3 pb-1 border-b border-[#E4E0D6]" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-lg md:text-xl font-bold text-[#02443A] mt-5 mb-2" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-base md:text-lg font-bold text-[#103228] mt-4 mb-2" {...props} />,

          // Lists
          ul: ({ node, ...props }) => <ul className="list-disc list-inside space-y-1 my-2 pr-2" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal list-inside space-y-1 my-2 pr-2" {...props} />,

          // Links
          a: ({ node, ...props }) => (
            <a className="text-[#02443A] hover:text-[#B79E6A] underline decoration-[#B79E6A]/50 font-medium transition-colors" target="_blank" rel="noopener noreferrer" {...props} />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
