'use client';

import type {
  MembershipClientRow,
  MembershipClientsReport,
  MembershipUtilizationSegment,
} from '@fitgo/shared-types';
import { SEGMENT_LABEL, money } from './format';

export function ClientsTab({
  report,
  segment,
  onSegment,
  onOpenProduct,
  onPage,
}: {
  report: MembershipClientsReport;
  segment: MembershipUtilizationSegment | 'ALL';
  onSegment: (s: MembershipUtilizationSegment | 'ALL') => void;
  onOpenProduct?: (productExternalId: string) => void;
  onPage?: (page: number) => void;
}) {
  const currency = report.currency;
  const allCount = Object.values(report.bySegment).reduce((a, b) => a + b, 0);
  const pageCount = Math.max(1, Math.ceil(report.total / report.pageSize));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SegChip
          active={segment === 'ALL'}
          onClick={() => onSegment('ALL')}
          label={`Все (${allCount})`}
        />
        {(Object.keys(SEGMENT_LABEL) as MembershipUtilizationSegment[]).map(
          (s) => (
            <SegChip
              key={s}
              active={segment === s}
              onClick={() => onSegment(s)}
              label={`${SEGMENT_LABEL[s]} (${report.bySegment[s]})`}
            />
          ),
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Клиент</th>
              <th className="py-1 pr-2">Абонемент</th>
              <th className="py-1 pr-2">Скидка</th>
              <th className="py-1 pr-2">Сегмент</th>
              <th className="py-1 pr-2">ГП</th>
              <th className="py-1 pr-2">ГП/мес</th>
              <th className="py-1 pr-2">Зал</th>
              <th className="py-1 pr-2">ПТ</th>
              <th className="py-1 pr-2">Массаж</th>
              <th className="py-1 pr-2">ЛС сгорело</th>
              <th className="py-1 pr-2">Маржа</th>
              <th className="py-1 pr-2">До</th>
              <th className="py-1">Действие</th>
            </tr>
          </thead>
          <tbody>
            {report.clients.map((c) => (
              <ClientRow
                key={clientRowKey(c)}
                c={c}
                currency={currency}
                onOpenProduct={onOpenProduct}
              />
            ))}
          </tbody>
        </table>
        {!report.clients.length && (
          <p className="py-4 text-center text-sm text-slate-500">
            Нет клиентов в этом сегменте
          </p>
        )}
      </div>
      {report.total > report.pageSize && onPage && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            {report.total} записей · стр. {report.page} / {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={report.page <= 1}
              onClick={() => onPage(report.page - 1)}
            >
              Назад
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={report.page >= pageCount}
              onClick={() => onPage(report.page + 1)}
            >
              Далее
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function clientRowKey(c: MembershipClientRow): string {
  return [
    c.clientExternalId,
    c.productExternalId ?? c.productName,
    c.packageDocId ?? '',
    c.startDate ?? '',
    String(c.paidMinor),
  ].join('|');
}

function ClientRow({
  c,
  currency,
  onOpenProduct,
}: {
  c: MembershipClientRow;
  currency: string;
  onOpenProduct?: (productExternalId: string) => void;
}) {
  return (
    <tr className="border-t border-slate-800">
      <td className="py-1.5 pr-2">
        {c.clientName}
        {c.priceEstimated && (
          <span className="ml-1 text-[10px] text-amber-400" title="Цена оценена">
            ~
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <div>{c.productName || c.familyLabel}</div>
        <div className="text-[10px] text-slate-500">
          {c.familyLabel}
          {c.productExternalId && (
            <>
              {' · '}
              {onOpenProduct ? (
                <button
                  type="button"
                  className="text-fitgo-400 hover:underline"
                  onClick={() => onOpenProduct(c.productExternalId as string)}
                >
                  карточка
                </button>
              ) : (
                c.productExternalId
              )}
            </>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-2 text-xs text-slate-400">
        {c.discountName
          ? `${c.discountName}${
              c.discountAmountMinor > 0
                ? ` (−${money(c.discountAmountMinor, currency)})`
                : ''
            }`
          : '—'}
      </td>
      <td className="py-1.5 pr-2">{SEGMENT_LABEL[c.segment]}</td>
      <td className="py-1.5 pr-2">{c.gpVisits}</td>
      <td className="py-1.5 pr-2">{c.gpPerMonth}</td>
      <td className="py-1.5 pr-2">{c.gymVisits}</td>
      <td className="py-1.5 pr-2">
        {c.ptUsed}/{c.ptQuota}
      </td>
      <td className="py-1.5 pr-2">
        {c.massageUsed}/{c.massageQuota}
      </td>
      <td className="py-1.5 pr-2">
        {money(c.personalAccountBurnedMinor, currency)}
      </td>
      <td
        className={`py-1.5 pr-2 ${c.marginMinor < 0 ? 'text-rose-400' : ''}`}
      >
        {money(c.marginMinor, currency)}
      </td>
      <td className="py-1.5 pr-2">{c.endDate ?? '—'}</td>
      <td className="py-1.5">
        {c.segment === 'sleeping' && c.endsWithin30d ? (
          <a
            className="text-xs text-fitgo-400 hover:underline"
            href={`/super-admin/tasks?clientExternalId=${encodeURIComponent(c.clientExternalId)}`}
            title="Создать задачу на удержание"
          >
            Удержание
          </a>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

function SegChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs ${
        active ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}
