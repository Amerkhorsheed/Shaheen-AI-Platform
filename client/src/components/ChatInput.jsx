import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Send, Square, Paperclip, X, FileText, FileSpreadsheet, Loader2, ShieldCheck } from 'lucide-react';
import { filesService, decodeFilename } from '../services/files.service.js';
import { useDialog } from '../context/DialogContext.jsx';

const ChatInput = forwardRef(function ChatInput(
  { onSendMessage, isStreaming, onStopGeneration, disabled = false },
  ref
) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const dialog = useDialog();

  useImperativeHandle(ref, () => ({
    processFiles,
    getAttachedFiles: () => attachedFiles,
    focus: () => textareaRef.current?.focus()
  }));

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [text]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (isStreaming) {
      onStopGeneration();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed && attachedFiles.length === 0) return;

    const messageToSend = trimmed || (attachedFiles.length > 0 ? 'يرجى تحليل وتدقيق بيانات ومحتوى الملف المرفق، واستخراج أهم المؤشرات والجداول الرسمية والتوصيات.' : '');
    onSendMessage(messageToSend, attachedFiles);
    setText('');
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const processFiles = async (files) => {
    if (!files || !files.length) return;

    setIsUploading(true);
    try {
      const uploaded = await filesService.uploadFiles(files);
      const failed = uploaded.filter((f) => f && f.success === false);
      if (failed.length > 0) {
        const reasons = failed.map((f) => `• ${f.filename || 'ملف'}: ${f.error || 'تعذّر استخراج النص'}`).join('\n');
        await dialog.alert({
          title: 'تعذّر استخراج بعض الملفات',
          message: 'واجه النظام صعوبة في استخراج محتوى بعض المرفقات:',
          description: reasons,
          variant: 'warning'
        });
      }
      const successful = uploaded.filter((f) => f && f.success !== false);
      if (successful.length > 0) {
        setAttachedFiles((prev) => [...prev, ...successful]);
      }
    } catch (err) {
      await dialog.alert({
        title: 'فشل رفع الملف',
        message: err.message || 'تعذّر رفع الملفات المحددة.',
        variant: 'danger'
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeFile = (index) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 md:px-6 pb-4">
      {/* File attachments preview */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 p-2.5 bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg">
          {attachedFiles.map((file, idx) => {
            const isSpreadsheet = /\.(xlsx?|xlsm|xlsb|csv)$/i.test(file.filename || '');
            return (
              <div
                key={idx}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs group shadow-2xs transition-all ${
                  isSpreadsheet
                    ? 'bg-emerald-50/80 border border-emerald-300 text-emerald-950'
                    : 'bg-[#F0EDE4] border border-[#DDD8CA] text-[#02443A]'
                }`}
              >
                {isSpreadsheet ? (
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-[#B79E6A] shrink-0" />
                )}
                <div className="flex flex-col">
                  <span className="font-semibold truncate max-w-[180px]">{decodeFilename(file.filename)}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-[#5E6B64]">
                      {file.size ? `${(file.size / 1024).toFixed(1)} KB` : ''}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-medium border ${
                        isSpreadsheet
                          ? 'text-emerald-800 bg-emerald-100/90 border-emerald-300'
                          : 'text-[#2E6B4F] bg-[#E7F0EA] border-[#2E6B4F]/20'
                      }`}
                    >
                      {isSpreadsheet ? 'جدول بيانات' : 'سياق معتمد'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="p-0.5 hover:bg-black/10 rounded text-[#8A1B1B] transition-colors"
                  title="إزالة الملف"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Input Box with Drag & Drop */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-2xl border-2 shadow-md transition-all ${
          isDragging
            ? 'border-[#02443A] bg-[#E7F0EA]/40 ring-2 ring-[#02443A]/20'
            : 'bg-white border-[#DDD8CA] focus-within:border-[#B79E6A]'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isDragging ? 'أفلت الملف هنا للرفع المباشر...' : 'اكتب استفسارك هنا، أو ارفع ملفاً لتحليله... (اضغط Enter للإرسال)'}
          disabled={disabled || isUploading}
          rows={1}
          className="w-full bg-transparent px-4 py-3.5 pl-24 text-sm md:text-base text-[#14201C] placeholder-[#7A7A7B] focus:outline-none resize-none min-h-[52px] max-h-[220px]"
        />

        {/* Input Actions (Left in RTL) */}
        <div className="absolute left-3 bottom-2.5 flex items-center gap-1.5">
          {/* File Upload Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            multiple
            accept=".pdf,.docx,.doc,.txt,.csv,.tsv,.xlsx,.xls,.xlsm,.xlsb,.json,.md,.py,.js,.html,.sql,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading || isStreaming}
            className="p-2 text-[#5E6B64] hover:text-[#02443A] hover:bg-[#F0EDE4] rounded-full transition-colors disabled:opacity-50"
            title="إرفاق ملفات (PDF, Word, Excel, CSV, Text)"
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#B79E6A]" />
            ) : (
              <Paperclip className="w-4 h-4" />
            )}
          </button>

          {/* Send / Stop Button */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStopGeneration}
              className="p-2 bg-[#8A1B1B] hover:bg-[#6b1414] text-white rounded-xl transition-all shadow-xs"
              title="إيقاف التوليد"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || isUploading || (!text.trim() && attachedFiles.length === 0)}
              className="p-2 bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] rounded-xl transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
              title="إرسال"
            >
              <Send className="w-4 h-4 rotate-180" />
            </button>
          )}
        </div>
      </div>

      {/* Offline Privacy Note */}
      <div className="flex items-center justify-center gap-1.5 mt-2 text-[11px] text-[#5E6B64]">
        <ShieldCheck className="w-3.5 h-3.5 text-[#2E6B4F]" />
        <span>منظومة ذكاء اصطناعي سيادية تعمل محلياً بالكامل — معزولة 100% عن الإنترنت الخارجي</span>
      </div>
    </div>
  );
});

export default ChatInput;
