'use client';

import type { ChatMessageItem, ConversationSummary } from '@fitgo/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

type ChatRole = 'client' | 'trainer' | 'admin';

interface TrainerOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface ChatInboxProps {
  role: ChatRole;
  /** For trainer: open chat with specific client */
  initialClientId?: string;
}

export function ChatInbox({ role, initialClientId }: ChatInboxProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatKind, setNewChatKind] = useState<'admin' | 'trainer'>('admin');
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialClientHandled = useRef(false);

  const loadConversations = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const list = await api.chatConversations(token);
    setConversations(list);
    return list;
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const token = getToken();
    if (!token) return;
    const data = await api.chatMessages(token, conversationId);
    setMessages(data.messages);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await loadConversations();
      if (activeId) {
        await loadMessages(activeId);
      }
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  }, [activeId, loadConversations, loadMessages]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (role !== 'client') return;
    const token = getToken();
    if (!token) return;
    api
      .clientClubTrainers(token)
      .then(setTrainers)
      .catch(() => setTrainers([]));
  }, [role]);

  useEffect(() => {
    if (
      role !== 'trainer' ||
      !initialClientId ||
      initialClientHandled.current
    ) {
      return;
    }
    initialClientHandled.current = true;
    const token = getToken();
    if (!token) return;

    api
      .chatOpenTrainerClient(token, initialClientId)
      .then((conversation) => {
        setActiveId(conversation.id);
        return loadMessages(conversation.id);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Не удалось открыть чат'),
      );
  }, [role, initialClientId, loadMessages]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
    }, 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openConversation = async (id: string) => {
    setActiveId(id);
    setError('');
    try {
      await loadMessages(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  };

  const handleSend = async () => {
    const token = getToken();
    if (!token || !activeId || !draft.trim()) return;

    setSending(true);
    setError('');
    try {
      const message = await api.chatSendMessage(token, activeId, draft.trim());
      setMessages((prev) => [...prev, message]);
      setDraft('');
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  const handleStartChat = async () => {
    const token = getToken();
    if (!token) return;
    if (newChatKind === 'trainer' && !selectedTrainerId) {
      setError('Выберите тренера');
      return;
    }

    setSending(true);
    setError('');
    try {
      const conversation = await api.chatCreateConversation(token, {
        kind: newChatKind,
        trainerId:
          newChatKind === 'trainer' ? selectedTrainerId : undefined,
      });
      setShowNewChat(false);
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id);
        return exists ? prev : [conversation, ...prev];
      });
      await openConversation(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать чат');
    } finally {
      setSending(false);
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeId);

  if (loading && conversations.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[420px] flex-col gap-3 md:flex-row">
      <div
        className={`card flex w-full flex-col overflow-hidden md:w-80 md:shrink-0 ${
          activeId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Диалоги</h3>
          {role === 'client' && (
            <button
              type="button"
              onClick={() => setShowNewChat((v) => !v)}
              className="text-sm text-fitgo-400"
            >
              + Новый
            </button>
          )}
        </div>

        {showNewChat && role === 'client' && (
          <div className="mb-3 space-y-2 rounded-xl bg-slate-800/60 p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewChatKind('admin')}
                className={`flex-1 rounded-full px-2 py-1 text-xs ${
                  newChatKind === 'admin'
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                Админ
              </button>
              <button
                type="button"
                onClick={() => setNewChatKind('trainer')}
                className={`flex-1 rounded-full px-2 py-1 text-xs ${
                  newChatKind === 'trainer'
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                Тренер
              </button>
            </div>
            {newChatKind === 'trainer' && (
              <select
                value={selectedTrainerId}
                onChange={(e) => setSelectedTrainerId(e.target.value)}
                className="w-full rounded-lg bg-slate-800 px-2 py-2 text-sm"
              >
                <option value="">Выберите тренера</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleStartChat}
              disabled={sending}
              className="btn-primary w-full text-sm disabled:opacity-50"
            >
              Начать чат
            </button>
          </div>
        )}

        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {role === 'client'
                ? 'Начните диалог с администрацией или тренером'
                : 'Пока нет диалогов'}
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => openConversation(conversation.id)}
                className={`w-full rounded-xl px-3 py-2 text-left transition ${
                  activeId === conversation.id
                    ? 'bg-fitgo-500/15 ring-1 ring-fitgo-500/30'
                    : 'bg-slate-800/40 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{conversation.title}</p>
                    {conversation.subtitle && (
                      <p className="truncate text-xs text-slate-500">
                        {conversation.subtitle}
                      </p>
                    )}
                    {conversation.lastMessage && (
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {conversation.lastMessage}
                      </p>
                    )}
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-fitgo-500 px-2 py-0.5 text-xs text-white">
                      {conversation.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div
        className={`card flex min-w-0 flex-1 flex-col overflow-hidden ${
          activeId ? 'flex' : 'hidden md:flex'
        }`}
      >
        {!activeConversation ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            Выберите диалог
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 border-b border-slate-800 pb-3">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="text-sm text-fitgo-400 md:hidden"
              >
                ← Назад
              </button>
              <div>
                <p className="font-medium">{activeConversation.title}</p>
                {activeConversation.subtitle && (
                  <p className="text-xs text-slate-500">
                    {activeConversation.subtitle}
                  </p>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  Напишите первое сообщение
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.isMine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        message.isMine
                          ? 'rounded-br-md bg-fitgo-500 text-white'
                          : 'rounded-bl-md bg-slate-800 text-slate-100'
                      }`}
                    >
                      {!message.isMine && (
                        <p className="mb-1 text-xs opacity-70">
                          {message.senderName}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">
                        {message.body}
                      </p>
                      <p
                        className={`mt-1 text-[10px] ${
                          message.isMine ? 'text-white/70' : 'text-slate-500'
                        }`}
                      >
                        {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {error && (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            )}

            <div className="mt-3 flex gap-2 border-t border-slate-800 pt-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Сообщение..."
                rows={2}
                className="flex-1 resize-none rounded-xl bg-slate-800 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                className="btn-primary self-end px-4 disabled:opacity-50"
              >
                →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
