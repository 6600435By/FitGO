'use client';

import type {
  PayrollAdjustmentDto,
  PayrollPeriodSummary,
  PayrollPayoutDto,
  PayrollPayoutKind,
  PayrollPayoutPreview,
  StaffPaySummary,
} from '@fitgo/shared-types';
import { parseMoneyToMinor } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

function bandDot(band: string) {
  if (band === 'GREEN') return 'bg-emerald-400';
  if (band === 'RED') return 'bg-red-400';
  return 'bg-amber-300';
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Safe filename: ФИО + period, without forbidden path characters. */
function payslipFilename(name: string, from: string, to: string): string {
  const safe = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
    .slice(0, 80);
  // Keep YYYY-MM-DD as YYYY-MM-DD (hyphen is OK in filenames)
  const period = `${from}_${to}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
  return `Raschet_${safe || 'sotrudnik'}_${period}.txt`;
}

type DeptFilter = 'ALL' | 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH';

const DEPT_FILTERS: { id: DeptFilter; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'ADMIN', label: 'Админы' },
  { id: 'TRAINER', label: 'Тренеры' },
  { id: 'SPECIALIST', label: 'SPA' },
  { id: 'TECH', label: 'Техперсонал' },
];

const TRACK_HINT: Record<string, string> = {
  ADMIN: 'Часы + % абонементов + % доп. услуг + премии/штрафы',
  GROUP_TRAINER: 'Ставка за занятие при мин. кол-ве человек',
  SPA: '% от оплаченных услуг + ставка за услуги из абонемента',
  TECH: 'Часы смены + премии/штрафы отдельно',
  PT: '% от оплаченных ПТ (ступени по объёму; подарки в счёт)',
};

type PayslipFields = {
  fio: boolean;
  period: boolean;
  motivation: boolean;
  bonus: boolean;
  fine: boolean;
  totals: boolean;
  shifts: boolean;
};

const DEFAULT_PAYSLIP: PayslipFields = {
  fio: true,
  period: true,
  motivation: true,
  bonus: true,
  fine: true,
  totals: true,
  shifts: true,
};

type Props = {
  mode: 'super' | 'admin';
};

export function PayrollWorkspace({ mode }: Props) {
  const today = useMemo(() => new Date(), []);
  const [staff, setStaff] = useState<StaffPaySummary[]>([]);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date(today);
    d.setDate(1);
    return isoDate(d);
  });
  const [to, setTo] = useState(isoDate(today));
  const [summary, setSummary] = useState<PayrollPeriodSummary | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [editingAdjId, setEditingAdjId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printFields, setPrintFields] = useState<PayslipFields>(DEFAULT_PAYSLIP);
  const [docPreview, setDocPreview] = useState('');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('ALL');
  const canEdit = mode === 'super';

  const [payYear, setPayYear] = useState(() => today.getFullYear());
  const [payMonth, setPayMonth] = useState(() => today.getMonth() + 1);
  const [payKind, setPayKind] = useState<PayrollPayoutKind>('ADVANCE_HALF');
  const [payoutPreview, setPayoutPreview] =
    useState<PayrollPayoutPreview | null>(null);
  const [payouts, setPayouts] = useState<PayrollPayoutDto[]>([]);
  const [cardTransfer, setCardTransfer] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);

  useEffect(() => {
    if (!canEdit || !userId) {
      setPayouts([]);
      setPayoutPreview(null);
      return;
    }
    const token = getToken();
    if (!token) return;
    api
      .payrollPayouts(token, userId)
      .then(setPayouts)
      .catch(() => setPayouts([]));
    setPayoutPreview(null);
    setCardTransfer('');
  }, [canEdit, userId]);

  const loadPayoutPreview = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId) return;
    setPayoutBusy(true);
    setMessage('');
    try {
      const p = await api.payrollPayoutPreview(token, {
        userId,
        kind: payKind,
        year: payYear,
        month: payMonth,
      });
      setPayoutPreview(p);
      setFrom(p.periodFrom);
      setTo(p.periodTo);
      setSummary(p.summary);
      if (p.existingPayout?.status === 'PAID') {
        setCardTransfer(
          String((p.existingPayout.cardTransferMinor ?? 0) / 100),
        );
      }
    } catch (e) {
      setPayoutPreview(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка превью выплаты');
    } finally {
      setPayoutBusy(false);
    }
  };

  const confirmPayout = async () => {
    if (!canEdit || !payoutPreview) return;
    if (payoutPreview.existingPayout?.status === 'PAID') {
      setMessage('Эта выплата уже зафиксирована');
      return;
    }
    if (
      !window.confirm(
        `Зафиксировать выплату ${money(payoutPreview.totalMinor, payoutPreview.currency)}?\nКасса: ${(payoutPreview.totalMinor - parseMoneyToMinor(cardTransfer || '0')) / 100} · Карта: ${cardTransfer || '0'}`,
      )
    ) {
      return;
    }
    const token = getToken();
    if (!token) return;
    setPayoutBusy(true);
    setMessage('');
    try {
      const row = await api.payrollPayoutConfirm(token, {
        userId,
        kind: payKind,
        year: payYear,
        month: payMonth,
        cardTransferMinor: parseMoneyToMinor(cardTransfer || '0'),
      });
      setMessage(
        `Выплата зафиксирована: всего ${money(row.totalMinor, row.currency)}, касса ${money(row.cashMinor, row.currency)}, карта ${money(row.cardTransferMinor, row.currency)}`,
      );
      const list = await api.payrollPayouts(token, userId);
      setPayouts(list);
      const p = await api.payrollPayoutPreview(token, {
        userId,
        kind: payKind,
        year: payYear,
        month: payMonth,
      });
      setPayoutPreview(p);
      setSummary(p.summary);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка фиксации');
    } finally {
      setPayoutBusy(false);
    }
  };

  const filteredStaff = useMemo(() => {
    if (deptFilter === 'ALL') return staff;
    return staff.filter((s) => {
      if (s.roles.includes(deptFilter)) return true;
      if (deptFilter === 'ADMIN' && s.track === 'ADMIN') return true;
      if (
        deptFilter === 'TRAINER' &&
        (s.track === 'PT' || s.track === 'GROUP_TRAINER')
      )
        return true;
      if (deptFilter === 'SPECIALIST' && s.track === 'SPA') return true;
      if (deptFilter === 'TECH' && s.track === 'TECH') return true;
      return false;
    });
  }, [staff, deptFilter]);

  const selected = filteredStaff.find((s) => s.userId === userId)
    ?? staff.find((s) => s.userId === userId);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const loadStaff =
      mode === 'super' ? api.payrollStaff(token) : api.adminPayrollStaff(token);
    loadStaff
      .then((list) => {
        setStaff(list);
        if (list[0]) setUserId(list[0].userId);
      })
      .catch((e) => setMessage(e.message || 'Ошибка загрузки сотрудников'));
  }, [mode]);

  useEffect(() => {
    if (!canEdit) return;
    if (filteredStaff.length === 0) {
      setUserId('');
      setSummary(null);
      return;
    }
    if (!filteredStaff.some((s) => s.userId === userId)) {
      setUserId(filteredStaff[0]!.userId);
      setSummary(null);
    }
  }, [canEdit, filteredStaff, userId]);

  const load = async () => {
    const token = getToken();
    if (!token || !userId) return;
    setLoading(true);
    setMessage('');
    try {
      const s =
        mode === 'super'
          ? await api.payrollSummary(token, { userId, from, to })
          : await api.adminPayrollSummary(token, { userId, from, to });
      setSummary(s);
    } catch (e) {
      setSummary(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const lock = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId) return;
    try {
      const s = await api.payrollLock(token, { userId, from, to });
      setSummary(s);
      setMessage('Период зафиксирован');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка lock');
    }
  };

  const saveAdj = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId || !adjReason.trim()) return;
    setMessage('');
    try {
      if (editingAdjId) {
        await api.payrollUpdateAdjustment(token, editingAdjId, {
          amountMinor: Math.round(Number(adjAmount || 0) * 100),
          reason: adjReason.trim(),
        });
        setMessage('Корректировка обновлена');
      } else {
        await api.payrollAdjustment(token, {
          userId,
          amountMinor: Math.round(Number(adjAmount || 0) * 100),
          reason: adjReason.trim(),
          periodFrom: from,
          periodTo: to,
        });
        setMessage('Корректировка добавлена');
      }
      setAdjAmount('');
      setAdjReason('');
      setEditingAdjId(null);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const startEditAdj = (a: PayrollAdjustmentDto) => {
    setEditingAdjId(a.id);
    setAdjAmount(String(a.amountMinor / 100));
    setAdjReason(a.reason);
  };

  const cancelEditAdj = () => {
    setEditingAdjId(null);
    setAdjAmount('');
    setAdjReason('');
  };

  const deleteAdj = async (id: string) => {
    if (!canEdit) return;
    if (!window.confirm('Удалить эту корректировку?')) return;
    const token = getToken();
    if (!token) return;
    try {
      await api.payrollDeleteAdjustment(token, id);
      if (editingAdjId === id) cancelEditAdj();
      setMessage('Корректировка удалена');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка удаления');
    }
  };

  const buildPayslipText = (fields: PayslipFields): string => {
    if (!summary) return '';
    const cur = summary.currency;
    const bonuses = summary.adjustments.filter((a) => a.amountMinor > 0);
    const fines = summary.adjustments.filter((a) => a.amountMinor < 0);
    const lines: string[] = [];
    lines.push('РАСЧЁТНЫЙ ЛИСТ');
    lines.push('='.repeat(40));
    if (fields.fio) lines.push(`ФИО: ${summary.performerName}`);
    if (fields.period) lines.push(`Период: ${summary.from} — ${summary.to}`);
    if (fields.motivation) {
      lines.push('');
      lines.push('Мотивация / ставки:');
      const chips =
        summary.payChips?.length > 0
          ? summary.payChips
          : ['Ставки не заданы'];
      for (const c of chips) lines.push(`  · ${c}`);
      lines.push(`  Оклад / часы: ${money(summary.baseSalaryMinor, cur)}`);
      lines.push(`  Мотивация: ${money(summary.motivationMinor, cur)}`);
    }
    if (fields.bonus) {
      lines.push('');
      lines.push('Премии:');
      if (!bonuses.length) lines.push('  нет');
      else {
        for (const a of bonuses) {
          lines.push(`  + ${money(a.amountMinor, cur)} — ${a.reason}`);
        }
      }
    }
    if (fields.fine) {
      lines.push('');
      lines.push('Штрафы:');
      if (!fines.length) lines.push('  нет');
      else {
        for (const a of fines) {
          lines.push(`  ${money(a.amountMinor, cur)} — ${a.reason}`);
        }
      }
    }
    if (fields.shifts) {
      const shifts = summary.workUnits.filter((u) => u.kind === 'SHIFT');
      lines.push('');
      lines.push('Смены:');
      if (!shifts.length) lines.push('  нет');
      else {
        for (const u of shifts) {
          lines.push(
            `  ${u.occurredAt.slice(0, 10)}  ${u.quantity} ч  ${money(u.priceMinor ?? 0, cur)}`,
          );
        }
      }
    }
    if (fields.totals) {
      lines.push('');
      lines.push('-'.repeat(40));
      lines.push(
        `Корректировки всего: ${money(summary.adjustmentsMinor, cur)}`,
      );
      lines.push(`ИТОГО К ВЫПЛАТЕ: ${money(summary.totalMinor, cur)}`);
    }
    lines.push('');
    return lines.join('\n');
  };

  const openPrintDialog = () => {
    if (!summary) return;
    setPrintFields(DEFAULT_PAYSLIP);
    setDocPreview(buildPayslipText(DEFAULT_PAYSLIP));
    setPrintOpen(true);
  };

  const refreshPreview = (fields: PayslipFields) => {
    setPrintFields(fields);
    setDocPreview(buildPayslipText(fields));
  };

  const savePayslipFile = async () => {
    const text = docPreview || buildPayslipText(printFields);
    if (!text || !summary) return;
    const fileName = payslipFilename(
      summary.performerName,
      summary.from,
      summary.to,
    );
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

    type SavePicker = (opts: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<{
      name: string;
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;

    const showSave = (
      window as Window & { showSaveFilePicker?: SavePicker }
    ).showSaveFilePicker;

    if (typeof showSave === 'function') {
      try {
        const handle = await showSave({
          suggestedName: fileName,
          types: [
            {
              description: 'Текстовый файл',
              accept: { 'text/plain': ['.txt'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setMessage(`Сохранено: ${handle.name}`);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // fall through to download
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage(
      `Файл «${fileName}» скачан в папку загрузок (браузер не дал выбрать место)`,
    );
  };

  const printPayslipDoc = () => {
    const text = docPreview || buildPayslipText(printFields);
    if (!text) return;
    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'style',
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0',
    );
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      setMessage('Не удалось открыть печать');
      return;
    }
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Расчётный лист</title>
<style>
  body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;padding:24px;font-size:13px;color:#111;line-height:1.45}
  @media print{body{padding:12px}}
</style></head><body>${escapeHtml(text)}</body></html>`);
    doc.close();
    const run = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 800);
      }
    };
    setTimeout(run, 200);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-8 md:max-w-none">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Расчёт ЗП
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-slate-400">
            {mode === 'admin'
              ? 'Ваш расчёт за период по проверенным работам. Ставки настраивает супер-админ.'
              : 'Итог за период по проверенным работам. Ставки и % — в Staff.'}
          </p>
        </div>
        {canEdit && (
          <Link
            href="/super-admin/staff"
            className="text-sm text-fitgo-400 hover:text-fitgo-300"
          >
            Staff → ставки
          </Link>
        )}
      </header>

      <section className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4 shadow-lg shadow-black/20 md:p-5">
        {canEdit && (
          <div className="mb-4 flex flex-wrap gap-2">
            {DEPT_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setDeptFilter(f.id)}
                className={
                  deptFilter === f.id
                    ? 'btn-primary px-3 py-1.5 text-sm'
                    : 'btn-secondary px-3 py-1.5 text-sm'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div
          className={
            canEdit
              ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_auto_auto_auto] lg:items-end'
              : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_7.5rem_7.5rem_auto_auto] lg:items-end'
          }
        >
          {canEdit ? (
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Сотрудник
              <select
                className="input mt-1.5 w-full"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setSummary(null);
                }}
              >
                {filteredStaff.length === 0 ? (
                  <option value="">Нет сотрудников в фильтре</option>
                ) : (
                  filteredStaff.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.name}
                      {s.track ? ` · ${s.track}` : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Моя ЗП
              </p>
              <p className="mt-0.5 font-medium text-white">
                {selected?.name ?? '…'}
              </p>
            </div>
          )}
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            С
            <input
              type="date"
              className="input mt-1.5 w-full"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            По
            <input
              type="date"
              className="input mt-1.5 w-full"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary w-full lg:min-w-[7.5rem] lg:w-auto"
            disabled={loading || !userId}
            onClick={load}
          >
            {loading ? 'Считаем…' : 'Рассчитать'}
          </button>
          <button
            type="button"
            className="btn-secondary w-full lg:w-auto"
            disabled={!summary}
            onClick={openPrintDialog}
          >
            Печать листа
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary w-full lg:w-auto"
              disabled={!summary?.canLock}
              onClick={lock}
              title={
                summary && !summary.canLock
                  ? `Открытых нестыковок: ${summary.openExceptions}`
                  : undefined
              }
            >
              Lock
            </button>
          )}
        </div>

        {selected && (
          <div className="mt-4 space-y-2 border-t border-slate-800/80 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {selected.track && (
                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                  {selected.track}
                </span>
              )}
              {canEdit && (
                <Link
                  href={`/super-admin/staff/${selected.userId}`}
                  className="text-xs text-fitgo-400 hover:underline"
                >
                  Изменить ставки
                </Link>
              )}
            </div>
            {selected.track && TRACK_HINT[selected.track] && (
              <p className="text-xs text-slate-500">
                {TRACK_HINT[selected.track]}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selected.payChips.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-0.5 text-xs text-slate-300"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {canEdit && userId && (
        <section className="space-y-4 rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4 md:p-5">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Выплаты (15 / 25)
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              25-е — аванс за 1–15 (админы и штатные тренеры: фикс из оклада;
              остальные — по мотивации). 15-е — расчёт за прошлый месяц минус
              уже выплаченный аванс. Перевод на карту входит в итого, из кассы
              уходит остаток.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[6rem_8rem_1fr_auto] lg:items-end">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Год
              <input
                type="number"
                className="input mt-1.5 w-full"
                value={payYear}
                onChange={(e) => setPayYear(Number(e.target.value) || payYear)}
              />
            </label>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Месяц волны
              <select
                className="input mt-1.5 w-full"
                value={payMonth}
                onChange={(e) => setPayMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Этап
              <select
                className="input mt-1.5 w-full"
                value={payKind}
                onChange={(e) =>
                  setPayKind(e.target.value as PayrollPayoutKind)
                }
              >
                <option value="ADVANCE_HALF">25-е · аванс (1–15)</option>
                <option value="MONTH_SETTLEMENT">
                  15-е · расчёт за прошлый месяц
                </option>
              </select>
            </label>
            <button
              type="button"
              className="btn-primary w-full lg:w-auto"
              disabled={payoutBusy || !userId}
              onClick={loadPayoutPreview}
            >
              {payoutBusy ? '…' : 'Превью'}
            </button>
          </div>

          {payoutPreview && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-white">{payoutPreview.performerName}</span>
                <span className="text-slate-400">
                  {payoutPreview.periodFrom} — {payoutPreview.periodTo}
                </span>
                {payoutPreview.usesFixedAdvance && (
                  <span className="rounded-md bg-fitgo-500/15 px-2 py-0.5 text-xs text-fitgo-300">
                    фикс аванс
                  </span>
                )}
                {payoutPreview.existingPayout?.status === 'PAID' && (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                    уже выплачено
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat
                  label="Начислено"
                  value={money(
                    payoutPreview.earnedMinor,
                    payoutPreview.currency,
                  )}
                />
                <Stat
                  label="− Аванс 25-е"
                  value={money(
                    payoutPreview.priorPaidMinor,
                    payoutPreview.currency,
                  )}
                />
                <Stat
                  label="К выплате"
                  value={money(
                    payoutPreview.totalMinor,
                    payoutPreview.currency,
                  )}
                  emphasize
                />
                <Stat
                  label="Из кассы"
                  value={money(
                    Math.max(
                      0,
                      payoutPreview.totalMinor -
                        parseMoneyToMinor(cardTransfer || '0'),
                    ),
                    payoutPreview.currency,
                  )}
                />
              </div>
              {payoutPreview.hints.length > 0 && (
                <ul className="space-y-0.5 text-xs text-slate-500">
                  {payoutPreview.hints.map((h) => (
                    <li key={h}>· {h}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                  На карту (бухгалтер), BYN
                  <input
                    className="input mt-1.5 w-full"
                    inputMode="decimal"
                    placeholder="0"
                    disabled={payoutPreview.existingPayout?.status === 'PAID'}
                    value={cardTransfer}
                    onChange={(e) => setCardTransfer(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn-primary w-full sm:w-auto"
                  disabled={
                    payoutBusy ||
                    payoutPreview.existingPayout?.status === 'PAID' ||
                    payoutPreview.totalMinor < 0
                  }
                  onClick={confirmPayout}
                >
                  Зафиксировать выплату
                </button>
              </div>
            </div>
          )}

          {payouts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                История выплат
              </h3>
              <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 text-sm">
                {payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div>
                      <span className="text-slate-300">
                        {p.kind === 'ADVANCE_HALF'
                          ? 'Аванс 25-е'
                          : 'Расчёт 15-е'}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {p.periodFrom} — {p.periodTo}
                      </span>
                    </div>
                    <div className="tabular-nums text-slate-400">
                      <span className="text-white">
                        {money(p.totalMinor, p.currency)}
                      </span>
                      <span className="ml-2 text-xs">
                        касса {money(p.cashMinor, p.currency)} · карта{' '}
                        {money(p.cardTransferMinor, p.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {message && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      )}

      {summary && (
        <>
          <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
            <Stat
              label="Оклад / часы"
              value={money(summary.baseSalaryMinor, summary.currency)}
            />
            <Stat
              label="Мотивация"
              value={money(summary.motivationMinor, summary.currency)}
            />
            <Stat
              label="± Корректировки"
              value={money(summary.adjustmentsMinor, summary.currency)}
            />
            <Stat
              label="Итого"
              value={money(summary.totalMinor, summary.currency)}
              emphasize
            />
          </section>

          <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm">
            <span className="font-medium text-white">{summary.performerName}</span>
            <span
              className={
                summary.openExceptions ? 'text-amber-300' : 'text-emerald-400'
              }
            >
              нестыковок: {summary.openExceptions}
            </span>
            <span className="text-slate-500">
              GREEN {summary.greenCount} · RESOLVED {summary.resolvedCount}
            </span>
            {summary.locked && (
              <span className="rounded-full bg-fitgo-500/15 px-2 py-0.5 text-xs text-fitgo-300">
                LOCKED
              </span>
            )}
          </section>

          {summary.anomalyHints.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
              {summary.anomalyHints.map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          )}

          {canEdit && (
            <section className="space-y-3 rounded-2xl border border-slate-800 p-4 md:flex md:items-end md:gap-3 md:space-y-0">
              <div className="md:flex-1 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {editingAdjId ? 'Редактировать корректировку' : 'Премия / штраф'}
                </p>
                <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="± BYN"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Причина"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex w-full gap-2 md:w-auto">
                <button
                  type="button"
                  className="btn-secondary flex-1 md:flex-none"
                  onClick={saveAdj}
                >
                  {editingAdjId ? 'Сохранить' : 'Добавить'}
                </button>
                {editingAdjId && (
                  <button
                    type="button"
                    className="btn-secondary flex-1 md:flex-none"
                    onClick={cancelEditAdj}
                  >
                    Отмена
                  </button>
                )}
              </div>
            </section>
          )}

          {(summary.adjustments?.length ?? 0) > 0 && (
            <section className="space-y-2 rounded-2xl border border-slate-800 p-4">
              <h2 className="text-sm font-medium text-slate-300">
                Премии и штрафы
              </h2>
              <ul className="space-y-1 text-sm">
                {summary.adjustments.map((a: PayrollAdjustmentDto) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/80 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-slate-400">{a.reason}</span>
                      <span
                        className={`ml-2 tabular-nums ${
                          a.amountMinor >= 0
                            ? 'text-emerald-400'
                            : 'text-red-300'
                        }`}
                      >
                        {money(a.amountMinor, summary.currency)}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="flex gap-3 text-xs">
                        <button
                          type="button"
                          className="text-sky-300"
                          onClick={() => startEditAdj(a)}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="text-red-300"
                          onClick={() => deleteAdj(a.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300">
              Работы за период ({summary.workUnits.length})
            </h2>

            <div className="space-y-2 md:hidden">
              {summary.workUnits.length === 0 ? (
                <p className="text-sm text-slate-500">Нет строк</p>
              ) : (
                summary.workUnits.map((u) => (
                  <article
                    key={`${u.kind}-${u.id}`}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{u.title}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(u.occurredAt)}
                          {u.clientName ? ` · ${u.clientName}` : ''}
                        </p>
                      </div>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {u.kind}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>
                        {u.kind === 'SHIFT'
                          ? `${u.quantity} ч`
                          : `×${u.quantity}`}
                      </span>
                      {u.kind === 'SHIFT' && u.priceMinor != null && (
                        <span className="text-emerald-400">
                          {money(u.priceMinor, summary.currency)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <i
                          className={`h-2 w-2 rounded-full ${bandDot(u.trustBand)}`}
                        />
                        {u.trustBand}
                      </span>
                      {u.isComplimentary && (
                        <span className="text-violet-300">подарок</span>
                      )}
                      <span
                        className={
                          u.payrollTrusted && !u.isComplimentary
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                        }
                      >
                        {u.isComplimentary
                          ? 'в счёт'
                          : u.payrollTrusted
                            ? 'в ЗП'
                            : 'не в ЗП'}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-slate-800 md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Когда</th>
                    <th className="px-4 py-3">Вид</th>
                    <th className="px-4 py-3">Услуга</th>
                    <th className="px-4 py-3">Кол-во</th>
                    <th className="px-4 py-3">Trust</th>
                    <th className="px-4 py-3">В ЗП</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.workUnits.map((u) => (
                    <tr
                      key={`${u.kind}-${u.id}`}
                      className="border-t border-slate-900/80"
                    >
                      <td className="px-4 py-2.5 text-slate-400">
                        {formatDateTime(u.occurredAt)}
                      </td>
                      <td className="px-4 py-2.5">{u.kind}</td>
                      <td className="px-4 py-2.5">
                        {u.title}
                        {u.isComplimentary ? (
                          <span className="ml-1 text-violet-300">· подарок</span>
                        ) : null}
                        {u.clientName ? (
                          <span className="text-slate-500"> · {u.clientName}</span>
                        ) : null}
                        {u.kind === 'SHIFT' && u.priceMinor != null ? (
                          <span className="ml-1 text-emerald-400">
                            · {money(u.priceMinor, summary.currency)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.kind === 'SHIFT' ? `${u.quantity} ч` : u.quantity}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <i
                            className={`h-2 w-2 rounded-full ${bandDot(u.trustBand)}`}
                          />
                          {u.trustBand}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.isComplimentary ? (
                          <span className="text-violet-300">счёт</span>
                        ) : u.payrollTrusted ? (
                          <span className="text-emerald-400">да</span>
                        ) : (
                          <span className="text-slate-600">нет</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!summary && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-12 text-center">
          <p className="text-sm text-slate-400">
            Выберите сотрудника и период
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Затем нажмите «Рассчитать»
          </p>
        </div>
      )}

      {printOpen && summary && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onMouseDown={() => setPrintOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">
              Расчётный лист
            </h2>
            <p className="text-xs text-slate-400">
              Выберите поля для текстового документа
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-emerald-300"
                onClick={() => refreshPreview(DEFAULT_PAYSLIP)}
              >
                Выбрать все
              </button>
              <button
                type="button"
                className="rounded-lg bg-white/5 px-2.5 py-1 text-slate-400"
                onClick={() =>
                  refreshPreview({
                    fio: false,
                    period: false,
                    motivation: false,
                    bonus: false,
                    fine: false,
                    totals: false,
                    shifts: false,
                  })
                }
              >
                Снять все
              </button>
            </div>
            <div className="space-y-2 text-sm text-slate-200">
              {(
                [
                  ['fio', 'ФИО'],
                  ['period', 'Период'],
                  ['motivation', 'Данные из мотивации'],
                  ['bonus', 'Премия'],
                  ['fine', 'Штраф'],
                  ['shifts', 'Смены / часы'],
                  ['totals', 'Итого'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printFields[key]}
                    onChange={(e) =>
                      refreshPreview({
                        ...printFields,
                        [key]: e.target.checked,
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Предпросмотр
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
                {docPreview || 'Отметьте хотя бы одно поле'}
              </pre>
              {summary && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Имя файла:{' '}
                  <span className="text-slate-400">
                    {payslipFilename(
                      summary.performerName,
                      summary.from,
                      summary.to,
                    )}
                  </span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!docPreview.trim()}
                onClick={printPayslipDoc}
              >
                Печать
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={!docPreview.trim()}
                onClick={savePayslipFile}
              >
                Сохранить как…
              </button>
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() => setPrintOpen(false)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 md:p-4 ${
        emphasize
          ? 'border-fitgo-500/40 bg-fitgo-500/10'
          : 'border-slate-800 bg-slate-950/50'
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
        {label}
      </p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          emphasize
            ? 'text-lg text-fitgo-300 md:text-xl'
            : 'text-base text-white md:text-lg'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
