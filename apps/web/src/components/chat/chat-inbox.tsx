'use client';

import type { ChatMessageItem, ConversationSummary } from '@fitgo/shared-types';
import { ArrowLeft, Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { syncAppBadgeFromUnread } from '@/lib/push';
import { formatDateTime } from '@/lib/utils';

type ChatRole = 'client' | 'trainer' | 'admin' | 'staff';

interface TrainerOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface StaffOption {
  id: string;
  firstName: string;
  lastName: string;
  roleLabel: string;
}

interface ChatInboxProps {
  role: ChatRole;
  initialClientId?: string;
  scope?: 'clients' | 'admin' | 'trainers' | 'staff';
  directThread?: boolean;
  /** Staff can pick a teammate and start a DM */
  allowStaffChat?: boolean;
  /** Manager / super-admin can create named group chats */
  allowGroupChat?: boolean;
}

function initials(title: string) {
  const parts = title.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return title.slice(0, 2).toUpperCase();
}

function formatListTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const isToday =
    date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

export function ChatInbox({
  role,
  initialClientId,
  scope,
  directThread = false,
  allowStaffChat = role !== 'client',
  allowGroupChat = false,
}: ChatInboxProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [staffComposeMode, setStaffComposeMode] = useState<'dm' | 'group'>('dm');
  const [newChatKind, setNewChatKind] = useState<'admin' | 'trainer'>('admin');
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState('');
  const [staffRecipients, setStaffRecipients] = useState<StaffOption[]>([]);
  const [staffQuery, setStaffQuery] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>(
    [],
  );
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [editGroupTitle, setEditGroupTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialClientHandled = useRef(false);
  const deepLinkHandled = useRef(false);
  const [deepLinkConversationId] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('c');
  });

  const loadConversations = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const list = await api.chatConversations(token, scope);
    setConversations(list);
    return list;
  }, [scope]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const token = getToken();
    if (!token) return;
    const data = await api.chatMessages(token, conversationId);
    setMessages(data.messages);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, ...data.conversation, unreadCount: 0 }
          : c,
      ),
    );
    void syncAppBadgeFromUnread();
  }, []);

  const refresh = useCallback(async () => {
    try {
      await loadConversations();
      if (activeId) {
        await loadMessages(activeId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  }, [activeId, loadConversations, loadMessages]);

  useEffect(() => {
    if (!directThread) return;
    const token = getToken();
    if (!token) return;

    setLoading(true);
    api
      .chatOpenTrainerAdmin(token)
      .then(async (conversation) => {
        setActiveId(conversation.id);
        setLoadingThread(true);
        await loadMessages(conversation.id);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Не удалось открыть чат'),
      )
      .finally(() => {
        setLoading(false);
        setLoadingThread(false);
      });
  }, [directThread, loadMessages]);

  useEffect(() => {
    if (directThread) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh, directThread]);

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
    if ((!allowStaffChat && !allowGroupChat) || role === 'client') return;
    const token = getToken();
    if (!token) return;
    api
      .chatStaffRecipients(token)
      .then(setStaffRecipients)
      .catch(() => setStaffRecipients([]));
  }, [allowStaffChat, allowGroupChat, role]);

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
      .then(async (conversation) => {
        setActiveId(conversation.id);
        setLoadingThread(true);
        await loadMessages(conversation.id);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Не удалось открыть чат'),
      )
      .finally(() => setLoadingThread(false));
  }, [role, initialClientId, loadMessages]);

  useEffect(() => {
    if (
      directThread ||
      !deepLinkConversationId ||
      deepLinkHandled.current ||
      loading
    ) {
      return;
    }
    deepLinkHandled.current = true;
    setActiveId(deepLinkConversationId);
    setLoadingThread(true);
    void loadMessages(deepLinkConversationId)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Ошибка загрузки'),
      )
      .finally(() => setLoadingThread(false));
  }, [deepLinkConversationId, directThread, loadMessages, loading]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
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
    setLoadingThread(true);
    try {
      await loadMessages(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingThread(false);
    }
  };

  const closeConversation = () => {
    setActiveId(null);
    setMessages([]);
    setDraft('');
    setError('');
    setShowGroupEdit(false);
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

  const handleStartStaffChat = async () => {
    const token = getToken();
    if (!token) return;
    if (!selectedStaffId) {
      setError('Выберите сотрудника');
      return;
    }
    setSending(true);
    setError('');
    try {
      const conversation = await api.chatOpenStaff(token, selectedStaffId);
      setShowNewChat(false);
      setStaffQuery('');
      setSelectedStaffId('');
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

  const toggleGroupMember = (id: string) => {
    setSelectedGroupMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleStartGroupChat = async () => {
    const token = getToken();
    if (!token) return;
    if (!groupTitle.trim()) {
      setError('Укажите название группы');
      return;
    }
    if (selectedGroupMemberIds.length === 0) {
      setError('Добавьте хотя бы одного сотрудника');
      return;
    }
    setSending(true);
    setError('');
    try {
      const conversation = await api.chatCreateGroup(token, {
        title: groupTitle.trim(),
        memberIds: selectedGroupMemberIds,
      });
      setShowNewChat(false);
      setStaffComposeMode('dm');
      setGroupTitle('');
      setSelectedGroupMemberIds([]);
      setStaffQuery('');
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id);
        return exists ? prev : [conversation, ...prev];
      });
      await openConversation(conversation.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось создать группу',
      );
    } finally {
      setSending(false);
    }
  };

  const filteredStaff = staffRecipients.filter((s) => {
    if (!staffQuery.trim()) return true;
    const q = staffQuery.trim().toLowerCase();
    return (
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      s.roleLabel.toLowerCase().includes(q)
    );
  });

  const isClientRole = role === 'client';
  const canStartNew = isClientRole || allowStaffChat || allowGroupChat;

  const activeConversation = conversations.find((c) => c.id === activeId);
  const isActiveGroup = activeConversation?.kind === 'GROUP';

  const handleSaveGroupEdit = async () => {
    const token = getToken();
    const current = conversations.find((c) => c.id === activeId);
    if (!token || !activeId || !current || current.kind !== 'GROUP') return;
    const currentIds = new Set(current.memberIds ?? []);
    const desiredIds = new Set(selectedGroupMemberIds);
    const addMemberIds = [...desiredIds].filter((id) => !currentIds.has(id));
    const removeMemberIds = [...currentIds].filter(
      (id) => !desiredIds.has(id),
    );

    setSending(true);
    setError('');
    try {
      const updated = await api.chatUpdateGroup(token, activeId, {
        title: editGroupTitle.trim() || undefined,
        addMemberIds: addMemberIds.length ? addMemberIds : undefined,
        removeMemberIds: removeMemberIds.length ? removeMemberIds : undefined,
      });
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      );
      setShowGroupEdit(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось сохранить группу',
      );
    } finally {
      setSending(false);
    }
  };

  const openGroupEdit = () => {
    const current = conversations.find((c) => c.id === activeId);
    if (!current || current.kind !== 'GROUP') return;
    setEditGroupTitle(current.title);
    setSelectedGroupMemberIds((current.memberIds ?? []).filter(Boolean));
    setStaffQuery('');
    setShowGroupEdit(true);
  };

  if (loading && !activeId && !directThread) {
    return (
      <div className="flex h-[calc(100vh-10rem)] min-h-[480px] items-center justify-center rounded-2xl bg-slate-900/50 ring-1 ring-slate-800">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  if (loading && directThread && !activeId) {
    return (
      <div className="flex h-[calc(100vh-10rem)] min-h-[480px] items-center justify-center rounded-2xl bg-slate-900/50 ring-1 ring-slate-800">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] min-h-[480px] flex-col overflow-hidden rounded-2xl bg-slate-900/50 ring-1 ring-slate-800">
      {!activeId ? (
        <>
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="font-semibold">Чаты</h3>
            {canStartNew ? (
              <button
                type="button"
                onClick={() => setShowNewChat((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-fitgo-500/15 text-fitgo-400 transition hover:bg-fitgo-500/25"
                aria-label="Новый чат"
              >
                <Plus className="h-5 w-5" />
              </button>
            ) : null}
          </div>

          {showNewChat && isClientRole && (
            <div className="space-y-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewChatKind('admin')}
                  className={`flex-1 rounded-full px-3 py-2 text-sm ${
                    newChatKind === 'admin'
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Администратор
                </button>
                <button
                  type="button"
                  onClick={() => setNewChatKind('trainer')}
                  className={`flex-1 rounded-full px-3 py-2 text-sm ${
                    newChatKind === 'trainer'
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Тренер
                </button>
              </div>
              {newChatKind === 'trainer' && (
                <select
                  value={selectedTrainerId}
                  onChange={(e) => setSelectedTrainerId(e.target.value)}
                  className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm"
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

          {showNewChat &&
            (allowStaffChat || allowGroupChat) &&
            !isClientRole && (
            <div className="space-y-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3">
              {allowGroupChat ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStaffComposeMode('dm')}
                    className={`flex-1 rounded-full px-3 py-2 text-sm ${
                      staffComposeMode === 'dm'
                        ? 'bg-fitgo-500 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    Личное
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffComposeMode('group')}
                    className={`flex-1 rounded-full px-3 py-2 text-sm ${
                      staffComposeMode === 'group'
                        ? 'bg-fitgo-500 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    Группа
                  </button>
                </div>
              ) : null}

              {staffComposeMode === 'group' && allowGroupChat ? (
                <>
                  <p className="text-sm text-slate-300">Новая группа</p>
                  <input
                    className="input w-full text-sm"
                    placeholder="Название группы"
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    maxLength={80}
                  />
                  <input
                    className="input w-full text-sm"
                    placeholder="Поиск по имени или роли"
                    value={staffQuery}
                    onChange={(e) => setStaffQuery(e.target.value)}
                  />
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {filteredStaff.length === 0 ? (
                      <p className="text-xs text-slate-500">Никого не найдено</p>
                    ) : (
                      filteredStaff.map((s) => {
                        const selected = selectedGroupMemberIds.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleGroupMember(s.id)}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                              selected
                                ? 'bg-fitgo-500/20 text-fitgo-200'
                                : 'bg-slate-800/60 text-slate-200'
                            }`}
                          >
                            <span>
                              {s.firstName} {s.lastName}
                            </span>
                            <span className="text-xs text-slate-400">
                              {selected ? '✓ ' : ''}
                              {s.roleLabel}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleStartGroupChat()}
                    disabled={
                      sending ||
                      !groupTitle.trim() ||
                      selectedGroupMemberIds.length === 0
                    }
                    className="btn-primary w-full text-sm disabled:opacity-50"
                  >
                    Создать группу
                  </button>
                </>
              ) : allowStaffChat ? (
                <>
                  <p className="text-sm text-slate-300">Написать сотруднику</p>
                  <input
                    className="input w-full text-sm"
                    placeholder="Поиск по имени или роли"
                    value={staffQuery}
                    onChange={(e) => setStaffQuery(e.target.value)}
                  />
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {filteredStaff.length === 0 ? (
                      <p className="text-xs text-slate-500">Никого не найдено</p>
                    ) : (
                      filteredStaff.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedStaffId(s.id)}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                            selectedStaffId === s.id
                              ? 'bg-fitgo-500/20 text-fitgo-200'
                              : 'bg-slate-800/60 text-slate-200'
                          }`}
                        >
                          <span>
                            {s.firstName} {s.lastName}
                          </span>
                          <span className="text-xs text-slate-400">
                            {s.roleLabel}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleStartStaffChat()}
                    disabled={sending || !selectedStaffId}
                    className="btn-primary w-full text-sm disabled:opacity-50"
                  >
                    Начать чат
                  </button>
                </>
              ) : null}
            </div>
          )}

          {error && !activeId && (
            <p className="px-4 py-2 text-sm text-red-400">{error}</p>
          )}

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-400">
                <p className="text-sm">
                  {role === 'client'
                    ? 'Нажмите + чтобы начать диалог с администрацией или тренером'
                    : 'Пока нет диалогов'}
                </p>
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => openConversation(conversation.id)}
                  className="flex w-full items-center gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition hover:bg-slate-800/40 active:bg-slate-800/60"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-fitgo-500/20 text-sm font-semibold text-fitgo-300">
                    {initials(conversation.title)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium">
                        {conversation.title}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500">
                        {formatListTime(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-slate-400">
                        {conversation.lastMessage ??
                          conversation.subtitle ??
                          'Нет сообщений'}
                      </p>
                      {conversation.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-fitgo-500 px-1.5 text-xs font-medium text-white">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-slate-800">
            <div className="flex items-center gap-3 px-3 py-2">
              {!directThread && (
                <button
                  type="button"
                  onClick={closeConversation}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fitgo-400 transition hover:bg-slate-800"
                  aria-label="Назад к списку"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fitgo-500/20 text-sm font-semibold text-fitgo-300">
                  {initials(activeConversation?.title ?? '?')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {activeConversation?.title}
                  </p>
                  {activeConversation?.subtitle && (
                    <p className="truncate text-xs text-slate-500">
                      {activeConversation.subtitle}
                    </p>
                  )}
                </div>
                {allowGroupChat && isActiveGroup ? (
                  <button
                    type="button"
                    onClick={() =>
                      showGroupEdit ? setShowGroupEdit(false) : openGroupEdit()
                    }
                    className="shrink-0 rounded-full bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
                  >
                    {showGroupEdit ? 'Закрыть' : 'Участники'}
                  </button>
                ) : null}
              </div>
            </div>
            {showGroupEdit && allowGroupChat && isActiveGroup ? (
              <div className="space-y-3 border-t border-slate-800 bg-slate-900/80 px-4 py-3">
                <input
                  className="input w-full text-sm"
                  placeholder="Название группы"
                  value={editGroupTitle}
                  onChange={(e) => setEditGroupTitle(e.target.value)}
                  maxLength={80}
                />
                <input
                  className="input w-full text-sm"
                  placeholder="Поиск сотрудников"
                  value={staffQuery}
                  onChange={(e) => setStaffQuery(e.target.value)}
                />
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {filteredStaff.map((s) => {
                    const selected = selectedGroupMemberIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleGroupMember(s.id)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                          selected
                            ? 'bg-fitgo-500/20 text-fitgo-200'
                            : 'bg-slate-800/60 text-slate-200'
                        }`}
                      >
                        <span>
                          {s.firstName} {s.lastName}
                        </span>
                        <span className="text-xs text-slate-400">
                          {selected ? '✓ ' : ''}
                          {s.roleLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveGroupEdit()}
                  disabled={sending || !editGroupTitle.trim()}
                  className="btn-primary w-full text-sm disabled:opacity-50"
                >
                  Сохранить
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            {loadingThread ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
              </div>
            ) : messages.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                Напишите первое сообщение
              </p>
            ) : (
              <div className="space-y-2">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.isMine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
                        message.isMine
                          ? 'rounded-br-sm bg-fitgo-500 text-white'
                          : 'rounded-bl-sm bg-slate-800 text-slate-100'
                      }`}
                    >
                      {!message.isMine && (
                        <p className="mb-0.5 text-xs font-medium opacity-70">
                          {message.senderName}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                        {message.body}
                      </p>
                      <p
                        className={`mt-1 text-right text-[10px] ${
                          message.isMine ? 'text-white/65' : 'text-slate-500'
                        }`}
                      >
                        {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {error && activeId && (
            <p className="px-4 pb-1 text-sm text-red-400">{error}</p>
          )}

          <div className="flex items-end gap-2 border-t border-slate-800 bg-slate-900/80 px-3 py-3">
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
              rows={1}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl bg-slate-800 px-4 py-3 text-sm leading-snug"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fitgo-500 text-white transition hover:bg-fitgo-400 disabled:opacity-40"
              aria-label="Отправить"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
