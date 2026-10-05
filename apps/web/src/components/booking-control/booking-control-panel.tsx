'use client';

import {
  paymentLabelRu,
  payTagLabelRu,
  type BookingControlDetail,
  type BookingControlKind,
  type BookingControlListItem,
  type BookingControlStatus,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/utils';

export type BookingControlApi = {
  list: (params: {
    from: string;
    to: string;
    kind?: string;
    status?: string;
    needsReview?: boolean;
    payment?: string;
    performerId?: string;
  }) => Promise<BookingControlListItem[]>;
  detail: (sessionKey: string) => Promise<BookingControlDetail>;
  openRemark: (
    sessionKey: string,
    comment: string,
  ) => Promise<unknown>;
  resolveRemark?: (
    sessionKey: string,
    adminComment: string,
  ) => Promise<unknown>;
  /** Pull Документ.Занятие for selected period from 1C. */
  refreshFrom1c?: (from: string, to: string) => Promise<{ message: string }>;
  /** Mark GROUP member arrived / no-show in 1C. */
  setAttendance?: (
    sessionKey: string,
    clientExternalId: string,
    attendance: 'ATTENDED' | 'NO_SHOW',
  ) => Promise<BookingControlDetail>;
  /** Trainer: FitGO checkmarks for who was present. */
  saveTrainerSeen?: (
    sessionKey: string,
    seenClientIds: string[],
  ) => Promise<BookingControlDetail>;
  /** Trainer / admin / SA: confirm GROUP for payroll chain. */
  approveGroup?: (
    sessionKey: string,
    comment?: string,
  ) => Promise<BookingControlDetail>;
  /** Admin / SA: return GROUP to trainer. */
  returnGroupApproval?: (
    sessionKey: string,
    comment?: string,
  ) => Promise<BookingControlDetail>;
  /** Manager / super-admin: confirm many unapproved GROUP sessions. */
  bulkApproveGroups?: (body: {
    from: string;
    to: string;
    role: 'trainer' | 'admin';
    sessionKeys: string[];
  }) => Promise<{ confirmed: number; skipped: number }>;
  /** Admin/manager/SA/trainer: hall NVR photos for GROUP. */
  listHallSnapshots?: (
    sessionKey: string,
  ) => Promise<import('@fitgo/shared-types').HallClassSnapshotItem[]>;
  /** Returns object URL for JPEG (caller must revoke). */
  loadHallSnapshotImage?: (snapshotId: string) => Promise<string>;
};

type Props = {
  api: BookingControlApi;
  /** Admin can resolve remarks */
  canResolve?: boolean;
  /** Admin/manager/SA: mark GROUP attendance and refresh from 1C */
  canMarkAttendance?: boolean;
  /** Trainer: checkboxes for who was present */
  canTrainerSeen?: boolean;
  /** Confirm GROUP (trainer / admin / SA) */
  canApproveGroup?: boolean;
  /** Admin/SA: return to trainer */
  canReturnApproval?: boolean;
  /** Manager / super-admin: bulk confirm unapproved GROUP in the period */
  canBulkApprove?: boolean;
  /** Admin/manager/SA/trainer: show Photo button on GROUP detail */
  canViewHallPhotos?: boolean;
  /** Open this session on mount (e.g. from admin tasks). */
  initialSessionKey?: string;
  /** Optional date range from deep-link (schedule → booking-control). */
  initialFrom?: string;
  initialTo?: string;
  /** Hide kind filter (specialist SPA-only) */
  fixedKind?: BookingControlKind;
  title?: string;
  subtitle?: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusRu(s: BookingControlStatus) {
  if (s === 'COMPLETED') return 'Выполнено';
  if (s === 'CANCELLED') return 'Отменено';
  return 'Запланировано';
}

function kindRu(k: BookingControlKind) {
  if (k === 'GROUP') return 'ГП';
  if (k === 'PT') return 'ПТ';
  if (k === 'SOLARIUM') return 'Соляр.';
  return 'SPA';
}

function attendanceOf(item: BookingControlListItem) {
  const booked = item.bookedCount ?? item.attendeeCount ?? 0;
  const arrived = item.arrivedCount ?? item.attendeeCount ?? 0;
  const noShow =
    item.noShowCount ?? Math.max(0, booked - arrived);
  return { booked, arrived, noShow };
}

function paymentCell(item: BookingControlListItem): string {
  if (item.kind === 'GROUP') return '—';
  const parts: string[] = [];
  if (item.source === 'SALE' || item.payTag === 'SALE') {
    parts.push('продажа');
  } else if (item.payTag === 'PACKAGE') {
    parts.push('абонемент');
  }
  if (item.payment && item.payment !== 'N_A' && item.payment !== 'UNKNOWN') {
    parts.push(paymentLabelRu(item.payment));
  }
  if (item.priceMinor != null && item.priceMinor > 0) {
    parts.push(`${(item.priceMinor / 100).toFixed(2)}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

export function BookingControlPanel({
  api,
  canResolve = false,
  canMarkAttendance = false,
  canTrainerSeen = false,
  canApproveGroup = false,
  canReturnApproval = false,
  canBulkApprove = false,
  canViewHallPhotos = false,
  initialSessionKey,
  initialFrom,
  initialTo,
  fixedKind,
  title = 'Контроль занятий',
  subtitle = 'Занятия из 1С и разовые ПТ из продаж. Запись FitGO без 1С — в ЗП не идёт.',
}: Props) {
  const [from, setFrom] = useState(initialFrom?.trim() || daysAgoIso(7));
  const [to, setTo] = useState(initialTo?.trim() || todayIso());
  const [kind, setKind] = useState<string>(fixedKind ?? 'ALL');
  const [status, setStatus] = useState('ALL');
  const [payment, setPayment] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'SALE' | '1C'>('ALL');
  const [needsReview, setNeedsReview] = useState(false);
  const [items, setItems] = useState<BookingControlListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing1c, setSyncing1c] = useState(false);
  const [attendanceBusyId, setAttendanceBusyId] = useState<string | null>(null);
  const [seenBusy, setSeenBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [bulkRole, setBulkRole] = useState<'trainer' | 'admin'>('admin');
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingGroupsOpen, setPendingGroupsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<BookingControlDetail | null>(null);
  const [comment, setComment] = useState('');
  const [adminComment, setAdminComment] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photos, setPhotos] = useState<
    import('@fitgo/shared-types').HallClassSnapshotItem[]
  >([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photosError, setPhotosError] = useState('');
  const [localSeen, setLocalSeen] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setMessage('');
    api
      .list({
        from,
        to,
        kind: fixedKind ?? kind,
        status,
        payment,
        needsReview,
      })
      .then(setItems)
      .catch((e) =>
        setMessage(e instanceof Error ? e.message : 'Ошибка загрузки'),
      )
      .finally(() => setLoading(false));
  }, [api, from, to, kind, status, payment, needsReview, fixedKind]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!initialSessionKey) return;
    void openDetail(initialSessionKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once from URL
  }, [initialSessionKey]);

  const visible = useMemo(() => {
    if (sourceFilter === 'ALL') return items;
    if (sourceFilter === 'SALE') {
      return items.filter(
        (i) => i.source === 'SALE' || i.payTag === 'SALE',
      );
    }
    return items.filter((i) => i.source !== 'SALE');
  }, [items, sourceFilter]);

  const saleCount = useMemo(
    () => items.filter((i) => i.source === 'SALE').length,
    [items],
  );

  const pendingGroups = useMemo(
    () =>
      items.filter(
        (i) =>
          i.kind === 'GROUP' &&
          i.source === '1C' &&
          i.status !== 'CANCELLED' &&
          (i.approvalPhase === 'PENDING_TRAINER' ||
            i.approvalPhase === 'PENDING_ADMIN'),
      ),
    [items],
  );
  const pendingKey = pendingGroups.map((i) => i.sessionKey).join('|');

  useEffect(() => {
    setBulkSelected(new Set(pendingKey ? pendingKey.split('|') : []));
  }, [pendingKey]);

  const openDetail = async (sessionKey: string) => {
    setComment('');
    setAdminComment('');
    setHistoryOpen(false);
    closePhotos();
    const listItem = items.find((i) => i.sessionKey === sessionKey);

    // ПТ продажа: show modal immediately from list row (avoid hang on 1C re-fetch).
    if (listItem?.source === 'SALE') {
      const payment = listItem.payment;
      setSelected({
        ...listItem,
        members: [
          {
            externalId: listItem.number || listItem.sessionKey,
            clientName: listItem.clientName || '—',
            attendance:
              payment === 'PAID' || payment === 'QUOTA' ? 'ATTENDED' : 'EXPECTED',
            payment,
          },
        ],
        remark: null,
        remarksHistory: [],
        crmDocRef: listItem.number,
      });
      setLocalSeen(new Set());
      setDetailLoading(false);
      try {
        const d = await api.detail(sessionKey);
        setSelected(d);
      } catch (e) {
        // Keep provisional detail; only surface error if we have nothing useful.
        if (!listItem.title) {
          setMessage(e instanceof Error ? e.message : 'Ошибка');
        }
      }
      return;
    }

    setDetailLoading(true);
    setSelected(null);
    try {
      const d = await api.detail(sessionKey);
      setSelected(d);
      const seen = new Set(
        d.groupApproval?.trainerSeenClientIds ??
          d.members.filter((m) => m.trainerSeen).map((m) => m.externalId),
      );
      setLocalSeen(seen);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closePhotos = () => {
    setPhotosOpen(false);
    setPhotos([]);
    setPhotosError('');
    setPhotoUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      return {};
    });
  };

  const openPhotos = async () => {
    if (!selected || !api.listHallSnapshots) return;
    setPhotosOpen(true);
    setPhotosLoading(true);
    setPhotosError('');
    setPhotoUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      return {};
    });
    try {
      const list = await api.listHallSnapshots(selected.sessionKey);
      setPhotos(list);
      if (api.loadHallSnapshotImage) {
        const urls: Record<string, string> = {};
        for (const snap of list) {
          if (snap.status !== 'CAPTURED') continue;
          try {
            urls[snap.id] = await api.loadHallSnapshotImage(snap.id);
          } catch {
            /* show status without image */
          }
        }
        setPhotoUrls(urls);
      }
    } catch (e) {
      setPhotosError(e instanceof Error ? e.message : 'Ошибка загрузки фото');
    } finally {
      setPhotosLoading(false);
    }
  };

  const submitRemark = async () => {
    if (!selected || !comment.trim()) return;
    try {
      await api.openRemark(selected.sessionKey, comment.trim());
      setMessage('Замечание отправлено — занятие на проверке');
      setComment('');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const resolve = async () => {
    if (!selected || !api.resolveRemark || !adminComment.trim()) return;
    try {
      await api.resolveRemark(selected.sessionKey, adminComment.trim());
      setMessage('Замечание отработано');
      setAdminComment('');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const refreshFrom1c = async () => {
    if (!api.refreshFrom1c) return;
    setSyncing1c(true);
    setMessage('');
    try {
      const res = await api.refreshFrom1c(from, to);
      setMessage(res.message);
      load();
      if (selected) {
        await openDetail(selected.sessionKey);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка обновления из 1С');
    } finally {
      setSyncing1c(false);
    }
  };

  const markAttendance = async (
    clientExternalId: string,
    attendance: 'ATTENDED' | 'NO_SHOW',
  ) => {
    if (!selected || !api.setAttendance) return;
    setAttendanceBusyId(clientExternalId);
    setMessage('');
    try {
      const updated = await api.setAttendance(
        selected.sessionKey,
        clientExternalId,
        attendance,
      );
      setSelected(updated);
      setMessage(
        attendance === 'ATTENDED'
          ? 'Отмечено: Прибыл (сохранено в 1С)'
          : 'Отмечено: Не прибыл (сохранено в 1С)',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка записи явки');
    } finally {
      setAttendanceBusyId(null);
    }
  };

  const toggleTrainerSeen = async (clientExternalId: string) => {
    if (!selected || !api.saveTrainerSeen || selected.groupApproval?.locked) {
      return;
    }
    const next = new Set(localSeen);
    if (next.has(clientExternalId)) next.delete(clientExternalId);
    else next.add(clientExternalId);
    setLocalSeen(next);
    setSeenBusy(true);
    setMessage('');
    try {
      const updated = await api.saveTrainerSeen(
        selected.sessionKey,
        [...next],
      );
      setSelected(updated);
      setLocalSeen(new Set(updated.groupApproval?.trainerSeenClientIds ?? []));
      load();
    } catch (e) {
      setLocalSeen(
        new Set(selected.groupApproval?.trainerSeenClientIds ?? []),
      );
      setMessage(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSeenBusy(false);
    }
  };

  const approveGroup = async () => {
    if (!selected || !api.approveGroup) return;
    setApproveBusy(true);
    setMessage('');
    try {
      const updated = await api.approveGroup(
        selected.sessionKey,
        comment.trim() || undefined,
      );
      setSelected(updated);
      setComment('');
      setMessage(
        updated.groupApproval?.phase === 'APPROVED'
          ? 'Подтверждено — занятие в ЗП'
          : 'Подтверждено тренером — ждёт администратора',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка подтверждения');
    } finally {
      setApproveBusy(false);
    }
  };

  const returnApproval = async () => {
    if (!selected || !api.returnGroupApproval) return;
    setApproveBusy(true);
    setMessage('');
    try {
      const updated = await api.returnGroupApproval(
        selected.sessionKey,
        comment.trim() || undefined,
      );
      setSelected(updated);
      setLocalSeen(
        new Set(updated.groupApproval?.trainerSeenClientIds ?? []),
      );
      setComment('');
      setMessage('Отправлено на доработку тренеру');
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка возврата');
    } finally {
      setApproveBusy(false);
    }
  };

  const setToday = () => {
    const d = todayIso();
    setFrom(d);
    setTo(d);
  };

  const toggleBulk = (sessionKey: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionKey)) next.delete(sessionKey);
      else next.add(sessionKey);
      return next;
    });
  };

  const confirmBulk = async () => {
    if (!api.bulkApproveGroups) return;
    const sessionKeys = pendingGroups
      .map((i) => i.sessionKey)
      .filter((k) => bulkSelected.has(k));
    if (!sessionKeys.length) return;
    setBulkBusy(true);
    setMessage('');
    try {
      const res = await api.bulkApproveGroups({
        from,
        to,
        role: bulkRole,
        sessionKeys,
      });
      setMessage(
        `Подтверждено ${res.confirmed}` +
          (res.skipped ? `, пропущено ${res.skipped}` : '') +
          '. Занятия идут в расчёт ЗП.',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка массового подтверждения');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="btn-primary px-3 py-2 text-sm"
            onClick={setToday}
          >
            Сегодня
          </button>
          <label className="text-[11px] text-slate-500">
            С
            <input
              type="date"
              className="input mt-0.5 block h-9 py-1 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-[11px] text-slate-500">
            По
            <input
              type="date"
              className="input mt-0.5 block h-9 py-1 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {!fixedKind && (
            <label className="text-[11px] text-slate-500">
              Вид
              <select
                className="input mt-0.5 block h-9 py-1 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="ALL">Все</option>
                <option value="GROUP">ГП</option>
                <option value="PT">ПТ</option>
                <option value="SPA">SPA</option>
                <option value="SOLARIUM">Солярий</option>
              </select>
            </label>
          )}
          <label className="text-[11px] text-slate-500">
            Статус
            <select
              className="input mt-0.5 block h-9 py-1 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ALL">Все</option>
              <option value="SCHEDULED">Запланировано</option>
              <option value="COMPLETED">Выполнено</option>
              <option value="CANCELLED">Отменено</option>
            </select>
          </label>
          {(kind === 'PT' ||
            kind === 'SPA' ||
            kind === 'SOLARIUM' ||
            kind === 'ALL' ||
            fixedKind) && (
            <label className="text-[11px] text-slate-500">
              Оплата
              <select
                className="input mt-0.5 block h-9 py-1 text-sm"
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                <option value="ALL">Все</option>
                <option value="PAID">Оплачено</option>
                <option value="DEBT">Нет оплаты</option>
              </select>
            </label>
          )}
          {!fixedKind && (
            <label className="text-[11px] text-slate-500">
              Источник
              <select
                className="input mt-0.5 block h-9 py-1 text-sm"
                value={sourceFilter}
                onChange={(e) =>
                  setSourceFilter(e.target.value as 'ALL' | 'SALE' | '1C')
                }
              >
                <option value="ALL">Все</option>
                <option value="1C">Занятия 1С</option>
                <option value="SALE">
                  Продажи ПТ{saleCount ? ` (${saleCount})` : ''}
                </option>
              </select>
            </label>
          )}
          <label className="mb-1 flex h-9 items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={needsReview}
              onChange={(e) => setNeedsReview(e.target.checked)}
            />
            На проверке
          </label>
          <button
            type="button"
            className="btn-secondary h-9 px-3 text-sm"
            onClick={load}
          >
            Обновить
          </button>
          {canMarkAttendance && api.refreshFrom1c ? (
            <button
              type="button"
              className="btn-primary h-9 px-3 text-sm"
              onClick={refreshFrom1c}
              disabled={syncing1c || loading}
            >
              {syncing1c ? 'Обновляем 1С…' : 'Обновить из 1С'}
            </button>
          ) : null}
        </div>
      </div>

      {canBulkApprove && api.bulkApproveGroups ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={pendingGroupsOpen}
            onClick={() => setPendingGroupsOpen((v) => !v)}
          >
            <span className="text-sm font-medium text-white">
              Неподтверждённые ГП за период
              {pendingGroups.length ? ` · ${pendingGroups.length}` : ''}
            </span>
            <span className="shrink-0 text-xs text-slate-500">
              {pendingGroupsOpen ? '▾' : '▸'}
            </span>
          </button>
          {pendingGroupsOpen ? (
            <>
              <p className="text-xs text-slate-500">
                Выполненные занятия без подтверждения. Отметка тренером или админом
                сразу включает их в расчёт ЗП.
              </p>
              {pendingGroups.length === 0 ? (
                <p className="text-sm text-slate-400">Нет таких занятий</p>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={
                        pendingGroups.length > 0 &&
                        pendingGroups.every((i) =>
                          bulkSelected.has(i.sessionKey),
                        )
                      }
                      onChange={(e) => {
                        setBulkSelected(
                          e.target.checked
                            ? new Set(pendingGroups.map((i) => i.sessionKey))
                            : new Set(),
                        );
                      }}
                    />
                    Выбрать все
                  </label>
                  <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 text-sm">
                    {pendingGroups.map((item) => (
                      <li
                        key={item.sessionKey}
                        className="flex items-center gap-2 border-b border-slate-900 px-2 py-1.5 last:border-0"
                      >
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(item.sessionKey)}
                          onChange={() => toggleBulk(item.sessionKey)}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-slate-200"
                          onClick={() => openDetail(item.sessionKey)}
                        >
                          {formatDateTime(item.startAt)} · {item.title}
                          {item.performerName
                            ? ` · ${item.performerName}`
                            : ''}
                        </button>
                        <span className="shrink-0 text-[11px] text-amber-300">
                          {item.approvalLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="bulk-role"
                        checked={bulkRole === 'trainer'}
                        onChange={() => setBulkRole('trainer')}
                      />
                      Подтвердить тренером
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="bulk-role"
                        checked={bulkRole === 'admin'}
                        onChange={() => setBulkRole('admin')}
                      />
                      Подтвердить админом
                    </label>
                    <button
                      type="button"
                      className="btn-primary px-3 py-1.5 text-sm"
                      disabled={
                        bulkBusy ||
                        pendingGroups.every(
                          (i) => !bulkSelected.has(i.sessionKey),
                        )
                      }
                      onClick={confirmBulk}
                    >
                      {bulkBusy ? 'Подтверждаем…' : 'Подтвердить'}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      {message && <p className="text-sm text-fitgo-300">{message}</p>}
      {!loading && !fixedKind && saleCount === 0 && (kind === 'ALL' || kind === 'PT') ? (
        <p className="text-xs text-slate-500">
          Разовых ПТ из продаж за период нет. Нужен опубликованный шаблон
          `/v1/trainer-pt-sales` в FitGOIntegration.
        </p>
      ) : null}

      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : visible.length === 0 ? (
        <p className="text-slate-400">Нет записей за период</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full table-fixed text-left text-[10px] md:min-w-full md:table-auto md:text-sm">
            <thead className="bg-slate-900/80 text-slate-400">
              <tr>
                <th className="w-[3.4rem] whitespace-nowrap px-1 py-2 font-medium md:hidden">
                  Дата
                </th>
                <th className="w-10 whitespace-nowrap px-1 py-2 font-medium md:hidden">
                  Время
                </th>
                <th className="hidden whitespace-nowrap px-3 py-2 font-medium md:table-cell">
                  Дата время
                </th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">
                  Вид
                </th>
                <th className="overflow-hidden whitespace-nowrap px-1 py-2 font-medium md:px-3">
                  Наименование
                </th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">
                  Сотрудник
                </th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">
                  Записано
                </th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">
                  Прибыло
                </th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">
                  Не прибыло
                </th>
                <th className="w-[5.6rem] overflow-hidden whitespace-nowrap px-1 py-2 font-medium md:w-auto md:px-3">
                  Статус
                </th>
                <th className="w-[4.3rem] overflow-hidden whitespace-nowrap px-1 py-2 font-medium md:w-auto md:px-3">
                  Оплата
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const a = attendanceOf(item);
                const pay = paymentCell(item);
                const title = [
                  item.title,
                  item.clientName && item.kind !== 'GROUP'
                    ? item.clientName
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <tr
                    key={item.sessionKey}
                    className="cursor-pointer border-t border-slate-800/80 hover:bg-slate-900/60"
                    onClick={() => openDetail(item.sessionKey)}
                  >
                    <td className="whitespace-nowrap px-1 py-2 text-slate-400 md:hidden">
                      {formatDay(item.startAt)}
                    </td>
                    <td className="whitespace-nowrap px-1 py-2 tabular-nums text-slate-400 md:hidden">
                      {formatClock(item.startAt)}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-slate-400 md:table-cell">
                      {formatDateTime(item.startAt)}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-300 md:table-cell">
                      {kindRu(item.kind)}
                      {item.source === 'SALE' ? (
                        <span className="ml-1 rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-300">
                          продажа
                        </span>
                      ) : null}
                      {item.source === 'FITGO' ? (
                        <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] text-amber-300">
                          нет в 1С
                        </span>
                      ) : null}
                    </td>
                    <td className="overflow-hidden px-1 py-2 text-white md:px-3">
                      <span className="block max-w-full truncate md:max-w-[16rem]" title={title}>
                        {item.title}
                        {item.clientName && item.kind !== 'GROUP' ? (
                          <span className="text-slate-500">
                            {' '}
                            · {item.clientName}
                          </span>
                        ) : null}
                      </span>
                      {item.needsReview ? (
                        <span className="ml-1 hidden rounded bg-rose-500/20 px-1 py-0.5 text-[10px] text-rose-300 md:inline">
                          проверка
                        </span>
                      ) : null}
                      {item.approvalLabel ? (
                        <span className="ml-1 hidden rounded bg-amber-500/20 px-1 py-0.5 text-[10px] text-amber-300 md:inline">
                          {item.approvalLabel}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden max-w-[12rem] truncate px-3 py-2 text-slate-300 md:table-cell">
                      {item.performerName}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-slate-300 md:table-cell">
                      {a.booked}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-emerald-300 md:table-cell">
                      {a.arrived}
                    </td>
                    <td
                      className={
                        a.noShow > 0
                          ? 'hidden px-3 py-2 text-right tabular-nums text-amber-300 md:table-cell'
                          : 'hidden px-3 py-2 text-right tabular-nums text-slate-500 md:table-cell'
                      }
                    >
                      {a.noShow}
                    </td>
                    <td className="overflow-hidden whitespace-nowrap px-1 py-2 text-slate-300 md:px-3">
                      {statusRu(item.status)}
                    </td>
                    <td
                      className={
                        item.payment === 'DEBT'
                          ? 'overflow-hidden px-1 py-2 text-rose-300 md:px-3'
                          : 'overflow-hidden px-1 py-2 text-slate-300 md:px-3'
                      }
                    >
                      <span className="block truncate" title={pay}>
                        {pay}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
            {detailLoading || !selected ? (
              <p className="text-slate-400">Загрузка…</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">
                      {kindRu(selected.kind)} · {statusRu(selected.status)}
                      {selected.number ? ` · № ${selected.number}` : ''}
                      {selected.payTag
                        ? ` · ${payTagLabelRu(selected.payTag)}`
                        : ''}
                      {selected.history && selected.history.length > 0 ? (
                        <span className="relative ml-1.5 inline-block">
                          <button
                            type="button"
                            className="text-sky-400/90 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
                            aria-expanded={historyOpen}
                            aria-label="История записи"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryOpen((v) => !v);
                            }}
                          >
                            история
                          </button>
                          {historyOpen ? (
                            <span
                              role="tooltip"
                              className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-2 text-left text-[11px] leading-snug text-slate-300 shadow-lg"
                            >
                              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                История
                              </span>
                              <ul className="space-y-1">
                                {selected.history.map((ev, i) => (
                                  <li key={`${ev.at}-${i}`}>
                                    <span className="text-slate-400">
                                      {formatDateTime(ev.at)}
                                    </span>
                                    {' · '}
                                    {ev.action}
                                    {ev.byName ? ` · ${ev.byName}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </p>
                    <h2 className="truncate text-lg font-semibold">
                      {selected.title}
                    </h2>
                    <p className="text-sm text-slate-400">
                      {formatDateTime(selected.startAt)}
                      {selected.endAt
                        ? ` – ${formatDateTime(selected.endAt)}`
                        : ''}
                      {selected.roomTitle ? ` · ${selected.roomTitle}` : ''}
                    </p>
                    <p className="text-sm text-slate-400">
                      {selected.performerName}
                      {selected.kind !== 'GROUP' && selected.clientName
                        ? ` · ${selected.clientName}`
                        : ''}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      Записано {selected.bookedCount ?? attendanceOf(selected).booked}
                      {' · '}
                      <span className="text-emerald-300">
                        прибыло{' '}
                        {selected.arrivedCount ??
                          attendanceOf(selected).arrived}
                      </span>
                      {' · '}
                      <span
                        className={
                          (selected.noShowCount ??
                            attendanceOf(selected).noShow) > 0
                            ? 'text-amber-300'
                            : 'text-slate-500'
                        }
                      >
                        не прибыло{' '}
                        {selected.noShowCount ??
                          attendanceOf(selected).noShow}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {canViewHallPhotos &&
                      selected.kind === 'GROUP' &&
                      selected.source === '1C' &&
                      api.listHallSnapshots && (
                        <button
                          type="button"
                          className="btn-secondary text-sm"
                          onClick={() => void openPhotos()}
                        >
                          Фото
                        </button>
                      )}
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => {
                        closePhotos();
                        setHistoryOpen(false);
                        setSelected(null);
                      }}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
                {photosOpen && (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Фото зала (+20 / +40 мин)
                      </p>
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:text-slate-200"
                        onClick={closePhotos}
                      >
                        Скрыть
                      </button>
                    </div>
                    {photosLoading && (
                      <p className="text-sm text-slate-400">Загрузка…</p>
                    )}
                    {photosError ? (
                      <p className="text-sm text-rose-300">{photosError}</p>
                    ) : null}
                    {!photosLoading && !photosError && photos.length === 0 && (
                      <p className="text-sm text-slate-400">
                        Снимков пока нет. Агент снимет кадры через 20 и 40 минут
                        после начала, если зал привязан к камере.
                      </p>
                    )}
                    <ul className="space-y-3">
                      {photos.map((snap) => (
                        <li
                          key={snap.id}
                          className="rounded-lg border border-slate-800 p-2 text-sm"
                        >
                          <p className="text-slate-300">
                            +{snap.offsetMin} мин ·{' '}
                            {formatDateTime(snap.slotAt)}
                            {snap.cameraLabel
                              ? ` · ${snap.cameraLabel}`
                              : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {snap.status === 'CAPTURED'
                              ? 'снято'
                              : snap.status === 'FAILED'
                                ? `не снято${snap.errorMessage ? `: ${snap.errorMessage}` : ''}`
                                : snap.captureAttempts &&
                                    snap.captureAttempts > 0
                                  ? `повтор${snap.nextAttemptAt ? ` ~${formatDateTime(snap.nextAttemptAt)}` : ''}${snap.errorMessage ? ` · ${snap.errorMessage}` : ''}`
                                  : 'ожидается'}
                          </p>
                          {photoUrls[snap.id] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photoUrls[snap.id]}
                              alt={`Снимок +${snap.offsetMin} мин`}
                              className="mt-2 max-h-64 w-full rounded-md object-contain"
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.source === 'FITGO' && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    Ещё нет в 1С — в ЗП не входит.
                    {selected.fitgoBookedAt
                      ? ` Запись создана ${formatDateTime(selected.fitgoBookedAt)}.`
                      : ''}
                  </p>
                )}
                {selected.source === 'SALE' && selected.payment === 'PAID' && (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    Разовая ПТ из строки продажи 1С (исполнитель + сумма). В ЗП:
                    сумма × % из карточки мотивации ПТ.
                  </p>
                )}
                {selected.source === 'SALE' && selected.payment === 'DEBT' && (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    Нет оплаты — в ЗП не входит, пока продажа не оплачена в 1С.
                  </p>
                )}
                {selected.kind !== 'GROUP' && (
                  <p
                    className={
                      selected.payment === 'DEBT'
                        ? 'text-sm font-medium text-rose-300'
                        : 'text-sm text-slate-300'
                    }
                  >
                    {paymentLabelRu(selected.payment)}
                    {selected.payTag
                      ? ` · ${payTagLabelRu(selected.payTag)}`
                      : ''}
                    {selected.priceMinor != null
                      ? ` · ${(selected.priceMinor / 100).toFixed(2)} BYN`
                      : ''}
                  </p>
                )}
                {selected.kind === 'SPA' && selected.spaSettlement ? (
                  <p
                    className={
                      selected.spaSettlement.status === 'PAID' ||
                      selected.spaSettlement.status === 'QUOTA_CONSUMED'
                        ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'
                        : selected.spaSettlement.status === 'AWAITING_PAYMENT' ||
                            selected.spaSettlement.status === 'NOT_IN_1C'
                          ? 'rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200'
                          : selected.spaSettlement.status === 'CANCELLED_IN_1C'
                            ? 'rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
                            : 'rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-300'
                    }
                  >
                    {selected.spaSettlement.label}
                    {selected.spaSettlement.visitNum
                      ? ` · док. ${selected.spaSettlement.visitNum}`
                      : ''}
                    {selected.crmDocRef &&
                    selected.crmDocRef !== selected.spaSettlement.visitNum
                      ? ` · ref ${selected.crmDocRef}`
                      : ''}
                  </p>
                ) : null}
                {selected.members.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Состав (
                      {selected.arrivedCount ??
                        selected.members.filter((m) => m.attendance === 'ATTENDED')
                          .length}{' '}
                      пришли · записано{' '}
                      {selected.bookedCount ??
                        selected.members.filter((m) => m.attendance !== 'CANCELLED')
                          .length}
                      )
                    </p>
                    {selected.kind === 'GROUP' &&
                    selected.groupApproval &&
                    selected.groupApproval.trainerSeenCount !==
                      (selected.arrivedCount ?? 0) ? (
                      <p className="text-xs text-amber-300/90">
                        Тренер отметил {selected.groupApproval.trainerSeenCount}{' '}
                        · в 1С прибыло {selected.arrivedCount ?? 0}
                      </p>
                    ) : null}
                    <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 text-sm">
                      {selected.members.map((m) => (
                        <li
                          key={m.externalId}
                          className="flex flex-wrap items-center gap-2 border-b border-slate-900 px-2 py-1.5 last:border-0"
                        >
                          {canTrainerSeen &&
                          api.saveTrainerSeen &&
                          selected.kind === 'GROUP' &&
                          selected.source === '1C' &&
                          m.attendance !== 'CANCELLED' &&
                          !selected.groupApproval?.locked ? (
                            <label className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-[11px] text-slate-400">
                              <input
                                type="checkbox"
                                className="rounded border-slate-600"
                                checked={localSeen.has(m.externalId)}
                                disabled={seenBusy}
                                onChange={() => toggleTrainerSeen(m.externalId)}
                                aria-label="Был на занятии"
                              />
                            </label>
                          ) : (
                            <span className="w-14 shrink-0 text-[11px] text-slate-500">
                              {m.attendance === 'ATTENDED'
                                ? 'Прибыл'
                                : m.attendance === 'NO_SHOW'
                                  ? 'не пришёл'
                                  : m.attendance === 'CANCELLED'
                                    ? 'отмена'
                                    : localSeen.has(m.externalId) || m.trainerSeen
                                      ? 'отмечен'
                                      : 'ожид.'}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {m.clientName}
                            {m.paymentBasis ? (
                              <span className="text-slate-500">
                                {' '}
                                · {m.paymentBasis}
                              </span>
                            ) : null}
                          </span>
                          {canMarkAttendance &&
                          api.setAttendance &&
                          selected.kind === 'GROUP' &&
                          selected.source === '1C' &&
                          m.attendance !== 'CANCELLED' &&
                          !selected.groupApproval?.locked ? (
                            <span className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                                disabled={attendanceBusyId === m.externalId}
                                onClick={() =>
                                  markAttendance(m.externalId, 'ATTENDED')
                                }
                              >
                                Прибыл
                              </button>
                              <button
                                type="button"
                                className="rounded border border-rose-500/40 px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                                disabled={attendanceBusyId === m.externalId}
                                onClick={() =>
                                  markAttendance(m.externalId, 'NO_SHOW')
                                }
                              >
                                Не прибыл
                              </button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.kind === 'GROUP' && selected.groupApproval && (
                  <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-xs text-slate-300">
                    {selected.groupApproval.phase === 'APPROVED' ? (
                      <p className="text-emerald-300">
                        Подтверждено
                        {selected.groupApproval.overrideName
                          ? ` · ${selected.groupApproval.overrideName}`
                          : selected.groupApproval.adminName
                            ? ` · админ ${selected.groupApproval.adminName}`
                            : ''}
                        {selected.groupApproval.trainerName
                          ? ` · тренер ${selected.groupApproval.trainerName}`
                          : ''}
                      </p>
                    ) : selected.groupApproval.phase === 'PENDING_ADMIN' ? (
                      <p className="text-amber-300">
                        Проверено тренером
                        {selected.groupApproval.trainerName
                          ? `: ${selected.groupApproval.trainerName}`
                          : ''}
                        {' · ждёт администратора'}
                      </p>
                    ) : (
                      <p className="text-amber-300">Ждёт подтверждения тренера</p>
                    )}
                    {selected.groupApproval.returnedAt ? (
                      <p className="text-rose-300">
                        Возврат
                        {selected.groupApproval.returnedByName
                          ? ` · ${selected.groupApproval.returnedByName}`
                          : ''}
                        {selected.groupApproval.returnComment
                          ? `: ${selected.groupApproval.returnComment}`
                          : ''}
                      </p>
                    ) : null}
                    {selected.groupApproval.locked ? (
                      <p className="text-slate-500">Период ЗП закрыт — только просмотр</p>
                    ) : null}
                  </div>
                )}
                {selected.kind === 'SPA' &&
                selected.status !== 'CANCELLED' &&
                selected.approvalPhase &&
                selected.approvalPhase !== 'APPROVED' ? (
                  <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-xs text-slate-300">
                    <p className="text-amber-300">
                      {selected.approvalLabel ??
                        (selected.approvalPhase === 'PENDING_ADMIN'
                          ? 'Ждёт администратора'
                          : 'Ждёт специалиста')}
                    </p>
                    {canApproveGroup && api.approveGroup ? (
                      <button
                        type="button"
                        className="btn-primary w-full text-sm"
                        onClick={approveGroup}
                        disabled={approveBusy}
                      >
                        Подтвердить
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {selected.kind === 'GROUP' &&
                selected.source === '1C' &&
                !selected.groupApproval?.locked &&
                (canApproveGroup || canReturnApproval) ? (
                  <div className="space-y-2">
                    <textarea
                      className="input min-h-[3rem] w-full text-sm"
                      placeholder="Комментарий (необязательно)"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <div className="flex flex-col gap-2">
                      {canApproveGroup && api.approveGroup ? (
                        <button
                          type="button"
                          className="btn-primary w-full text-sm"
                          onClick={approveGroup}
                          disabled={approveBusy}
                        >
                          Подтвердить
                        </button>
                      ) : null}
                      {canReturnApproval && api.returnGroupApproval ? (
                        <button
                          type="button"
                          className="btn-secondary w-full text-sm"
                          onClick={returnApproval}
                          disabled={approveBusy}
                        >
                          На доработку
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {selected.kind !== 'GROUP' && selected.remark && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                    <p className="font-medium text-rose-200">На проверке</p>
                    <p className="mt-1 text-slate-300">
                      {selected.remark.staffName}: {selected.remark.staffComment}
                    </p>
                  </div>
                )}
                {selected.kind !== 'GROUP' && !selected.remark && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Замечание снимает занятие с ЗП до ответа администратора
                    </p>
                    <textarea
                      className="input min-h-[4rem] w-full text-sm"
                      placeholder="Комментарий к занятию"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-secondary w-full text-sm"
                      onClick={submitRemark}
                      disabled={!comment.trim()}
                    >
                      Отправить на проверку
                    </button>
                  </div>
                )}
                {selected.kind !== 'GROUP' &&
                  canResolve &&
                  selected.remark?.status === 'OPEN' &&
                  api.resolveRemark && (
                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      <textarea
                        className="input min-h-[4rem] w-full text-sm"
                        placeholder="Ответ администратора"
                        value={adminComment}
                        onChange={(e) => setAdminComment(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary w-full text-sm"
                        onClick={resolve}
                        disabled={!adminComment.trim()}
                      >
                        Отработано
                      </button>
                    </div>
                  )}
                {/* Legacy open remark on GROUP still visible */}
                {selected.kind === 'GROUP' && selected.remark?.status === 'OPEN' && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                    <p className="font-medium text-rose-200">Открытое замечание</p>
                    <p className="mt-1 text-slate-300">
                      {selected.remark.staffName}: {selected.remark.staffComment}
                    </p>
                    {canResolve && api.resolveRemark ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          className="input min-h-[3rem] w-full text-sm"
                          placeholder="Ответ администратора"
                          value={adminComment}
                          onChange={(e) => setAdminComment(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-primary w-full text-sm"
                          onClick={resolve}
                          disabled={!adminComment.trim()}
                        >
                          Отработано
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
