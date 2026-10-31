'use client';

import type {
  Membership,
  SpaBookingSlot,
  SpaServiceEligibility,
  SpaSpecialistSummary,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/components/forma/toast';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export const CATEGORY_ORDER = [
  'Классический SPA-массаж',
  'Расслабляющий SPA-массаж',
  'Коррекция фигуры',
  'Спортивный SPA-массаж',
  'Обертывание',
  'Анализ состава тела',
  'Другое',
] as const;

export function categoryOf(el: SpaServiceEligibility): string {
  const name = el.service.name.toLowerCase();
  if (el.service.kind === 'BODY_COMPOSITION') return 'Анализ состава тела';
  if (el.service.kind === 'WRAP') return 'Обертывание';
  if (/классическ/.test(name)) return 'Классический SPA-массаж';
  if (/расслаб|релакс/.test(name)) return 'Расслабляющий SPA-массаж';
  if (/коррекц|медов/.test(name)) return 'Коррекция фигуры';
  if (/спортив/.test(name)) return 'Спортивный SPA-массаж';
  if (/бандаж|оберт/.test(name)) return 'Обертывание';
  return 'Другое';
}

export interface CalendarSlot extends SpaBookingSlot {
  specialistId: string;
  specialistName: string;
}

export function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export function toDateKey(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Half-hour pills 08:00–21:00 for waitlist. */
export const WAITLIST_TIME_PILLS = Array.from({ length: 27 }, (_, i) => {
  const total = 8 * 60 + i * 30;
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
});

const monthLongFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});

export function useSpaBooking() {
  const toast = useToast();
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
  const [waitlistOffer, setWaitlistOffer] = useState<CalendarSlot | null>(null);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistDesiredTime, setWaitlistDesiredTime] = useState('10:00');
  const [joinedWaitlistIds, setJoinedWaitlistIds] = useState<string[]>([]);

  const selectedEligibility = useMemo(
    () => services.find((s) => s.service.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

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
            `Нет услуг SPA, доступных по абонементу «${membershipServiceName}». Обратитесь к администратору.`,
          );
        } else {
          setMessage('');
        }
      })
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, [forcedQuota, membershipServiceName]);

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
    const next = availableDays.find((d) => d.key >= key);
    setSelectedDate(
      next?.key ?? availableDays[availableDays.length - 1]?.key ?? null,
    );
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
      const okMsg =
        type === 'QUOTA'
          ? 'Запись подтверждена, услуга списана с абонемента'
          : 'Запись подтверждена (платно / к оплате на ресепшене)';
      setMessage(okMsg);
      toast.success(okMsg);
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
      const msg = err instanceof Error ? err.message : 'Ошибка записи';
      setMessage(msg);
      if (/занят|недоступ|конфликт|уже есть/i.test(msg)) {
        setWaitlistOffer(slot);
      }
    } finally {
      setBookingKey(null);
    }
  };

  const joinWaitlist = async (args: {
    specialistId: string;
    startAt: string;
  }) => {
    const token = getToken();
    if (!token || !selectedServiceId) return;
    setWaitlistBusy(true);
    setMessage('');
    try {
      const entry = await api.clientJoinSpaWaitlist(token, {
        specialistId: args.specialistId,
        serviceId: selectedServiceId,
        desiredStartAt: args.startAt,
      });
      setJoinedWaitlistIds((prev) => [...prev, entry.id]);
      setWaitlistOffer(null);
      setMessage(
        'Вы в листе ожидания. Администратор свяжется при освобождении.',
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Не удалось добавить в лист',
      );
    } finally {
      setWaitlistBusy(false);
    }
  };

  const joinWaitlistForDesiredTime = async (dateOverride?: string) => {
    const date = dateOverride ?? selectedDate;
    if (!date || specialistFilter === 'ALL') {
      setMessage(
        'Выберите конкретного специалиста и время для листа ожидания',
      );
      return;
    }
    if (!selectedDate) setSelectedDate(date);
    const startAt = new Date(
      `${date}T${waitlistDesiredTime}:00`,
    ).toISOString();
    await joinWaitlist({ specialistId: specialistFilter, startAt });
  };

  const pickCategory = (name: string) => {
    setSelectedCategory(name);
    setSelectedServiceId(null);
    setSlots([]);
  };

  const pickService = (item: SpaServiceEligibility) => {
    setSelectedServiceId(item.service.id);
    if (item.quotaAvailable && forcedQuota) {
      setPaymentType('QUOTA');
    }
  };

  return {
    membershipServiceName,
    forcedQuota,
    services,
    selectedCategory,
    selectedServiceId,
    paymentType,
    setPaymentType,
    specialists,
    specialistFilter,
    setSpecialistFilter,
    selectedDate,
    setSelectedDate,
    loading,
    loadingSlots,
    bookingKey,
    message,
    setMessage,
    membership,
    waitlistOffer,
    setWaitlistOffer,
    waitlistBusy,
    waitlistDesiredTime,
    setWaitlistDesiredTime,
    joinedWaitlistIds,
    selectedEligibility,
    categories,
    activeCategory,
    availableDays,
    dateMin,
    dateMax,
    daySlots,
    jumpToDate,
    handleBook,
    joinWaitlist,
    joinWaitlistForDesiredTime,
    pickCategory,
    pickService,
  };
}
