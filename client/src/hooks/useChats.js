import { useState } from 'react';
import { chatsService } from '../services/chats.service.js';

/**
 * Custom Hook: Chat Conversations & Message State
 *
 * Encapsulates chat list management, message history, active selection,
 * optimistic renaming, pinning, and deletion.
 */
export function useChats() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [classification, setClassification] = useState('official');

  const loadChats = async (selectFirstIfNone = false) => {
    try {
      const userChats = await chatsService.getChats();
      setChats(userChats);
      if (userChats.length > 0 && (!activeChatId || selectFirstIfNone)) {
        await handleSelectChat(userChats[0].id);
      }
      return userChats;
    } catch (err) {
      console.error('Failed to load chats:', err);
      return [];
    }
  };

  const handleSelectChat = async (chatId, onBeforeSelect) => {
    if (onBeforeSelect) onBeforeSelect();
    setActiveChatId(chatId);
    try {
      const chat = await chatsService.getChat(chatId);
      setMessages(chat.messages || []);
      if (chat.classification) setClassification(chat.classification);
      return chat;
    } catch (err) {
      console.error('Failed to load chat details:', err);
      return null;
    }
  };

  const handleNewChat = async ({
    selectedModel = '',
    defaultSystemPrompt = '',
    onBeforeCreate
  } = {}) => {
    if (onBeforeCreate) onBeforeCreate();
    try {
      const newChat = await chatsService.createChat({
        title: 'جلسة عمل جديدة',
        model: selectedModel,
        systemPrompt: defaultSystemPrompt,
        classification: 'official'
      });
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setClassification('official');
      setMessages([]);
      return newChat;
    } catch (err) {
      console.error('Failed to create new chat:', err);
      return null;
    }
  };

  const handleUpdateChatTitle = async (chatId, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    const cleanTitle = newTitle.trim();

    // Optimistic update
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: cleanTitle } : c)));
    try {
      const updated = await chatsService.updateChat(chatId, { title: cleanTitle });
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c)));
    } catch (err) {
      console.error('Failed to rename chat:', err);
      await loadChats();
    }
  };

  const handleChangeClassification = async (newClass) => {
    setClassification(newClass);
    if (activeChatId) {
      try {
        await chatsService.updateChat(activeChatId, { classification: newClass });
        setChats((prev) =>
          prev.map((c) => (c.id === activeChatId ? { ...c, classification: newClass } : c))
        );
      } catch (err) {
        console.error('Failed to update classification:', err);
      }
    }
  };

  const handleTogglePinChat = async (chatId, pinned) => {
    const isPinned = Boolean(pinned);
    // Optimistic update
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinned: isPinned ? 1 : 0 } : c)));
    try {
      await chatsService.updateChat(chatId, { pinned: isPinned });
      // Re-fetch to guarantee backend sort order (pinned DESC, updated_at DESC)
      const userChats = await chatsService.getChats();
      setChats(userChats);
    } catch (err) {
      console.error('Failed to pin chat:', err);
      await loadChats();
    }
  };

  const handleDeleteChat = async (chatId) => {
    // Optimistic deletion
    const remaining = chats.filter((c) => c.id !== chatId);
    setChats(remaining);

    if (activeChatId === chatId) {
      if (remaining.length > 0) {
        await handleSelectChat(remaining[0].id);
      } else {
        setActiveChatId(null);
        setMessages([]);
      }
    }

    try {
      await chatsService.deleteChat(chatId);
    } catch (err) {
      console.error('Failed to delete chat:', err);
      await loadChats();
    }
  };

  const handleClearMessages = async () => {
    if (!activeChatId) return;
    try {
      await chatsService.clearChat(activeChatId);
      setMessages([]);
    } catch (err) {
      console.error('Failed to clear chat:', err);
    }
  };

  const resetChats = () => {
    setChats([]);
    setMessages([]);
    setActiveChatId(null);
    setClassification('official');
  };

  return {
    chats,
    setChats,
    activeChatId,
    setActiveChatId,
    messages,
    setMessages,
    classification,
    setClassification,
    loadChats,
    handleSelectChat,
    handleNewChat,
    handleUpdateChatTitle,
    handleChangeClassification,
    handleTogglePinChat,
    handleDeleteChat,
    handleClearMessages,
    resetChats
  };
}
