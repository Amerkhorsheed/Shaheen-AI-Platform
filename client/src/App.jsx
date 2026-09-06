import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import LoginModal from './components/LoginModal';
import UsersModal from './components/UsersModal';
import SettingsModal from './components/SettingsModal';
import GovernmentTemplatesModal from './components/GovernmentTemplatesModal';
import ChangePasswordModal from './components/ChangePasswordModal';

import { useAuth } from './hooks/useAuth.js';
import { useChats } from './hooks/useChats.js';
import { useLlm } from './hooks/useLlm.js';

/**
 * Root Application Orchestrator
 *
 * Implements the Container & Orchestrator Design Pattern by delegating
 * domain logic to specialized Single-Responsibility custom hooks:
 * - `useAuth`: Authentication, session hydration & event bus signaling
 * - `useChats`: Chat sessions, message history & conversation lifecycle
 * - `useLlm`: LM Studio discovery, parameters & SSE streaming generation
 */
export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Modal Visibility State
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);

  // 1. Specialized Domain Hooks
  const {
    chats,
    activeChatId,
    messages,
    setMessages,
    classification,
    loadChats,
    handleSelectChat,
    handleNewChat,
    handleUpdateChatTitle,
    handleChangeClassification,
    handleTogglePinChat,
    handleDeleteChat,
    handleClearMessages,
    resetChats
  } = useChats();

  const {
    models,
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
    isStreaming,
    streamingContent,
    streamingReasoning,
    checkModels,
    loadSystemSettings,
    handleSendMessage,
    handleStopGeneration,
    handleRegenerate
  } = useLlm();

  const handleInitialDataLoad = useCallback(async () => {
    try {
      await Promise.all([loadChats(true), checkModels(), loadSystemSettings()]);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  }, [loadChats, checkModels, loadSystemSettings]);

  const {
    currentUser,
    sessionNotice,
    mustChangePassword,
    handleLoginSuccess,
    handleLogout: authLogout,
    handlePasswordChanged: authPasswordChanged
  } = useAuth({
    onSessionVerified: handleInitialDataLoad,
    onSessionEnded: () => {
      resetChats();
      setStreamError('');
      setIsCheckingConnection(false);
    },
    onSessionFailed: () => {
      setIsCheckingConnection(false);
    }
  });

  // Global Keyboard Shortcut (Cmd+K / Ctrl+K for new session)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleNewChat({
          selectedModel,
          defaultSystemPrompt,
          onBeforeCreate: () => {
            if (isStreaming) handleStopGeneration(activeChatId);
          }
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedModel, defaultSystemPrompt, isStreaming, activeChatId, handleNewChat, handleStopGeneration]);

  // Coordinated User Actions
  const onSelectChat = async (chatId) => {
    if (isStreaming) {
      handleStopGeneration(activeChatId, (partialMsg) => {
        setMessages((prev) => [...prev, partialMsg]);
      });
    }
    const chat = await handleSelectChat(chatId);
    if (chat?.model) {
      setSelectedModel(chat.model);
    }
  };

  const onNewChat = async () => {
    if (isStreaming) {
      handleStopGeneration(activeChatId, (partialMsg) => {
        setMessages((prev) => [...prev, partialMsg]);
      });
    }
    await handleNewChat({ selectedModel, defaultSystemPrompt });
  };

  const onSendMessage = async (text, files = []) => {
    await handleSendMessage({
      text,
      files,
      activeChatId,
      messages,
      chats,
      onEnsureChat: async (promptText) => {
        const newChat = await handleNewChat({
          selectedModel,
          defaultSystemPrompt
        });
        return newChat?.id;
      },
      onChatTitleGenerated: handleUpdateChatTitle,
      onUserMessageAppended: (userMsg) => {
        setMessages((prev) => [...prev, userMsg]);
      },
      onAssistantMessageAppended: (assistantMsg) => {
        setMessages((prev) => [...prev, assistantMsg]);
      }
    });
  };

  const onStopGeneration = () => {
    handleStopGeneration(activeChatId, (partialMsg) => {
      setMessages((prev) => [...prev, partialMsg]);
    });
  };

  const onRegenerate = () => {
    handleRegenerate(messages, (prompt) => onSendMessage(prompt, []));
  };

  const onLogout = () => {
    authLogout();
    resetChats();
    setStreamError('');
    setIsCheckingConnection(false);
  };

  const onPasswordChanged = async (user) => {
    authPasswordChanged(user);
    await handleInitialDataLoad();
  };

  const currentChat = chats.find((c) => c.id === activeChatId);
  const isSuperAdmin = currentUser?.role === 'superadmin';
  const isAdmin = currentUser?.role === 'admin' || isSuperAdmin;

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F5EF] text-[#14201C] font-sans antialiased" dir="rtl">
      {/* Sovereign Workspace Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={onSelectChat}
        onNewChat={onNewChat}
        onUpdateChatTitle={handleUpdateChatTitle}
        onTogglePinChat={handleTogglePinChat}
        onDeleteChat={handleDeleteChat}
        currentUser={currentUser}
        onOpenUsersModal={() => setIsUsersModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenTemplatesModal={() => setIsTemplatesModalOpen(true)}
        onLogout={onLogout}
      />

      {/* Main Conversation & Document View */}
      <ChatView
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        currentChat={currentChat}
        classification={classification}
        onChangeClassification={handleChangeClassification}
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        streamingReasoning={streamingReasoning}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        isConnected={isConnected}
        isCheckingConnection={isCheckingConnection}
        connectionError={connectionError}
        streamError={streamError}
        onDismissStreamError={() => setStreamError('')}
        onRefreshModels={checkModels}
        temperature={temperature}
        onChangeTemperature={setTemperature}
        maxTokens={maxTokens}
        onChangeMaxTokens={setMaxTokens}
        onSendMessage={onSendMessage}
        onStopGeneration={onStopGeneration}
        onRegenerate={onRegenerate}
        onClearMessages={handleClearMessages}
        onOpenTemplatesModal={() => setIsTemplatesModalOpen(true)}
        onUpdateChatTitle={handleUpdateChatTitle}
        onTogglePinChat={handleTogglePinChat}
        onDeleteChat={handleDeleteChat}
        isSuperAdmin={isSuperAdmin}
      />

      {/* Authentication Modal */}
      {!currentUser && <LoginModal onLoginSuccess={handleLoginSuccess} notice={sessionNotice} />}

      {/* Forced Password Change Modal */}
      {currentUser && mustChangePassword && (
        <ChangePasswordModal onChanged={onPasswordChanged} onLogout={onLogout} />
      )}

      {/* Administrative Users & Cadre Modal */}
      <UsersModal
        isOpen={isUsersModalOpen}
        onClose={() => setIsUsersModalOpen(false)}
        currentUser={currentUser}
      />

      {/* Platform & Model Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => {
          setIsSettingsModalOpen(false);
          checkModels();
          loadSystemSettings();
        }}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
      />

      {/* Sovereign Government Correspondence Templates Modal */}
      <GovernmentTemplatesModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        onSelectTemplate={(prompt) => onSendMessage(prompt, [])}
        currentUser={currentUser}
      />
    </div>
  );
}
