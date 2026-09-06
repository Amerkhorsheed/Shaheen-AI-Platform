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
export function useLlm() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(() => !!storage.getToken());
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [streamError, setStreamError] = useState('');

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const abortControllerRef = useRef(null);

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
      const s = await settingsService.getSettings();
      if (s.default_system_prompt) {
        setDefaultSystemPrompt(s.default_system_prompt);
      }
      return s;
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
      attachments: files.map((f) => ({ filename: decodeFilename(f.filename), size: f.size, type: f.mimeType }))
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

      const promptMessages = [];
      if (defaultSystemPrompt) {
        promptMessages.push({ role: 'system', content: defaultSystemPrompt });
      }

      messages.forEach((m) => {
        promptMessages.push({ role: m.role, content: m.content });
      });

      promptMessages.push({ role: 'user', content: fullUserPrompt });

      setIsStreaming(true);
      setStreamingContent('');
      setStreamingReasoning('');
      setStreamError('');

      const controller = new AbortController();
      abortControllerRef.current = controller;
      let accumulated = '';

      await llmService.streamChat({
        model: selectedModel || 'default',
        messages: promptMessages,
        temperature,
        max_tokens: maxTokens,
        chatId: currentChatId,
        signal: controller.signal,
        onReasoningChunk: (chunk) => {
          setStreamingReasoning((prev) => prev + chunk);
        },
        onChunk: (chunk) => {
          accumulated += chunk;
          setStreamingContent(accumulated);
        },
        onDone: async () => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          if (accumulated.trim()) {
            const savedAssistantMsg = await chatsService.saveMessage(currentChatId, {
              role: 'assistant',
              content: accumulated
            });
            if (onAssistantMessageAppended) {
              onAssistantMessageAppended(savedAssistantMsg);
            }
            setStreamingContent('');
            setStreamingReasoning('');
          }
        },
        onError: (err) => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          setStreamError(err.message || 'تعذّر إتمام المعالجة.');
          setStreamingContent('');
          setStreamingReasoning('');
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
      if (streamingContent.trim() && activeChatId) {
        chatsService
          .saveMessage(activeChatId, {
            role: 'assistant',
            content: streamingContent + '\n\n*(تم إنهاء التوليد بناءً على طلب المستخدم)*'
          })
          .then((saved) => {
            if (onPartialSaved) onPartialSaved(saved);
            setStreamingContent('');
            setStreamingReasoning('');
          });
      } else {
        setStreamingContent('');
        setStreamingReasoning('');
      }
    }
  };

  const handleRegenerate = (messages, onSend) => {
    if (!messages || messages.length === 0 || isStreaming) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && onSend) {
      onSend(lastUserMsg.content);
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
    defaultSystemPrompt,
    setDefaultSystemPrompt,
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
