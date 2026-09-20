'use client';

import type {
  Membership,
  SpaBookingSlot,
  SpaServiceEligibility,
  SpaSpecialistSummary,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

/** Направления как на сайте ffs.by/ceny-uslug/spa-uslugi. */
const CATEGORY_ORDER = [
  'Классический спа-массаж',
  'Расслабляющий спа-массаж',
  'Коррекция фигуры',
  'Спортивный спа-массаж',
  'Обертывание',
  'Анализ состава тела',
  'Другое',
] as const;

function categoryOf(el: SpaServiceEligibility): string {
  const name = el.service.name.toLowerCase();
  if (el.service.kind === 'BODY_COMPOSITION') return 'Анализ состава тела';
  if (el.service.kind === 'WRAP') return 'Обертывание';
  if (/классическ/.test(name)) return 'Классический спа-массаж';
  if (/расслаб|релакс/.test(name)) return 'Расслабляющий спа-массаж';
  if (/коррекц|медов/.test(name)) return 'Коррекция фигуры';
  if (/спортив/.test(name)) return 'Спортивный спа-массаж';
  if (/бандаж|оберт/.test(name)) return 'Обертывание';
  return 'Другое';
}

interface CalendarSlot extends SpaBookingSlot {
  specialistId: string;
  specialistName: string;
}

const weekdayShortFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const dayNumFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric' });
const monthLongFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

function toDateKey(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  return toDateKey(new Date());
}

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export default function ClientSpaSchedulePage() {
  const searchParams = useSearchParams();
  const membershipServiceName = searchParams.get('service') ?? undefined;
  const forcedQuota = Boolean(membershipServiceName);

  const [services, setServices] = useState<SpaServiceEligibility[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [paymentType, setPaymentType] = useState<'QUOTA' | 'PAID'>(
    forcedQuota ? 'QUOTA' : 'PAID',
  );
  const [specialists, setSpecialists] = useState<SpaSpecialistSummary[]>([]);
  const [specialistFilter, setSpecialistFilter] = useState<string>('ALL');
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [membership, setMembership] = useState<Membership | null>(null);

  const selectedEligibility = useMemo(
    () => services.find((s) => s.service.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  // Направления с их видами
  const categories = useMemo(() => {
    const map = new Map<string, SpaServiceEligibility[]>();
    for (const el of services) {
      const cat = categoryOf(el);
      const list = map.get(cat) ?? [];
      list.push(el);
      map.set(cat, list);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      name: c,
      items: map.get(c)!,
      quota: map.get(c)!.some((el) => el.quotaAvailable),
    }));
  }, [services]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setSelectedCategory(null);
    setSelectedServiceId(null);
    setSlots([]);
    api
      .clientSpaServices(token, {
        membershipServiceName,
        quotaOnly: forcedQuota,
      })
      .then((list) => {
        setServices(list);
        if (forcedQuota && list.length === 0) {
          setMessage(
            `Нет услуг спа, доступных по абонементу «${membershipServiceName}». Обратитесь к администратору.`,
          );
        } else {
          setMessage('');
        }
      })
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, [forcedQuota, membershipServiceName]);

  // Deep-link / единственная услуга: сразу выбрать направление и вид
  useEffect(() => {
    if (loading || services.length === 0 || selectedCategory) return;

    const preferred =
      (membershipServiceName
        ? services.find(
            (s) => s.membershipServiceName === membershipServiceName,
          )
        : undefined) ??
      (forcedQuota ? services.find((s) => s.quotaAvailable) : undefined) ??
      (services.length === 1 ? services[0] : undefined) ??
      (categories.length === 1 ? categories[0].items[0] : undefined);

    if (!preferred) {
      if (categories.length === 1) {
        setSelectedCategory(categories[0].name);
      }
      return;
    }

    setSelectedCategory(categoryOf(preferred));
    if (forcedQuota || services.length === 1 || categories.length === 1) {
      setSelectedServiceId(preferred.service.id);
      if (preferred.quotaAvailable) setPaymentType('QUOTA');
    }
  }, [
    loading,
    services,
    categories,
    selectedCategory,
    forcedQuota,
    membershipServiceName,
  ]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.name === selectedCategory) ?? null,
    [categories, selectedCategory],
  );

  useEffect(() => {
    if (!selectedServiceId) {
      setSpecialists([]);
      return;
    }
    const token = getToken();
    if (!token) return;
    const el = services.find((s) => s.service.id === selectedServiceId);
    const type = paymentType === 'QUOTA' && el?.quotaAvailable ? 'QUOTA' : 'PAID';
    api
      .clientSpaSpecialists(token, selectedServiceId, {
        paymentType: type,
        membershipServiceName:
          type === 'QUOTA'
            ? el?.membershipServiceName ?? membershipServiceName
            : undefined,
      })
      .then((list) => {
        setSpecialists(list);
        setSpecialistFilter('ALL');
      })
      .catch((err) => setMessage(err.message));
  }, [selectedServiceId, paymentType, services, membershipServiceName]);

  useEffect(() => {
    if (!selectedServiceId || specialists.length === 0) {
      setSlots([]);
      return;
    }
    const token = getToken();
    if (!token) return;
    const targets =
      specialistFilter === 'ALL'
        ? specialists
        : specialists.filter((s) => s.id === specialistFilter);
    setLoadingSlots(true);
    Promise.all(
      targets.map((sp) =>
        api
          .clientSpaSlots(token, sp.id, selectedServiceId)
          .then((list) =>
            list.map((slot) => ({
              ...slot,
              specialistId: sp.id,
              specialistName: `${sp.firstName} ${sp.lastName}`.trim(),
            })),
          )
          .catch(() => [] as CalendarSlot[]),
      ),
    )
      .then((lists) => {
        const merged = lists
          .flat()
          .sort((a, b) => a.startAt.localeCompare(b.startAt));
        setSlots(merged);
      })
      .finally(() => setLoadingSlots(false));
  }, [selectedServiceId, specialistFilter, specialists]);

  // Дни с доступными слотами + диапазон для прыжка датой
  const availableDays = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const key = toDateKey(slot.startAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, count }));
  }, [slots]);

  const dateMin = availableDays[0]?.key ?? todayKey();
  const dateMax =
    availableDays[availableDays.length - 1]?.key ?? addDaysKey(todayKey(), 14);

  // При смене слотов — выбрать ближайший доступный день
  useEffect(() => {
    if (availableDays.length === 0) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate((prev) => {
      if (prev && availableDays.some((d) => d.key === prev)) return prev;
      return availableDays[0].key;
    });
  }, [availableDays]);

  const daySlots = useMemo(() => {
    if (!selectedDate) return [];
    return slots.filter((s) => toDateKey(s.startAt) === selectedDate);
  }, [slots, selectedDate]);

  const jumpToDate = (key: string) => {
    if (!key) return;
    const exact = availableDays.find((d) => d.key === key);
    if (exact) {
      setSelectedDate(exact.key);
      return;
    }
    // ближайший день со слотами >= выбранной даты, иначе последний доступный
    const next = availableDays.find((d) => d.key >= key);
    setSelectedDate(next?.key ?? availableDays[availableDays.length - 1]?.key ?? null);
    if (!exact && availableDays.length > 0) {
      setMessage(
        next
          ? `На ${monthLongFmt.format(new Date(`${key}T12:00:00`))} нет слотов — показан ближайший день`
          : `На ${monthLongFmt.format(new Date(`${key}T12:00:00`))} и позже нет слотов`,
      );
    }
  };

  const handleBook = async (slot: CalendarSlot) => {
    const token = getToken();
    if (!token || !selectedServiceId) {
      setMessage('Не удалось записаться: выберите услугу и войдите снова');
      return;
    }
    const el = selectedEligibility;
    const type = paymentType === 'QUOTA' && el?.quotaAvailable ? 'QUOTA' : 'PAID';
    const key = `${slot.specialistId}:${slot.startAt}`;
    const occupyMs =
      ((el?.service.durationMin ?? 30) + (el?.service.bufferMin ?? 0)) * 60_000;
    const bookedStart = new Date(slot.startAt).getTime();
    const bookedEnd = bookedStart + occupyMs;
    setBookingKey(key);
    setMessage('');
    try {
      const result = await api.clientBookSpa(token, {
        serviceId: selectedServiceId,
        specialistId: slot.specialistId,
        startAt: slot.startAt,
        paymentType: type,
        membershipServiceName:
          type === 'QUOTA'
            ? el?.membershipServiceName ?? membershipServiceName
            : undefined,
      });
      setMembership(result.membership);
      setMessage(
        type === 'QUOTA'
          ? 'Запись подтверждена, услуга списана с абонемента'
          : 'Запись подтверждена (платно / к оплате на ресепшене)',
      );
      // Убрать занятый слот и все пересекающиеся (step может быть короче длительности+buffer)
      setSlots((prev) =>
        prev.filter((s) => {
          if (s.specialistId !== slot.specialistId) return true;
          const sStart = new Date(s.startAt).getTime();
          const sEnd = new Date(s.endAt).getTime();
          return !(sStart < bookedEnd && sEnd > bookedStart);
        }),
      );
      if (result.membership) {
        try {
          const raw = sessionStorage.getItem('fitgo:client-dashboard:v2');
          if (raw) {
            const data = JSON.parse(raw) as { membership?: Membership };
            data.membership = result.membership;
            sessionStorage.setItem(
              'fitgo:client-dashboard:v2',
              JSON.stringify(data),
            );
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBookingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {forcedQuota && (
        <p className="text-sm text-slate-400">
          Запись по абонементу: {membershipServiceName}
        </p>
      )}

      {message && !selectedServiceId && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {membership && (
        <p className="text-xs text-slate-500">
          Абонемент обновлён
          {membership.services
            ?.filter((s) => /массаж|состав/i.test(s.name))
            .map((s) => ` · ${s.name}: ${s.remaining ?? '∞'}`)
            .join('') ?? ''}
        </p>
      )}

      {services.length === 0 ? (
        <div className="card text-center text-slate-400">Нет доступных услуг</div>
      ) : (
        <>
          {/* Шаг 1 — направление */}
          <div className="space-y-2">
            <h3 className="font-medium">Направление</h3>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((cat) => {
                const active = cat.name === selectedCategory;
                return (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.name);
                      setSelectedServiceId(null);
                      setSlots([]);
                    }}
                    className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                      active
                        ? 'border-fitgo-500 bg-fitgo-500/15 text-white'
                        : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="block font-medium leading-tight">
                      {cat.name}
                    </span>
                    {cat.quota && (
                      <span className="mt-1 block text-xs text-fitgo-300">
                        Есть по абонементу
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Шаг 2 — виды */}
          {activeCategory && (
            <div className="space-y-2">
              <h3 className="font-medium">Вид услуги</h3>
              <ul className="space-y-2">
                {activeCategory.items.map((item) => {
                  const active = item.service.id === selectedServiceId;
                  return (
                    <li key={item.service.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedServiceId(item.service.id);
                          if (item.quotaAvailable && forcedQuota) {
                            setPaymentType('QUOTA');
                          }
                        }}
                        className={`card w-full text-left ${
                          active ? 'ring-2 ring-fitgo-500' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{item.service.name}</p>
                            <p className="text-sm text-slate-400">
                              {item.service.durationMin} мин
                            </p>
                          </div>
                          <div className="text-right text-sm">
                            {item.quotaAvailable && (
                              <p className="text-fitgo-300">
                                По абонементу
                                {item.quotaRemaining !== undefined
                                  ? ` (${item.quotaRemaining})`
                                  : ''}
                              </p>
                            )}
                            <p className="text-slate-300">
                              {formatPrice(
                                item.service.priceMinor,
                                item.service.currency,
                              )}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Оплата (если доступен выбор) */}
          {selectedEligibility &&
            !forcedQuota &&
            selectedEligibility.quotaAvailable && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm ${
                    paymentType === 'QUOTA'
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => setPaymentType('QUOTA')}
                >
                  По абонементу
                </button>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm ${
                    paymentType === 'PAID'
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => setPaymentType('PAID')}
                >
                  Платно
                </button>
              </div>
            )}

          {/* Фильтр по специалистам */}
          {selectedServiceId && specialists.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">Специалист</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSpecialistFilter('ALL')}
                  className={`rounded-full px-4 py-2 text-sm ${
                    specialistFilter === 'ALL'
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Все
                </button>
                {specialists.map((sp) => (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => setSpecialistFilter(sp.id)}
                    className={`rounded-full px-4 py-2 text-sm ${
                      specialistFilter === sp.id
                        ? 'bg-fitgo-500 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {sp.firstName} {sp.lastName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Шаг 3 — дата, затем время */}
          {selectedServiceId && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Дата и время</h3>
                {availableDays.length > 0 && (
                  <label className="relative inline-flex cursor-pointer items-center gap-1.5 text-sm text-fitgo-300">
                    <span>Перейти к дате</span>
                    <input
                      type="date"
                      className="absolute inset-0 cursor-pointer opacity-0"
                      min={dateMin}
                      max={dateMax}
                      value={selectedDate ?? dateMin}
                      onChange={(e) => jumpToDate(e.target.value)}
                    />
                  </label>
                )}
              </div>

              {message && (
                <p
                  className={`rounded-xl px-3 py-2 text-sm ${
                    /ошибк|недоступ|не удалось|нет /i.test(message)
                      ? 'bg-rose-500/10 text-rose-300'
                      : 'bg-fitgo-500/10 text-fitgo-300'
                  }`}
                >
                  {message}
                </p>
              )}
              {specialists.length === 0 ? (
                <div className="card text-center text-slate-400">
                  Нет специалистов с расписанием для этой услуги
                </div>
              ) : loadingSlots ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
                </div>
              ) : availableDays.length === 0 ? (
                <div className="card text-center text-slate-400">
                  Нет свободных слотов на ближайшие две недели
                </div>
              ) : (
                <>
                  {/* Лента дней — быстрый выбор без длинного скролла */}
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {availableDays.map((day) => {
                      const d = new Date(`${day.key}T12:00:00`);
                      const active = day.key === selectedDate;
                      const isToday = day.key === todayKey();
                      return (
                        <button
                          key={day.key}
                          type="button"
                          onClick={() => {
                            setSelectedDate(day.key);
                            setMessage('');
                          }}
                          className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border px-1 py-2 text-center transition ${
                            active
                              ? 'border-fitgo-500 bg-fitgo-500 text-white'
                              : 'border-slate-800 bg-slate-900 text-slate-300'
                          }`}
                        >
                          <span
                            className={`text-[11px] uppercase ${
                              active ? 'text-white/80' : 'text-slate-500'
                            }`}
                          >
                            {isToday
                              ? 'Сег'
                              : weekdayShortFmt.format(d).replace('.', '')}
                          </span>
                          <span className="text-lg font-semibold leading-tight">
                            {dayNumFmt.format(d)}
                          </span>
                          <span
                            className={`text-[10px] ${
                              active ? 'text-white/70' : 'text-slate-500'
                            }`}
                          >
                            {day.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedDate && (
                    <p className="text-sm capitalize text-slate-400">
                      {monthLongFmt.format(
                        new Date(`${selectedDate}T12:00:00`),
                      )}
                    </p>
                  )}

                  {daySlots.length === 0 ? (
                    <div className="card text-center text-slate-400">
                      На этот день нет свободного времени
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {daySlots.map((slot) => {
                        const key = `${slot.specialistId}:${slot.startAt}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={bookingKey === key}
                            onClick={() => {
                              void handleBook(slot);
                            }}
                            className="rounded-xl border border-slate-800 bg-slate-900 px-2 py-2.5 text-center text-sm hover:border-fitgo-500 disabled:opacity-50"
                          >
                            <span className="block font-medium">
                              {timeFmt.format(new Date(slot.startAt))}
                            </span>
                            {specialistFilter === 'ALL' &&
                              specialists.length > 1 && (
                                <span className="block text-[11px] text-slate-500">
                                  {slot.specialistName.split(' ')[0]}
                                </span>
                              )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
