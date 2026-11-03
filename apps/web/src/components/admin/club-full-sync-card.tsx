'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function cooldownLeft(until: string | null): string | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  return `Через ${min} мин`;
}

type SyncSnapshot = {
  running: {
    runId: string;
    startedAt: string;
    triggeredByName: string | null;
    trigger: string;
    profile: string;
  } | null;
  cooldownUntil: string | null;
  inNightWindow: boolean;
  lastError: string | null;
  dataAsOf: string | null;
};

/**
 * Manual FULL (= nightly 1C dump). Lives on club settings — not next to the
 * compact LIGHT «Обновить из 1С» in the header, to avoid accidental heavy runs.
 */
export function ClubFullSyncCard() {
  const [status, setStatus] = useState<SyncSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wasRunningRef = useRef(false);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return null;
    try {
      const s = await api.getStaffSyncStatus(token);
      setStatus({
        running: s.running,
        cooldownUntil: s.cooldownUntil,
        inNightWindow: s.inNightWindow,
        lastError: s.lastError,
        dataAsOf: s.dataAsOf,
      });
      return s;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить статус');
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void (async () => {
        const s = await load();
        if (!s) return;
        if (wasRunningRef.current && !s.running) {
          setMsg(
            s.lastError
              ? 'Выгрузка завершилась с ошибкой'
              : 'Полная выгрузка завершена',
          );
        }
        wasRunningRef.current = Boolean(s.running);
      })();
    };
    const intervalMs = status?.running ? 5000 : 30_000;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [status?.running, load]);

  const cd = cooldownLeft(status?.cooldownUntil ?? null);
  const running = Boolean(status?.running);
  const isFullRun = status?.running?.profile === 'FULL';
  const disabled =
    busy || running || Boolean(cd) || Boolean(status?.inNightWindow);

  const startFull = async () => {
    const ok = window.confirm(
      'Запустить полную выгрузку из 1С (как ночную 03–04)?\n\n' +
        'Продажи, расписание, визиты, абонементы и связанные кэши. ' +
        'Может занять до ~40 минут и нагружает 1С. ' +
        'Для свежих записей/оплат достаточно «Обновить из 1С» в шапке.',
    );
    if (!ok) return;

    const token = getToken();
    if (!token) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.postStaffSyncRefresh(token, { profile: 'FULL' });
      setStatus({
        running: res.running,
        cooldownUntil: res.cooldownUntil,
        inNightWindow: res.inNightWindow,
        lastError: res.lastError,
        dataAsOf: res.dataAsOf,
      });
      if (res.status === 'started') {
        setMsg('FULL запущена — прогресс также виден в шапке «Данные на …»');
        wasRunningRef.current = true;
      } else if (res.status === 'running') {
        setMsg('Уже идёт выгрузка');
      } else if (res.status === 'cooldown') {
        setErr(
          res.reason === 'night_window'
            ? 'Сейчас ночное окно (03–04) — FULL уже идёт или стартует сама'
            : cooldownLeft(res.cooldownUntil) ||
                'Подождите перед следующим запуском',
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка запуска FULL');
    } finally {
      setBusy(false);
      void load();
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-medium text-white">Синхронизация с 1С</h2>
          <p className="text-xs text-slate-500 sm:text-sm">
            Кнопка FULL дублирует ночную выгрузку (03–04): полный объём кэшей
            клуба. Обычное «Обновить из 1С» в шапке — быстрый LIGHT на текущие
            дни.
          </p>
          {status?.dataAsOf ? (
            <p className="text-xs text-slate-400">
              Данные на {status.dataAsOf}
              {running ? (
                <span className="text-sky-400">
                  {' '}
                  · идёт {isFullRun ? 'FULL' : status.running?.profile ?? 'синк'}
                  {status.running?.triggeredByName
                    ? ` (${status.running.triggeredByName})`
                    : ''}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn-secondary shrink-0 !px-4 !py-2 text-sm font-semibold tracking-wide"
          disabled={disabled}
          title={
            status?.inNightWindow
              ? 'Ночное окно 03–04 — FULL запускается автоматически'
              : cd
                ? cd
                : running
                  ? 'Дождитесь окончания текущей выгрузки'
                  : 'Полная выгрузка как ночью'
          }
          onClick={() => void startFull()}
        >
          {busy || (running && isFullRun)
            ? 'FULL…'
            : status?.inNightWindow
              ? 'Ночь 03–04'
              : cd
                ? cd
                : 'FULL'}
        </button>
      </div>
      {msg ? <p className="text-xs text-emerald-400">{msg}</p> : null}
      {err ? <p className="text-xs text-red-400">{err}</p> : null}
      {!err && status?.lastError && !running ? (
        <p className="break-words text-xs text-red-400">
          Последняя ошибка: {status.lastError}
        </p>
      ) : null}
    </div>
  );
}
