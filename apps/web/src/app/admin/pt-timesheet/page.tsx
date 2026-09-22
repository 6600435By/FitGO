'use client';

import type {
  PtClientIssueQueueItem,
  TrainerDaySheetDto,
} from '@fitgo/shared-types';
import { clientIssueLabel } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function AdminPtTimesheetPage() {
  const [issues, setIssues] = useState<PtClientIssueQueueItem[]>([]);
  const [sheets, setSheets] = useState<TrainerDaySheetDto[]>([]);
  const [selected, setSelected] = useState<TrainerDaySheetDto | null>(null);
  const [phoneFixes, setPhoneFixes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  const load = async () => {
    const token = getToken();
    if (!token) return;
    const [iss, sh] = await Promise.all([
      api.adminPtClientIssues(token),
      api.adminPtSheets(token, 'ADMIN_REVIEW'),
    ]);
    setIssues(iss);
    setSheets(sh);
  };

  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">Табели ПТ</h1>
        <p className="text-sm text-slate-400">
          Очередь ошибочных телефонов / late-add и утверждение дневных табелей.
        </p>
      </header>

      {message && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">
          Клиенты / телефон ({issues.length})
        </h2>
        {issues.length === 0 && (
          <p className="text-sm text-slate-500">Очередь пуста</p>
        )}
        {issues.map((i) => (
          <div
            key={i.bookingId}
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
          >
            <p className="font-medium text-white">
              {i.clientName}{' '}
              <span className="text-xs text-slate-400">· {i.trainerName}</span>
            </p>
            <p className="text-xs text-slate-500">
              {i.clientPhone ?? '—'} ·{' '}
              {new Date(i.startAt).toLocaleString('ru-RU')}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {i.isLateAdd && (
                <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">
                  late-add
                </span>
              )}
              {i.clientIssue !== 'NONE' && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                  {clientIssueLabel(i.clientIssue) || i.clientIssue}
                </span>
              )}
              {i.clientIssueEscalated && (
                <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
                  эскалация
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Телефон из 1С"
                value={phoneFixes[i.bookingId] ?? ''}
                onChange={(e) =>
                  setPhoneFixes({
                    ...phoneFixes,
                    [i.bookingId]: e.target.value,
                  })
                }
              />
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={async () => {
                  const token = getToken();
                  if (!token || !phoneFixes[i.bookingId]) return;
                  await api.adminPtRebindPhone(
                    token,
                    i.bookingId,
                    phoneFixes[i.bookingId],
                  );
                  await load();
                }}
              >
                Привязать
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={async () => {
                  const token = getToken();
                  if (!token) return;
                  await api.adminPtResolveClient(token, i.bookingId);
                  await load();
                }}
              >
                Снять флаг
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">
          На проверке ({sheets.length})
        </h2>
        <ul className="space-y-2">
          {sheets.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-left hover:border-slate-600"
                onClick={async () => {
                  const token = getToken();
                  if (!token) return;
                  setSelected(await api.adminPtSheet(token, s.id));
                }}
              >
                <span className="font-medium text-white">{s.trainerName}</span>
                <span className="ml-2 text-sm text-slate-400">{s.date}</span>
                <span className="ml-2 text-xs text-slate-500">
                  проблем {s.openClientIssues} · неоплат {s.unpaidCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section className="space-y-3 rounded-2xl border border-slate-800 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium text-white">
              {selected.trainerName} · {selected.date}
            </h2>
            <button
              type="button"
              className="text-sm text-slate-400"
              onClick={() => setSelected(null)}
            >
              Закрыть
            </button>
          </div>
          {selected.lines.map((l) => (
            <div
              key={l.id}
              className={`rounded-lg border p-3 text-sm ${
                l.clientIssue !== 'NONE'
                  ? 'border-amber-500/40'
                  : l.verified1c
                    ? 'border-emerald-500/30'
                    : 'border-slate-800'
              }`}
            >
              <p className="font-medium text-white">
                {l.clientName}{' '}
                <span className="text-xs text-slate-500">{l.clientPhone}</span>
              </p>
              <p className="text-xs text-slate-500">
                {l.payKind} · {l.paymentStatus}
                {l.payable ? ' · в ЗП' : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={async () => {
                    const token = getToken();
                    if (!token) return;
                    try {
                      setSelected(
                        await api.adminPtVerify1c(token, l.bookingId),
                      );
                    } catch (e) {
                      setMessage(
                        e instanceof Error ? e.message : 'Сверка недоступна',
                      );
                    }
                  }}
                >
                  Сверка 1С
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={async () => {
                    const token = getToken();
                    if (!token) return;
                    setSelected(
                      await api.adminPtSetPayment(token, l.bookingId, {
                        paymentStatus: 'PAID',
                        payKind: 'PAID',
                        verified1c: true,
                      }),
                    );
                  }}
                >
                  Оплачено
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={async () => {
                    const token = getToken();
                    if (!token) return;
                    setSelected(
                      await api.adminPtSetPayment(token, l.bookingId, {
                        paymentStatus: 'DEBT',
                      }),
                    );
                  }}
                >
                  Долг
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn-primary w-full"
            onClick={async () => {
              const token = getToken();
              if (!token) return;
              try {
                await api.adminPtApproveSheet(token, selected.id);
                setSelected(null);
                setMessage('Табель утверждён');
                await load();
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'Ошибка');
              }
            }}
          >
            Утвердить табель
          </button>
        </section>
      )}

      <Link href="/admin/payroll" className="text-sm text-fitgo-400">
        → Моя ЗП
      </Link>
    </div>
  );
}
