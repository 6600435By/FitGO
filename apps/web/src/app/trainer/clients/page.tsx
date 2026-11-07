'use client';

import {
  MembershipStatus,
  type TrainerClientLookupResult,
  type TrainerClientSummary,
} from '@fitgo/shared-types';
import { Chip, ResponsiveSheet } from '@fitgo/forma-ui';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ClientDesktopCard } from '@/components/trainer-clients/client-desktop-card';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  cn,
  formatDate,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

type Segment =
  | 'all'
  | 'active'
  | 'expiring'
  | 'ghosting'
  | 'new'
  | 'birthday';

function rosterStatusLabel(client: TrainerClientSummary): string {
  if (client.rosterStatus === 'REJECTED') return 'Отклонён';
  if (client.rosterStatus === 'PENDING') return 'Ожидает ответа';
  if (!client.clientAccepted && client.hasApp) return 'Ожидает подтверждения';
  if (!client.hasApp) return 'Нет приложения';
  return 'Подтверждён';
}

function rosterStatusColor(client: TrainerClientSummary): string {
  if (client.rosterStatus === 'REJECTED') return 'bg-red-500/20 text-red-300';
  if (client.rosterStatus === 'PENDING') return 'bg-amber-500/20 text-amber-300';
  if (!client.clientAccepted) return 'bg-amber-500/20 text-amber-300';
  return 'bg-fitgo-500/20 text-fitgo-300';
}

function daysUntil(ymd?: string): number | null {
  if (!ymd) return null;
  const t = Date.parse(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 60 * 60_000));
}

function isBirthdayThisWeek(dob?: string): boolean {
  if (!dob || dob.length < 10) return false;
  const [, m, d] = dob.slice(0, 10).split('-').map(Number);
  if (!m || !d) return false;
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    if (day.getMonth() + 1 === m && day.getDate() === d) return true;
  }
  return false;
}

function lookupBadge(lookup: TrainerClientLookupResult | null): string | null {
  if (!lookup || lookup.pending) return lookup?.pending ? 'Ищем в 1С…' : null;
  if (lookup.source === 'roster' || lookup.inRoster) return 'Уже в вашей базе';
  if (lookup.source === '1c') return 'Найден в 1С';
  if (lookup.source === 'fitgo') return 'Есть в FitGO';
  if (lookup.found === false && lookup.phone.length >= 12) return 'Нет в 1С';
  return null;
}

function matchesSegment(client: TrainerClientSummary, seg: Segment): boolean {
  if (seg === 'all') return true;
  if (seg === 'active') {
    return (
      client.rosterStatus === 'CONFIRMED' &&
      client.membershipStatus === MembershipStatus.ACTIVE
    );
  }
  if (seg === 'expiring') {
    const days = daysUntil(client.membershipValidUntil);
    const lowSessions =
      client.sessionsRemaining != null && client.sessionsRemaining <= 2;
    return lowSessions || (days != null && days >= 0 && days <= 7);
  }
  if (seg === 'ghosting') {
    const ref = client.lastHallVisit ?? client.lastVisit;
    const days = daysUntil(ref);
    return days != null && days <= -14;
  }
  if (seg === 'new') {
    if (!client.inRosterSince) return false;
    const days = daysUntil(client.inRosterSince.slice(0, 10));
    return days != null && days <= 0 && days >= -14;
  }
  if (seg === 'birthday') return isBirthdayThisWeek(client.dateOfBirth);
  return true;
}

export default function TrainerClientsPage() {
  const [clients, setClients] = useState<TrainerClientSummary[]>([]);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'offline' | 'invite' | null>(null);
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const [phone, setPhone] = useState('+375');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [notes, setNotes] = useState('');
  const [lookup, setLookup] = useState<TrainerClientLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [inviteHint, setInviteHint] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadClients = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerClients(token)
      .then(setClients)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (mode !== 'offline' && mode !== 'invite') return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 12) {
      setLookup(null);
      return;
    }
    const token = getToken();
    if (!token) return;
    const t = window.setTimeout(() => {
      setLooking(true);
      api
        .trainerClientLookup(token, phone)
        .then((res) => {
          setLookup(res);
          if (res.firstName) setFirstName(res.firstName);
          if (res.lastName) setLastName(res.lastName);
        })
        .catch(() => setLookup(null))
        .finally(() => setLooking(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [phone, mode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (!matchesSegment(c, segment)) return false;
      if (!q) return true;
      const hay =
        `${c.firstName} ${c.lastName} ${c.phone ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clients, query, segment]);

  const selectedClient = useMemo(
    () => filtered.find((c) => c.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  const segmentCounts = useMemo(() => {
    const counts: Record<Segment, number> = {
      all: clients.length,
      active: 0,
      expiring: 0,
      ghosting: 0,
      new: 0,
      birthday: 0,
    };
    for (const c of clients) {
      (['active', 'expiring', 'ghosting', 'new', 'birthday'] as Segment[]).forEach(
        (s) => {
          if (matchesSegment(c, s)) counts[s] += 1;
        },
      );
    }
    return counts;
  }, [clients]);

  const resetForm = () => {
    setPhone('+375');
    setFirstName('');
    setLastName('');
    setNotes('');
    setLookup(null);
    setFormError('');
    setFormSuccess('');
  };

  const handleOfflineSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setFormError('');
    setFormSuccess('');
    try {
      const result = await api.trainerAddOfflineClient(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        notes: notes.trim() || undefined,
        clientExternalId: lookup?.externalId,
      });
      if ('message' in result) {
        setFormSuccess(result.message);
      } else {
        setFormSuccess('Клиент добавлен в вашу базу');
        setMode(null);
        resetForm();
        loadClients();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleInviteSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setFormError('');
    setFormSuccess('');
    try {
      const result = await api.trainerInviteClient(token, phone.trim());
      setFormSuccess(result.message);
      setMode(null);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const inviteFromCard = async (client: TrainerClientSummary) => {
    const token = getToken();
    if (!token || !client.phone) return;
    setInviteBusyId(client.id);
    setInviteHint('');
    try {
      const result = await api.trainerInviteClient(token, client.phone);
      setInviteHint(result.message || 'Приглашение отправлено');
    } catch (err) {
      setInviteHint(err instanceof Error ? err.message : 'Не удалось пригласить');
    } finally {
      setInviteBusyId(null);
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;

  const badge = lookupBadge(lookup);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Мои клиенты</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              resetForm();
              setMode('offline');
            }}
          >
            Добавить
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => {
              resetForm();
              setMode('invite');
            }}
          >
            Пригласить
          </button>
        </div>
      </div>

      <input
        className="input w-full"
        placeholder="Поиск по имени или телефону"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ['all', 'Все'],
            ['active', 'Активные'],
            ['expiring', 'Пакет заканчивается'],
            ['ghosting', 'Пропадают'],
            ['new', 'Новые'],
            ['birthday', 'ДР'],
          ] as const
        ).map(([id, label]) => (
          <Chip
            key={id}
            active={segment === id}
            count={segmentCounts[id]}
            onClick={() => setSegment(id)}
          >
            {label}
          </Chip>
        ))}
      </div>

      <ResponsiveSheet
        open={mode === 'offline'}
        onOpenChange={(open) => {
          if (!open) {
            setMode(null);
            resetForm();
          }
        }}
        title="Добавить клиента"
        description="Сначала телефон — подтянем ФИО из базы или 1С"
        desktop="dialog"
      >
        <form onSubmit={handleOfflineSubmit} className="space-y-3">
          <input
            className="input w-full"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+375…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {looking && (
            <p className="text-xs text-slate-400">Ищем клиента…</p>
          )}
          {badge && (
            <p className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200">
              {badge}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Имя"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Фамилия"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
          <input
            className="input w-full"
            placeholder="Заметка (необязательно)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          {formSuccess && (
            <p className="text-sm text-fitgo-400">{formSuccess}</p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? 'Сохранение…' : 'Добавить в базу'}
          </button>
        </form>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={mode === 'invite'}
        onOpenChange={(open) => {
          if (!open) {
            setMode(null);
            resetForm();
          }
        }}
        title="Пригласить клиента"
        description="Клиент подтвердит приглашение в приложении"
        desktop="dialog"
      >
        <form onSubmit={handleInviteSubmit} className="space-y-3">
          <input
            className="input w-full"
            inputMode="tel"
            placeholder="+375…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {badge && (
            <p className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200">
              {badge}
            </p>
          )}
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          {formSuccess && (
            <p className="text-sm text-fitgo-400">{formSuccess}</p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? 'Отправка…' : 'Отправить приглашение'}
          </button>
        </form>
      </ResponsiveSheet>

      {inviteHint ? (
        <p className="text-sm text-fitgo-400">{inviteHint}</p>
      ) : null}

      <div className="desktop:grid desktop:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] desktop:items-start desktop:gap-4">
        <div className="min-w-0">
          {filtered.length === 0 ? (
            <div className="card text-center text-slate-400">
              <p>
                {clients.length === 0
                  ? 'Пока нет клиентов в вашей базе'
                  : 'Нет клиентов в этом сегменте'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((client) => {
                const risk =
                  (client.cancelNoShowCount ?? 0) >= 2 ||
                  matchesSegment(client, 'ghosting') ||
                  matchesSegment(client, 'expiring');
                const needsAppInvite = !client.hasApp && Boolean(client.phone);
                const selected = selectedId === client.id;
                return (
                  <li
                    key={client.id}
                    className={cn(
                      'card',
                      selected && 'ring-1 ring-forma-500/40',
                    )}
                  >
                    <Link
                      href={`/trainer/clients/${client.id}`}
                      className="block desktop:hidden"
                    >
                      <ClientListRow client={client} risk={risk} />
                    </Link>
                    <button
                      type="button"
                      className="hidden w-full text-left desktop:block"
                      onClick={() =>
                        setSelectedId((prev) =>
                          prev === client.id ? null : client.id,
                        )
                      }
                    >
                      <ClientListRow client={client} risk={risk} />
                    </button>
                    {needsAppInvite ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">
                          Нет приложения
                        </span>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={inviteBusyId === client.id}
                          onClick={() => void inviteFromCard(client)}
                        >
                          {inviteBusyId === client.id
                            ? 'Отправка…'
                            : 'Пригласить в FitGO'}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="hidden desktop:block">
          {selectedClient ? (
            <ClientDesktopCard
              summary={selectedClient}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-forma-400">
              Выберите клиента в списке
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientListRow({
  client,
  risk,
}: {
  client: TrainerClientSummary;
  risk: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="font-medium">
          {client.firstName} {client.lastName}
        </p>
        {client.phone && (
          <p className="text-sm text-slate-400">{client.phone}</p>
        )}
        {client.membershipName && (
          <p className="mt-1 text-sm text-slate-300">
            {client.membershipName}
            {client.sessionsRemaining != null
              ? ` · осталось ${client.sessionsRemaining}`
              : ''}
            {client.membershipValidUntil
              ? ` · до ${formatDate(client.membershipValidUntil)}`
              : ''}
          </p>
        )}
        {(client.lastHallVisit || client.lastVisit) && (
          <p className="text-xs text-slate-500">
            Визит:{' '}
            {formatDate(client.lastHallVisit ?? client.lastVisit ?? '')}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${rosterStatusColor(client)}`}
        >
          {rosterStatusLabel(client)}
        </span>
        {client.membershipStatus && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${membershipStatusColor(client.membershipStatus)}`}
          >
            {membershipStatusLabel(client.membershipStatus)}
          </span>
        )}
        {risk && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
            Внимание
          </span>
        )}
      </div>
    </div>
  );
}
