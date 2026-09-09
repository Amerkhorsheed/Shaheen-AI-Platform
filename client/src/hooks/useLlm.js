import { useState, useRef } from 'react';
import { llmService } from '../services/llm.service.js';
import { settingsService } from '../services/settings.service.js';
import { chatsService } from '../services/chats.service.js';
import { decodeFilename } from '../services/files.service.js';
import { storage } from '../services/core/storage.js';

/**
 * Custom Hook: LLM Model Integration & Streaming Generation
 *
 * Encapsulates LM Studio connectivity, model listing, Server-Sent Events (SSE)
 * chat streaming, abort control, and error handling.
 */

/**
 * Normalise attachments from uploaded files, retaining extracted text for LLM context.
 */
export function prepareUserAttachments(files) {
  return (Array.isArray(files) ? files : []).map((f) => ({
    filename: decodeFilename(f.filename || f.name),
    size: f.size,
    type: f.mimeType || f.type || '',
    text: f.text || '',
    preview: f.preview || '',
    truncated: Boolean(f.truncated)
  }));
}

/**
 * Re-inject attachment text or metadata markers into historical messages so the
 * LLM retains full document context across multi-turn conversations.
 */
export function formatMessageWithAttachments(message, isCurrent = false) {
  let content = message?.content || '';
  if (Array.isArray(message?.attachments) && message.attachments.length > 0) {
    const fileBlocks = message.attachments
      .filter((att) => att && (att.text || att.preview))
      .map((att) => {
        const fname = decodeFilename(att.filename || att.name);
        const marker = `[محتوى الملف المرفق: ${fname}]`;
        if (content.includes(marker)) return '';
        const rawText = att.text || att.preview || '';
        // `isCurrent` marks the document the conversation is actually about —
        // the newest attachment, not only the turn being typed. A superseded
        // attachment keeps a preview; the live one keeps every byte.
        //
        // It used to be truncated to 1,200 characters on every turn after the
        // first, which cut a computed statistical dossier off inside its first
        // table. From the second question onward the model was answering about
        // a spreadsheet it could no longer see, and it answered with invented
        // suppliers and invented rejection rates. The server prunes the request
        // to the engine's real context window, so sending the whole dossier is
        // bounded there rather than guessed at here.
        const bodyText = (!isCurrent && rawText.length > 3000)
          ? `${rawText.slice(0, 1200)}\n\n... [تم اختصار وتلخيص أسطر المرفق السابق للحفاظ على نافذة سياق المحادثة]`
          : rawText;
        return `\n\n${marker}\n\`\`\`\n${bodyText}\n\`\`\``;
      })
      .filter(Boolean)
      .join('');

    if (fileBlocks) {
      content += fileBlocks;
    } else {
      // Legacy fallback: retain explicit mention of attached files if text is missing
      const metaBlocks = message.attachments
        .filter((att) => att && (att.filename || att.name))
        .map((att) => {
          const fname = decodeFilename(att.filename || att.name);
          const marker = `[مرفق معتمد في الجلسة: ${fname}]`;
          if (content.includes(marker) || content.includes(fname)) return '';
          const sizeStr = att.size ? ` (بحجم ${(att.size / 1024).toFixed(1)} KB)` : '';
          return `\n\n${marker}${sizeStr}`;
        })
        .filter(Boolean)
        .join('');
      if (metaBlocks) {
        content += metaBlocks;
      }
    }
  }
  return content;
}
export function useLlm() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(() => !!storage.getToken());
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [connectionError, setConnectionError] = useState('');
  const [streamError, setStreamError] = useState('');

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const abortControllerRef = useRef(null);
  const streamingContentRef = useRef('');
  const streamingReasoningRef = useRef('');

  const checkModels = async () => {
    setIsCheckingConnection(true);
    try {
      const res = await llmService.getModels();
      setIsConnected(!!res.connected);
      setConnectionError(res.connected ? '' : (res.error || 'خادم النموذج المحلي غير متاح.'));

      const modelList = res.models || [];
      setModels(modelList);

      if (modelList.length > 0) {
        setSelectedModel((prev) => {
          if (!prev || !modelList.some((m) => m.id === prev)) {
            return modelList[0].id;
          }
          return prev;
        });
      } else {
        setSelectedModel('');
      }
      return res;
    } catch (err) {
      setIsConnected(false);
      setModels([]);
      setSelectedModel('');
      setConnectionError(err.message || 'تعذّر فحص حالة خادم النموذج المحلي.');
      return null;
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const loadSystemSettings = async () => {
    try {
      return await settingsService.getSettings();
    } catch {
      return null;
    }
  };

  const handleSendMessage = async ({
    text,
    files = [],
    activeChatId,
    messages = [],
    chats = [],
    onEnsureChat,
    onChatTitleGenerated,
    onUserMessageAppended,
    onAssistantMessageAppended
  }) => {
    let currentChatId = activeChatId;

    if (!currentChatId && onEnsureChat) {
      currentChatId = await onEnsureChat(text);
      if (!currentChatId) return;
    }

    const effectiveText = text.trim() || (files.length > 0 ? 'يرجى تحليل وتدقيق بيانات ومحتوى الملف المرفق، واستخراج أهم المؤشرات والجداول الرسمية والتوصيات.' : '');
    if (!effectiveText && files.length === 0) return;

    let fullUserPrompt = effectiveText;
    if (files.length > 0) {
      const fileContexts = files
        .map(
          (f) =>
            `\n\n[محتوى الملف المرفق: ${decodeFilename(f.filename)}]\n\`\`\`\n${f.text || f.preview || ''}\n\`\`\``
        )
        .join('');
      fullUserPrompt = `${effectiveText}\n${fileContexts}`;
    }

    const userMsgObj = {
      role: 'user',
      content: effectiveText,
      attachments: prepareUserAttachments(files)
    };

    try {
      const savedUserMsg = await chatsService.saveMessage(currentChatId, userMsgObj);
      const normalizedMsg = {
        ...savedUserMsg,
        attachments: Array.isArray(savedUserMsg?.attachments)
          ? savedUserMsg.attachments
          : (Array.isArray(userMsgObj.attachments) ? userMsgObj.attachments : [])
      };
      if (onUserMessageAppended) {
        onUserMessageAppended(normalizedMsg);
      }

      const activeChatObj = chats.find((c) => c.id === currentChatId);
      if (
        activeChatObj &&
        (activeChatObj.title === 'جلسة عمل جديدة' || activeChatObj.title === 'محادثة جديدة') &&
        effectiveText.trim() &&
        onChatTitleGenerated
      ) {
        const generatedTitle = effectiveText.trim().slice(0, 36);
        onChatTitleGenerated(currentChatId, generatedTitle);
      }

      // No system message is sent. The server composes the institutional
      // prompt itself and discards whatever the browser supplies — a charter
      // that could be edited in the developer console would not be binding.
      // Sending it anyway uploaded several kilobytes per message to be thrown
      // away on arrival.
      // Send only recent relevant turns (last 8 messages) to prevent context exhaustion in long sessions
      const recentMessages = messages.slice(-8);
      const promptMessages = [];

      // The newest attachment in the window is the one under discussion; it is
      // sent whole so a follow-up question is answered from the document rather
      // than from memory of it.
      const liveAttachmentIndex = recentMessages.reduce(
        (found, m, i) => (Array.isArray(m?.attachments) && m.attachments.length > 0 ? i : found),
        -1
      );

      recentMessages.forEach((m, i) => {
        const rawContent = (m?.content || '').trim();
        // Skip previous failure notices
        if (rawContent.includes('تعذّر استكمال صياغة التقرير النهائي') || rawContent.includes('استُنفدت طاقة التوليد')) {
          return;
        }
        let formatted = formatMessageWithAttachments(m, i === liveAttachmentIndex);
        // Cap older assistant responses so they don't starve the prompt. The
        // most recent one is the report the user is following up on, so it
        // keeps enough of itself to be followed up on.
        const isLatestAssistant = m.role === 'assistant' && i === recentMessages.length - 1;
        const assistantCap = isLatestAssistant ? 4000 : 1500;
        if (m.role === 'assistant' && formatted.length > assistantCap) {
          formatted = formatted.slice(0, assistantCap) + '\n\n... [تم اختصار الرد السابق للحفاظ على سياق الجلسة]';
        }
        promptMessages.push({ role: m.role, content: formatted });
      });

      promptMessages.push({ role: 'user', content: fullUserPrompt });

      setIsStreaming(true);
      setStreamingContent('');
      setStreamingReasoning('');
      streamingContentRef.current = '';
      streamingReasoningRef.current = '';
      setStreamError('');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      await llmService.streamChat({
        model: selectedModel || 'default',
        messages: promptMessages,
        temperature,
        max_tokens: maxTokens,
        chatId: currentChatId,
        signal: controller.signal,
        onReasoningChunk: (chunk) => {
          streamingReasoningRef.current += chunk;
          setStreamingReasoning(streamingReasoningRef.current);
        },
        onChunk: (chunk) => {
          streamingContentRef.current += chunk;
          setStreamingContent(streamingContentRef.current);
        },
        onDone: async () => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          let finalContent = streamingContentRef.current.trim();

          // A model that produced only a reasoning trace produced no report.
          //
          // This branch used to publish that trace as the answer whenever it
          // contained enough Arabic characters, stripping a few English opening
          // phrases first. What reached the user was the model's private
          // deliberation — «the user wants…», half-finished sums, abandoned
          // approaches — presented as an official institutional report, which is
          // precisely the complaint that the platform answers with what it is
          // thinking instead of with what was asked. A trace is not a draft: it
          // is unverified by construction, and the charter's separation of
          // معطى / استنتاج / مقترح does not survive it.
          //
          // So the failure is reported as a failure. It should now be rare —
          // the thinking phase is pre-closed for reasoning models and the
          // prompt is sized to the engine's real context window — and when it
          // does happen, regenerating is the remedy, not publishing the trace.
          if (!finalContent && streamingReasoningRef.current.trim()) {
            finalContent =
              '⚠️ **تعذّر استكمال صياغة التقرير النهائي**: استُنفدت طاقة التوليد لدى النموذج أثناء مرحلة التحليل والتدقيق الحسابي، ولم يصدر عنه تقرير نهائي معتمد.\n\nمسار التفكير الداخلي للنموذج ليس تقريراً ولا يجوز اعتماده. يرجى النقر على زر **«إعادة التوليد»**، أو توجيه استفسار أكثر تحديداً حول البيانات.';
          }

          if (finalContent) {
            try {
              const savedAssistantMsg = await chatsService.saveMessage(currentChatId, {
                role: 'assistant',
                content: finalContent
              });
              if (onAssistantMessageAppended) {
                onAssistantMessageAppended(savedAssistantMsg);
              }
            } catch (saveErr) {
              console.error('[useLlm] Failed to save assistant message:', saveErr);
            }
          } else {
            setStreamError('تعذّر إتمام التوليد — لم يصدر أي رد عن النموذج.');
          }
          setStreamingContent('');
          setStreamingReasoning('');
          streamingContentRef.current = '';
          streamingReasoningRef.current = '';
        },
        onError: (err) => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          setStreamError(err.message || 'تعذّر إتمام المعالجة.');
          setStreamingContent('');
          setStreamingReasoning('');
          streamingContentRef.current = '';
          streamingReasoningRef.current = '';
          checkModels();
        }
      });
    } catch (err) {
      console.error('Error sending message:', err);
      setIsStreaming(false);
    }
  };

  const handleStopGeneration = (activeChatId, onPartialSaved) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      const content = streamingContentRef.current.trim();
      const reasoning = streamingReasoningRef.current.trim();

      const contentToSave = content
        ? content + '\n\n*(تم إنهاء التوليد بناءً على طلب المستخدم)*'
        : (reasoning
            ? '*(تم إيقاف التوليد بناءً على طلب المستخدم أثناء مرحلة التدقيق والتحليل)*'
            : '');

      if (contentToSave && activeChatId) {
        chatsService
          .saveMessage(activeChatId, {
            role: 'assistant',
            content: contentToSave
          })
          .then((saved) => {
            if (onPartialSaved) onPartialSaved(saved);
            setStreamingContent('');
            setStreamingReasoning('');
            streamingContentRef.current = '';
            streamingReasoningRef.current = '';
          })
          .catch((err) => {
            console.error('[useLlm] Failed to save partial message on stop:', err);
            setStreamingContent('');
            setStreamingReasoning('');
            streamingContentRef.current = '';
            streamingReasoningRef.current = '';
          });
      } else {
        setStreamingContent('');
        setStreamingReasoning('');
        streamingContentRef.current = '';
        streamingReasoningRef.current = '';
      }
    }
  };

  const handleRegenerate = (messages, onSend) => {
    if (!messages || messages.length === 0 || isStreaming) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && onSend) {
      onSend(lastUserMsg.content, lastUserMsg.attachments || []);
    }
  };

  return {
    models,
    setModels,
    selectedModel,
    setSelectedModel,
    isConnected,
    isCheckingConnection,
    setIsCheckingConnection,
    connectionError,
    streamError,
    setStreamError,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    isStreaming,
    streamingContent,
    streamingReasoning,
    checkModels,
    loadSystemSettings,
    handleSendMessage,
    handleStopGeneration,
    handleRegenerate
  };
}
