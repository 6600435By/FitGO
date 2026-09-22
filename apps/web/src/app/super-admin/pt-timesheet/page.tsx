'use client';

import type { TrainerDaySheetDto } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

export default function SuperAdminPtTimesheetPage() {
  const [sheets, setSheets] = useState<TrainerDaySheetDto[]>([]);
  const [selected, setSelected] = useState<TrainerDaySheetDto | null>(null);
  const [forceIds, setForceIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setSheets(await api.saPtSheets(token, 'ADMIN_APPROVED'));
  };

  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">Табели ПТ → ЗП</h1>
        <p className="text-sm text-slate-400">
          Финальная проверка. Неоплаченное не в мотивации, кроме force-pay.
        </p>
      </header>

      {message && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      )}

      <ul className="space-y-2">
        {sheets.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="w-full rounded-xl border border-slate-800 p-3 text-left hover:border-slate-600"
              onClick={() => {
                setSelected(s);
                setForceIds([]);
              }}
            >
              <span className="font-medium text-white">{s.trainerName}</span>
              <span className="ml-2 text-slate-400">{s.date}</span>
              <span className="ml-2 text-fitgo-300">
                {money(s.totalMinor, s.currency)}
              </span>
              <span className="ml-2 text-xs text-slate-500">
                неоплат {s.unpaidCount}
              </span>
            </button>
          </li>
        ))}
        {sheets.length === 0 && (
          <p className="text-sm text-slate-500">Нет табелей на утверждении</p>
        )}
      </ul>

      {selected && (
        <section className="space-y-3 rounded-2xl border border-slate-800 p-4">
          <h2 className="font-medium text-white">
            {selected.trainerName} · {selected.date}
          </h2>
          <p className="text-sm text-slate-400">
            Смена {money(selected.shiftPayMinor, selected.currency)} + мотивация{' '}
            {money(selected.sessionMotivationMinor, selected.currency)}
          </p>
          {selected.lines.map((l) => {
            const unpaid =
              !l.isComplimentary &&
              l.paymentStatus !== 'PAID' &&
              !l.forceIncludeInPayroll;
            return (
              <label
                key={l.id}
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  unpaid ? 'border-amber-500/30' : 'border-slate-800'
                }`}
              >
                {unpaid && (
                  <input
                    type="checkbox"
                    checked={forceIds.includes(l.bookingId)}
                    onChange={(e) => {
                      setForceIds((prev) =>
                        e.target.checked
                          ? [...prev, l.bookingId]
                          : prev.filter((id) => id !== l.bookingId),
                      );
                    }}
                  />
                )}
                <div>
                  <p className="text-white">{l.clientName}</p>
                  <p className="text-xs text-slate-500">
                    {l.paymentStatus} · {l.payKind}
                    {l.payable ? ' · в ЗП' : ' · не в ЗП'}
                    {unpaid ? ' — отметить force-pay' : ''}
                  </p>
                </div>
              </label>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                const token = getToken();
                if (!token) return;
                try {
                  await api.saPtApproveSheet(
                    token,
                    selected.id,
                    forceIds.length ? forceIds : undefined,
                  );
                  setSelected(null);
                  setMessage('Утверждено для ЗП');
                  await load();
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : 'Ошибка');
                }
              }}
            >
              Утвердить
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                const token = getToken();
                if (!token) return;
                await api.saPtApproveSheet(
                  token,
                  selected.id,
                  forceIds.length ? forceIds : undefined,
                );
                await api.saPtLockSheet(token, selected.id);
                setSelected(null);
                setMessage('Утверждено и зафиксировано');
                await load();
              }}
            >
              Утвердить + Lock
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
