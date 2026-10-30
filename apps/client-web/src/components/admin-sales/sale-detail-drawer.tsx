'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClubRevenueDetailResponse,
  ClubRevenuePaymentMethod,
} from '@fitgo/shared-types';
import {
  ManagerReworkSheet,
  type ManagerReworkAssignee,
  type ManagerReworkTargetOption,
} from '@/components/manager-rework/manager-rework-sheet';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const SYSTEM_EMPLOYEE_ID = '__1c__';

function employeeLabel(name: string | null | undefined, id?: string | null): string {
  if (id === SYSTEM_EMPLOYEE_ID || name === '1С') return '1С';
  if (name?.trim()) return name.trim();
  return '1С';
}

function money(minor: number): string {
  return (minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

const CLUB_TZ = 'Europe/Minsk';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: CLUB_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type OpenTask = {
  id: string;
  title: string;
  dueAt?: string;
  assignee?: { id: string; firstName: string; lastName: string };
};

type Props = {
  detail: ClubRevenueDetailResponse;
  onClose: () => void;
  /** Manager / SA: enable «На доработку» sheet. */
  canRework?: boolean;
};

/** Side drawer with ClubRevenue sale / payment details. */
export function SaleDetailDrawer({ detail, onClose, canRework = false }: Props) {
  const line = detail.line;
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkBusy, setReworkBusy] = useState(false);
  const [assignees, setAssignees] = useState<ManagerReworkAssignee[]>([]);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [message, setMessage] = useState('');

  const loadTasks = useCallback(async () => {
    if (!canRework) return;
    const token = getToken();
    if (!token) return;
    try {
      setOpenTasks(await api.superAdminClubSaleReworkTasks(token, line.id));
    } catch {
      setOpenTasks([]);
    }
  }, [canRework, line.id]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const targets: ManagerReworkTargetOption[] = useMemo(() => {
    const performer = assignees.find(
      (a) =>
        line.performerExternalId &&
        (a.externalId === line.performerExternalId ||
          a.id === line.performerExternalId),
    );
    const admin = assignees.find(
      (a) =>
        line.employeeExternalId &&
        a.externalId === line.employeeExternalId &&
        (a.roles ?? []).some((r) => r === 'ADMIN' || r === 'MANAGER'),
    );
    return [
      {
        id: 'performer',
        label: 'Исполнителю',
        presetAssigneeId: performer?.id ?? null,
        needsAssignee: !performer,
        roleFilter: ['TRAINER', 'SPECIALIST'],
        hint: performer
          ? performer.name
          : line.performerName
            ? `${line.performerName} — выберите в FitGO`
            : 'Выберите тренера / специалиста',
      },
      {
        id: 'admin',
        label: 'Администратору',
        presetAssigneeId: admin?.id ?? null,
        needsAssignee: !admin,
        roleFilter: ['ADMIN', 'MANAGER'],
        hint: admin
          ? admin.name
          : line.employeeName
            ? `${line.employeeName} — выберите в FitGO`
            : 'Выберите администратора',
      },
      {
        id: 'staff',
        label: 'Другому сотруднику',
        needsAssignee: true,
        hint: 'Задача от руководителя',
      },
    ];
  }, [assignees, line]);

  const openRework = async () => {
    setMessage('');
    setReworkOpen(true);
    if (assignees.length === 0) {
      const token = getToken();
      if (!token) return;
      try {
        setAssignees(await api.superAdminSalesReworkAssignees(token));
      } catch {
        /* empty list */
      }
    }
  };

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
          {(detail.basisProducts?.length ?? 0) > 0 ? (
            <div>
              <dt className="mb-1 text-slate-500">
                Номенклатура (за что оплата)
              </dt>
              <dd>
                <ul className="space-y-1 rounded-lg bg-slate-900 p-3">
                  {detail.basisProducts!.map((b, i) => (
                    <li
                      key={`${b.productName}-${i}`}
                      className="flex justify-between gap-2"
                    >
                      <span>{b.productName}</span>
                      <span className="shrink-0 text-slate-400">
                        {money(b.amountMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-slate-500">Сотрудник</dt>
            <dd>{employeeLabel(line.employeeName, line.employeeExternalId)}</dd>
          </div>
          {line.performerName?.trim() || line.performerExternalId?.trim() ? (
            <div>
              <dt className="text-slate-500">Исполнитель</dt>
              <dd>
                {employeeLabel(line.performerName, line.performerExternalId)}
              </dd>
            </div>
          ) : null}
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

        {canRework ? (
          <div className="mt-6 space-y-3 border-t border-slate-800 pt-4">
            {openTasks.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400">
                  Открытые задачи по операции
                </p>
                <ul className="space-y-1 text-sm">
                  {openTasks.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                    >
                      <div className="font-medium text-amber-100">{t.title}</div>
                      <div className="text-xs text-slate-400">
                        {t.assignee
                          ? `${t.assignee.firstName} ${t.assignee.lastName}`
                          : 'Без исполнителя'}
                        {t.dueAt
                          ? ` · до ${new Date(t.dueAt).toLocaleString('ru-RU', {
                              timeZone: CLUB_TZ,
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {message ? (
              <p className="text-xs text-fitgo-300">{message}</p>
            ) : null}
            <button
              type="button"
              className="btn-secondary w-full text-sm"
              onClick={() => void openRework()}
              disabled={reworkBusy}
            >
              На доработку
            </button>
          </div>
        ) : null}
      </aside>

      <ManagerReworkSheet
        open={reworkOpen}
        title="На доработку"
        subtitle={line.productName ?? line.clientName ?? undefined}
        targets={targets}
        assignees={assignees}
        busy={reworkBusy}
        onClose={() => setReworkOpen(false)}
        onSubmit={async (input) => {
          const token = getToken();
          if (!token) throw new Error('Нет сессии');
          const target =
            input.targetId === 'performer' || input.targetId === 'admin'
              ? input.targetId
              : 'staff';
          setReworkBusy(true);
          try {
            const result = await api.superAdminClubSaleRework(token, line.id, {
              target,
              assigneeId: input.assigneeId,
              comment: input.comment,
              dueAt: input.dueAt,
            });
            setReworkOpen(false);
            setMessage(`Задача: ${result.task.title}`);
            await loadTasks();
          } finally {
            setReworkBusy(false);
          }
        }}
      />
    </div>
  );
}
