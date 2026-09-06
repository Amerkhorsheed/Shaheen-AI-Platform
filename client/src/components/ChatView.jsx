import React, { useRef, useEffect, useState } from 'react';
import { PanelLeftOpen, Trash2, Printer, Download, ScrollText, Edit2, Pin, Check, X, AlertTriangle } from 'lucide-react';
import ModelSelector from './ModelSelector';
import WelcomeScreen from './WelcomeScreen';
import MessageItem from './MessageItem';
import ChatInput from './ChatInput';
import GovernmentRibbon from './GovernmentRibbon';
import { exportService } from '../services/export.service.js';
import { useDialog } from '../context/DialogContext.jsx';

export default function ChatView({
  isSidebarOpen,
  onToggleSidebar,
  currentChat,
  classification = 'official',
  onChangeClassification,
  messages = [],
  isStreaming,
  streamingContent,
  streamingReasoning = '',
  models = [],
  selectedModel,
  onSelectModel,
  isConnected,
  isCheckingConnection = false,
  connectionError = '',
  streamError = '',
  onDismissStreamError,
  onRefreshModels,
  temperature,
  onChangeTemperature,
  maxTokens,
  onChangeMaxTokens,
  onSendMessage,
  onStopGeneration,
  onRegenerate,
  onClearMessages,
  onOpenTemplatesModal,
  onUpdateChatTitle,
  onTogglePinChat,
  onDeleteChat,
  isSuperAdmin = false
}) {
  const messagesEndRef = useRef(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const dialog = useDialog();

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, streamingReasoning]);

  const handleExportFullChatPdf = () => {
    if (messages.length === 0) return;
    const title = currentChat?.title || 'وثيقة ومحضر رسمي صادر عن منظومة OSS';
    const formattedContent = messages.map(m => {
      const author = m.role === 'user' ? 'الجهة المستفسرة (المستخدم)' : 'منظومة OSS للذكاء الاصطناعي';
      return `### ${author}\n\n${m.content}\n\n---\n`;
    }).join('\n');

    exportService.exportPdf(title, formattedContent, { 
      model: isSuperAdmin ? selectedModel : 'منظومة OSS للذكاء الاصطناعي (النموذج السيادي المعتمد)',
      classification: classification || 'official'
    });
  };

  const handleSaveTitle = () => {
    if (titleInput.trim() && currentChat && onUpdateChatTitle) {
      onUpdateChatTitle(currentChat.id, titleInput.trim());
    }
    setIsEditingTitle(false);
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F7F5EF] text-[#14201C] relative">
      {/* 1. Sovereign Government Ribbon */}
      <GovernmentRibbon
        classification={classification}
        onChangeClassification={onChangeClassification}
        isConnected={isConnected}
      />

      {/* 2. Chat Header Toolbar */}
      <header className="h-14 border-b border-[#E4E0D6] bg-white/85 backdrop-blur-md px-4 flex items-center justify-between z-20 shadow-2xs">
        <div className="flex items-center gap-2">
          {!isSidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg hover:bg-[#F0EDE4] text-[#02443A] transition-colors"
              title="فتح القائمة الجانبية"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          )}

          {/* Model Selector - Only visible and controllable by Super Admin */}
          {isSuperAdmin && (
            <ModelSelector
              models={models}
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              isConnected={isConnected}
              isCheckingConnection={isCheckingConnection}
              onRefreshModels={onRefreshModels}
              temperature={temperature}
              onChangeTemperature={onChangeTemperature}
              maxTokens={maxTokens}
              onChangeMaxTokens={onChangeMaxTokens}
            />
          )}
        </div>

        {/* Active Conversation Quick Bar (Title, Rename, Pin, Delete) */}
        {currentChat && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-[#F0EDE4] border border-[#DDD8CA] rounded-xl text-xs max-w-xs lg:max-w-md shadow-2xs">
            {isEditingTitle ? (
              <div className="flex items-center gap-1.5 w-full">
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  autoFocus
                  className="bg-white border border-[#B79E6A] rounded px-2 py-0.5 text-xs text-[#02443A] font-bold focus:outline-none w-full shadow-xs"
                />
                <button 
                  onClick={handleSaveTitle} 
                  className="p-1 text-emerald-600 hover:text-emerald-700 rounded hover:bg-white transition-colors"
                  title="حفظ العنوان"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => setIsEditingTitle(false)} 
                  className="p-1 text-rose-600 hover:text-rose-700 rounded hover:bg-white transition-colors"
                  title="إلغاء"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                  <span className="font-bold text-[#02443A] truncate" title={currentChat.title}>
                    {currentChat.title}
                  </span>
                  {Boolean(currentChat.pinned) && (
                    <Pin className="w-3 h-3 text-[#B79E6A] fill-[#B79E6A] flex-shrink-0 rotate-45" title="جلسة مثبتة في الأعلى" />
                  )}
                </div>

                <div className="flex items-center gap-1 border-r border-[#DDD8CA] pr-1.5 mr-1">
                  <button
                    onClick={() => {
                      setTitleInput(currentChat.title);
                      setIsEditingTitle(true);
                    }}
                    className="p-1 text-[#5E6B64] hover:text-[#02443A] hover:bg-[#EBE6D9] rounded transition-colors"
                    title="تعديل عنوان الجلسة"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onTogglePinChat && onTogglePinChat(currentChat.id, !currentChat.pinned)}
                    className={`p-1 rounded transition-colors ${
                      currentChat.pinned ? 'text-[#B79E6A] bg-white' : 'text-[#5E6B64] hover:text-[#02443A] hover:bg-[#EBE6D9]'
                    }`}
                    title={currentChat.pinned ? 'إلغاء التثبيت' : 'تثبيت الجلسة في الأعلى'}
                  >
                    <Pin className={`w-3.5 h-3.5 ${currentChat.pinned ? 'fill-[#B79E6A]' : ''}`} />
                  </button>
                  <button
                    onClick={async () => {
                      const confirmed = await dialog.confirm({
                        title: 'تأكيد حذف الجلسة',
                        message: 'هل أنت متأكد من رغبتك في حذف هذه الجلسة وسجلها بالكامل؟',
                        itemName: currentChat.title,
                        description: 'سيتم مسح المحادثات والمرفقات المرتبطة بهذه الجلسة نهائياً من النظام.',
                        confirmText: 'حذف الجلسة نهائياً',
                        cancelText: 'إلغاء الأمر',
                        variant: 'danger'
                      });
                      if (confirmed) {
                        onDeleteChat && onDeleteChat(currentChat.id);
                      }
                    }}
                    className="p-1 text-[#5E6B64] hover:text-[#D14343] hover:bg-[#FCE8E8] rounded transition-colors cursor-pointer"
                    title="حذف هذه الجلسة"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenTemplatesModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#F0EDE4] hover:bg-[#EBE6D9] text-[#02443A] border border-[#DDD8CA] transition-colors"
            title="فتح القوالب الحكومية"
          >
            <ScrollText className="w-3.5 h-3.5 text-[#B79E6A]" />
            <span className="hidden sm:inline">القوالب الرسمية</span>
          </button>

          {messages.length > 0 && (
            <>
              <button
                onClick={handleExportFullChatPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] transition-all shadow-xs"
                title="تصدير كامل الجلسة إلى وثيقة رسمية (طباعة PDF)"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">طباعة وثيقة الجلسة</span>
              </button>

              <button
                onClick={async () => {
                  const confirmed = await dialog.confirm({
                    title: 'إفراغ سجل الجلسة',
                    message: 'هل تريد مسح جميع رسائل وسجل هذه الجلسة؟',
                    itemName: currentChat?.title,
                    description: 'سيتم مسح كافة الرسائل السابقة مع الإبقاء على الجلسة الحالية مفتوحة.',
                    confirmText: 'مسح السجل',
                    cancelText: 'تراجع',
                    variant: 'warning'
                  });
                  if (confirmed) {
                    onClearMessages();
                  }
                }}
                className="p-1.5 rounded-lg text-[#5E6B64] hover:text-[#8A1B1B] hover:bg-[#F7E4E4] transition-colors cursor-pointer"
                title="إفراغ سجل الجلسة"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* 3. Main Message Stream or Welcome Screen */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {messages.length === 0 && !isStreaming ? (
          <WelcomeScreen
            connectionError={connectionError}
            onSelectSuggestion={(prompt) => onSendMessage(prompt, [])}
            isConnected={isConnected}
            isCheckingConnection={isCheckingConnection}
            currentModel={selectedModel}
            onOpenTemplates={onOpenTemplatesModal}
            isSuperAdmin={isSuperAdmin}
          />
        ) : (
          <div className="flex-1 py-4">
            {messages.map((msg, index) => (
              <MessageItem
                key={msg.id || index}
                message={msg}
                currentModel={selectedModel}
                classification={classification}
                onRegenerate={index === messages.length - 1 && msg.role === 'assistant' ? onRegenerate : null}
              />
            ))}

            {/* Live Streaming Message */}
            {isStreaming && (
              <MessageItem
                message={{
                  role: 'assistant',
                  content: streamingContent,
                  created_at: new Date().toISOString()
                }}
                isStreaming={true}
                streamingReasoning={streamingReasoning}
                currentModel={selectedModel}
                classification={classification}
              />
            )}

            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>

      {/* 4. Bottom Input Area */}
      <div className="z-20 bg-gradient-to-t from-[#F7F5EF] via-[#F7F5EF] to-transparent pt-2">
        {streamError && (
          <div className="px-4 pt-3" dir="rtl">
            <div className="max-w-3xl mx-auto flex items-start gap-2.5 p-3 rounded-lg bg-[#FDF2F2] border border-[#F8B4B4]">
              <AlertTriangle className="w-4 h-4 text-[#8A1B1B] shrink-0 mt-0.5" />
              <div className="flex-1 text-[12.5px] text-[#8A1B1B] leading-relaxed">
                <div className="font-bold mb-0.5">تعذّر إتمام التوليد — لم يصدر أي رد عن النموذج.</div>
                <div>{streamError}</div>
              </div>
              {onDismissStreamError && (
                <button
                  onClick={onDismissStreamError}
                  className="text-[11px] font-bold text-[#8A1B1B] hover:underline shrink-0"
                >
                  إغلاق
                </button>
              )}
            </div>
          </div>
        )}

        <ChatInput
          onSendMessage={onSendMessage}
          isStreaming={isStreaming}
          onStopGeneration={onStopGeneration}
        />
      </div>
    </div>
  );
}
