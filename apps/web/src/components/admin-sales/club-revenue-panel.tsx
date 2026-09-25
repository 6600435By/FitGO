'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClubRevenueDetailResponse,
  ClubRevenueLineDto,
  ClubRevenuePaymentMethod,
  ClubRevenueReportResponse,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function money(minor: number): string {
  return (minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthBounds(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function paymentLabel(m: ClubRevenuePaymentMethod | string): string {
  switch (m) {
    case 'cash':
      return 'Наличные';
    case 'card':
      return 'Карта';
    case 'cashless':
      return 'Безнал';
    case 'personalAccount':
      return 'Лицевой счёт';
    case 'mixed':
      return 'Смешанная';
    default:
      return 'Не указан';
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const OPERATION_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'payment', label: 'Оплаты' },
  { id: 'unpaid', label: 'Долг' },
  { id: 'refund', label: 'Возвраты' },
  { id: 'personal_deposit', label: 'Взносы на ЛС' },
  { id: 'personal_credit', label: 'Прочие поступления' },
  { id: 'personal_burn', label: 'Сгорание ЛС' },
];

const PAYMENT_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все оплаты' },
  { id: 'cash', label: 'Наличные' },
  { id: 'card', label: 'Карта' },
  { id: 'cashless', label: 'Безнал' },
  { id: 'personalAccount', label: 'Лицевой счёт' },
  { id: 'mixed', label: 'Смешанная' },
];

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition ${
        active
          ? 'bg-fitgo-500/20 text-fitgo-300 ring-1 ring-fitgo-500/40'
          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCards({ data }: { data: ClubRevenueReportResponse }) {
  const s = data.summary;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="text-xs text-slate-500">
            Приход (по дате оплаты)
          </div>
          <div className="mt-1 text-xl font-semibold text-fitgo-300">
            {money(s.incomeMinor)}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-slate-400">
            <div>Оплаты: {money(s.paymentsMinor)}</div>
            <div>Взносы на ЛС: {money(s.depositsMinor)}</div>
            <div>Возвраты: −{money(s.refundsMinor)}</div>
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">
            Продажи (оформлены в периоде)
          </div>
          <div className="mt-1 text-xl font-semibold">{money(s.soldMinor)}</div>
          <div className="mt-2 space-y-0.5 text-xs text-slate-400">
            <div>Оплаты в периоде: {money(s.paymentsMinor)}</div>
            <div className="text-amber-300">
              Открытый долг на конец: {money(s.unpaidMinor)}
            </div>
            <div className="text-rose-300">Возвраты: {money(s.refundsMinor)}</div>
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">По виду оплаты</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Наличные</span>
              <span>{money(s.byPaymentMethod.cashMinor)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Карта</span>
              <span>{money(s.byPaymentMethod.cardMinor)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Безнал</span>
              <span>{money(s.byPaymentMethod.cashlessMinor)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Лицевой счёт</span>
              <span>{money(s.byPaymentMethod.personalAccountMinor)}</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Не в приходе</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Прочие поступления</span>
              <span>{money(s.personalCreditsMinor)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Сгорание ЛС</span>
              <span className="text-rose-300">
                −{money(s.personalBurnsMinor)}
              </span>
            </div>
            <p className="pt-2 text-xs text-slate-500">
              Начисление в абонементе и сгорание не увеличивают приход кассы.
              Взносы на ЛС входят в приход и в мотивацию.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({
  detail,
  onClose,
}: {
  detail: ClubRevenueDetailResponse;
  onClose: () => void;
}) {
  const line = detail.line;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Детали операции</h2>
            <p className="text-sm text-slate-400">{line.statusLabel}</p>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-slate-500">Клиент</dt>
            <dd>{line.clientName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Товар / услуга</dt>
            <dd>{line.productName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Сотрудник</dt>
            <dd>{line.employeeName ?? '—'}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-slate-500">Дата</dt>
              <dd>{fmtDate(line.occurredAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Оплата</dt>
              <dd>{fmtDate(line.paidAt)}</dd>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-slate-500">Продажа</dt>
              <dd>{money(line.saleAmountMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Оплачено</dt>
              <dd>{money(line.paidAmountMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Возврат</dt>
              <dd className="text-rose-300">{money(line.refundAmountMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Способ</dt>
              <dd>{paymentLabel(line.paymentMethod)}</dd>
            </div>
          </div>
          <div>
            <dt className="mb-1 text-slate-500">Разбивка оплаты</dt>
            <dd className="space-y-1 rounded-lg bg-slate-900 p-3">
              <div className="flex justify-between">
                <span>Наличные</span>
                <span>{money(line.split.cashMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Карта</span>
                <span>{money(line.split.cardMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Безнал</span>
                <span>{money(line.split.cashlessMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Лицевой счёт</span>
                <span>{money(line.split.personalAccountMinor)}</span>
              </div>
            </dd>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {line.countsTowardIncome ? (
              <span className="rounded-full bg-fitgo-500/15 px-2 py-1 text-fitgo-300">
                В приходе
              </span>
            ) : (
              <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-400">
                Не в приходе
              </span>
            )}
            {line.countsTowardMotivation ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">
                В мотивации
              </span>
            ) : null}
          </div>
        </dl>
        {detail.related.length > 0 ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-slate-300">
              Связанные строки документа
            </h3>
            <ul className="space-y-2 text-sm">
              {detail.related.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                >
                  <div className="font-medium">{r.statusLabel}</div>
                  <div className="text-slate-400">
                    {r.productName ?? '—'} · {money(r.amountMinor)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function amountForLine(line: ClubRevenueLineDto): number {
  if (line.operationType === 'personal_burn') return line.amountMinor;
  if (line.operationType === 'refund') return -Math.abs(line.refundAmountMinor || line.amountMinor);
  if (line.operationType === 'unpaid') return line.saleAmountMinor;
  if (line.paidAmountMinor) return line.paidAmountMinor;
  return line.amountMinor;
}

export function ClubRevenuePanel() {
  const bounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [operationType, setOperationType] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [employeeExternalId, setEmployeeExternalId] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<ClubRevenueReportResponse | null>(null);
  const [detail, setDetail] = useState<ClubRevenueDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.superAdminClubSales(token, {
        from,
        to,
        operationType,
        paymentMethod,
        employeeExternalId: employeeExternalId || undefined,
        q: q.trim() || undefined,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to, operationType, paymentMethod, employeeExternalId, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    const token = getToken();
    if (!token) return;
    try {
      const d = await api.superAdminClubSaleDetail(token, id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка деталей');
    }
  };

  const syncNow = async () => {
    const token = getToken();
    if (!token) return;
    setSyncMsg('Синхронизация…');
    try {
      const r = await api.superAdminSalesSync(token);
      const cr = r.clubRevenue;
      setSyncMsg(
        cr
          ? `Обновлено: ${cr.upserted} строк (${cr.from}…${cr.to})`
          : 'Синхронизация завершена',
      );
      await load();
    } catch (e) {
      setSyncMsg('');
      setError(e instanceof Error ? e.message : 'Ошибка синхронизации');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Продажи клуба</h1>
          <p className="text-sm text-slate-400">
            Как сводный отчёт 1С: оплаты и взносы на ЛС по виду денег, возвраты отдельно
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.lastSyncedAt ? (
            <span className="text-xs text-slate-500">
              Синк:{' '}
              {new Date(data.lastSyncedAt).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : null}
          <button type="button" className="btn-secondary text-sm" onClick={() => void syncNow()}>
            Обновить из 1С
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">С</span>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">По</span>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="min-w-[12rem] flex-1 text-sm">
          <span className="mb-1 block text-slate-400">Сотрудник</span>
          <select
            className="input"
            value={employeeExternalId}
            onChange={(e) => setEmployeeExternalId(e.target.value)}
          >
            <option value="">Все</option>
            {(data?.employees ?? []).map((e) => (
              <option key={e.employeeExternalId} value={e.employeeExternalId}>
                {e.employeeName}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-sm">
          <span className="mb-1 block text-slate-400">Поиск</span>
          <input
            className="input"
            placeholder="Клиент или товар"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {OPERATION_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={operationType === c.id}
            onClick={() => setOperationType(c.id)}
          >
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {PAYMENT_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={paymentMethod === c.id}
            onClick={() => setPaymentMethod(c.id)}
          >
            {c.label}
          </Chip>
        ))}
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {syncMsg ? <p className="text-sm text-slate-400">{syncMsg}</p> : null}
      {loading && !data ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : null}
      {data?.hint ? <p className="text-sm text-amber-300/90">{data.hint}</p> : null}

      {data ? <SummaryCards data={data} /> : null}

      {data ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900/80 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Дата</th>
                <th className="px-3 py-2 font-medium">Клиент</th>
                <th className="px-3 py-2 font-medium">Операция</th>
                <th className="px-3 py-2 font-medium">Товар</th>
                <th className="px-3 py-2 font-medium">Сотрудник</th>
                <th className="px-3 py-2 font-medium">Оплата</th>
                <th className="px-3 py-2 font-medium text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Нет строк за период
                  </td>
                </tr>
              ) : (
                data.lines.map((line) => {
                  const amt = amountForLine(line);
                  return (
                    <tr
                      key={line.id}
                      className="cursor-pointer border-t border-slate-800/80 hover:bg-slate-900/60"
                      onClick={() => void openDetail(line.id)}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {fmtDate(line.occurredAt)}
                      </td>
                      <td className="px-3 py-2">{line.clientName ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            line.operationType === 'unpaid'
                              ? 'text-amber-300'
                              : line.operationType === 'refund' ||
                                  line.operationType === 'personal_burn'
                                ? 'text-rose-300'
                                : ''
                          }
                        >
                          {line.statusLabel}
                        </span>
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-slate-300">
                        {line.productName ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {line.employeeName ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {paymentLabel(line.paymentMethod)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          amt < 0 ? 'text-rose-300' : ''
                        }`}
                      >
                        {money(amt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <DetailPanel detail={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}
