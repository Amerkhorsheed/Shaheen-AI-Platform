import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import LoginModal from './components/LoginModal';
import UsersModal from './components/UsersModal';
import SettingsModal from './components/SettingsModal';
import GovernmentTemplatesModal from './components/GovernmentTemplatesModal';
import { api } from './services/api';

export default function App() {
  const [currentUser, setCurrentUser] = useState(api.getStoredUser());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Chats & Messages
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [classification, setClassification] = useState('official');

  // LM Studio & Generation Settings
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');

  // Streaming State
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortControllerRef = useRef(null);

  // Modals
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);

  // 1. Initial Load & Auth Check
  useEffect(() => {
    if (currentUser) {
      loadInitialData();
    }
  }, [currentUser]);

  // Keyboard shortcut (Cmd+K / Ctrl+K for new session)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadInitialData = async () => {
    try {
      await Promise.all([loadChats(), checkModels(), loadSystemSettings()]);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  };

  const loadChats = async () => {
    try {
      const userChats = await api.getChats();
      setChats(userChats);
      if (userChats.length > 0 && !activeChatId) {
        handleSelectChat(userChats[0].id);
      }
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  };

  const checkModels = async () => {
    try {
      const res = await api.getModels();
      setIsConnected(res.connected);
      if (res.models?.length > 0) {
        setModels(res.models);
        if (!selectedModel) {
          setSelectedModel(res.models[0].id);
        }
      }
    } catch (err) {
      setIsConnected(false);
    }
  };

  const loadSystemSettings = async () => {
    try {
      const s = await api.getSettings();
      if (s.default_system_prompt) {
        setDefaultSystemPrompt(s.default_system_prompt);
      }
    } catch (err) {}
  };

  // 2. Chat Selection
  const handleSelectChat = async (chatId) => {
    if (isStreaming) {
      handleStopGeneration();
    }
    setActiveChatId(chatId);
    try {
      const chat = await api.getChat(chatId);
      setMessages(chat.messages || []);
      if (chat.model) setSelectedModel(chat.model);
      if (chat.classification) setClassification(chat.classification);
    } catch (err) {
      console.error('Failed to load chat details:', err);
    }
  };

  // 3. New Chat Creation
  const handleNewChat = async () => {
    if (isStreaming) {
      handleStopGeneration();
    }
    try {
      const newChat = await api.createChat({
        title: 'جلسة عمل جديدة',
        model: selectedModel,
        systemPrompt: defaultSystemPrompt,
        classification: 'official'
      });
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setClassification('official');
      setMessages([]);
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  };

  // 4. Update Chat Title, Pin & Classification
  const handleUpdateChatTitle = async (chatId, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    const cleanTitle = newTitle.trim();
    // 1. Optimistic update
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: cleanTitle } : c)));
    try {
      const updated = await api.updateChat(chatId, { title: cleanTitle });
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c)));
    } catch (err) {
      console.error('Failed to rename chat:', err);
      loadChats();
    }
  };

  const handleChangeClassification = async (newClass) => {
    setClassification(newClass);
    if (activeChatId) {
      try {
        await api.updateChat(activeChatId, { classification: newClass });
        setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, classification: newClass } : c)));
      } catch (err) {}
    }
  };

  const handleTogglePinChat = async (chatId, pinned) => {
    const isPinned = pinned ? 1 : 0;
    // 1. Optimistic update
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinned: isPinned } : c)));
    try {
      await api.updateChat(chatId, { pinned: isPinned });
      // 2. Re-fetch from server to ensure accurate group ordering (pinned DESC, updated_at DESC)
      const userChats = await api.getChats();
      setChats(userChats);
    } catch (err) {
      console.error('Failed to pin chat:', err);
      loadChats();
    }
  };

  const handleDeleteChat = async (chatId) => {
    // 1. Optimistic deletion
    const remaining = chats.filter((c) => c.id !== chatId);
    setChats(remaining);
    if (activeChatId === chatId) {
      if (remaining.length > 0) {
        handleSelectChat(remaining[0].id);
      } else {
        setActiveChatId(null);
        setMessages([]);
      }
    }
    try {
      await api.deleteChat(chatId);
    } catch (err) {
      console.error('Failed to delete chat:', err);
      loadChats();
    }
  };

  const handleClearMessages = async () => {
    if (!activeChatId) return;
    try {
      await api.clearChat(activeChatId);
      setMessages([]);
    } catch (err) {
      console.error('Failed to clear chat:', err);
    }
  };

  // 5. Send Message & Stream Response
  const handleSendMessage = async (text, files = []) => {
    let currentChatId = activeChatId;

    if (!currentChatId) {
      try {
        const newChat = await api.createChat({
          title: text.slice(0, 32) || 'جلسة عمل جديدة',
          model: selectedModel,
          systemPrompt: defaultSystemPrompt,
          classification
        });
        setChats([newChat]);
        setActiveChatId(newChat.id);
        currentChatId = newChat.id;
      } catch (err) {
        alert('فشل إنشاء الجلسة: ' + err.message);
        return;
      }
    }

    let fullUserPrompt = text;
    if (files.length > 0) {
      const fileContexts = files.map((f) => {
        return `\n\n[محتوى الملف المرفق: ${f.filename}]\n\`\`\`\n${f.text || f.preview || ''}\n\`\`\``;
      }).join('');
      fullUserPrompt = `${text}\n${fileContexts}`;
    }

    const userMsgObj = {
      role: 'user',
      content: text,
      attachments: files.map(f => ({ filename: f.filename, size: f.size, type: f.mimeType }))
    };

    try {
      const savedUserMsg = await api.saveMessage(currentChatId, userMsgObj);
      const updatedMessages = [...messages, savedUserMsg];
      setMessages(updatedMessages);

      const activeChatObj = chats.find((c) => c.id === currentChatId);
      if (activeChatObj && (activeChatObj.title === 'جلسة عمل جديدة' || activeChatObj.title === 'محادثة جديدة') && text.trim()) {
        const generatedTitle = text.trim().slice(0, 36);
        handleUpdateChatTitle(currentChatId, generatedTitle);
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
      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulated = '';

      await api.streamChat({
        model: selectedModel || 'default',
        messages: promptMessages,
        temperature,
        max_tokens: maxTokens,
        signal: controller.signal,
        onChunk: (chunk) => {
          accumulated += chunk;
          setStreamingContent(accumulated);
        },
        onDone: async () => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          if (accumulated.trim()) {
            const savedAssistantMsg = await api.saveMessage(currentChatId, {
              role: 'assistant',
              content: accumulated
            });
            setMessages((prev) => [...prev, savedAssistantMsg]);
            setStreamingContent('');
          }
        },
        onError: (err) => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          const errMsg = `عذراً، تعذر إتمام المعالجة: ${err.message}.`;
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: errMsg, created_at: new Date().toISOString() }
          ]);
          setStreamingContent('');
        }
      });
    } catch (err) {
      console.error('Error sending message:', err);
      setIsStreaming(false);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      if (streamingContent.trim() && activeChatId) {
        api.saveMessage(activeChatId, {
          role: 'assistant',
          content: streamingContent + '\n\n*(تم إنهاء التوليد بناءً على طلب المستخدم)*'
        }).then((saved) => {
          setMessages((prev) => [...prev, saved]);
          setStreamingContent('');
        });
      }
    }
  };

  const handleRegenerate = () => {
    if (messages.length === 0 || isStreaming) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      setMessages((prev) => prev.slice(0, -1));
      handleSendMessage(lastUserMsg.content, []);
    }
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    loadInitialData();
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setChats([]);
    setMessages([]);
    setActiveChatId(null);
  };

  const currentChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F5EF] text-[#14201C] font-sans antialiased" dir="rtl">
      {/* Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onUpdateChatTitle={handleUpdateChatTitle}
        onTogglePinChat={handleTogglePinChat}
        onDeleteChat={handleDeleteChat}
        currentUser={currentUser}
        onOpenUsersModal={() => setIsUsersModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenTemplatesModal={() => setIsTemplatesModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Chat View */}
      <ChatView
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        currentChat={currentChat}
        classification={classification}
        onChangeClassification={handleChangeClassification}
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        isConnected={isConnected}
        onRefreshModels={checkModels}
        temperature={temperature}
        onChangeTemperature={setTemperature}
        maxTokens={maxTokens}
        onChangeMaxTokens={setMaxTokens}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        onRegenerate={handleRegenerate}
        onClearMessages={handleClearMessages}
        onOpenTemplatesModal={() => setIsTemplatesModalOpen(true)}
        onUpdateChatTitle={handleUpdateChatTitle}
        onTogglePinChat={handleTogglePinChat}
        onDeleteChat={handleDeleteChat}
      />

      {/* Auth Modal */}
      {!currentUser && <LoginModal onLoginSuccess={handleLoginSuccess} />}

      {/* Admin Users Modal */}
      <UsersModal
        isOpen={isUsersModalOpen}
        onClose={() => setIsUsersModalOpen(false)}
        currentUserId={currentUser?.id}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => {
          setIsSettingsModalOpen(false);
          checkModels();
          loadSystemSettings();
        }}
        isAdmin={currentUser?.role === 'admin'}
      />

      {/* Government Templates Modal */}
      <GovernmentTemplatesModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        onSelectTemplate={(prompt) => handleSendMessage(prompt, [])}
        currentUser={currentUser}
      />
    </div>
  );
}
