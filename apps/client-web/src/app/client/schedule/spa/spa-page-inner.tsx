'use client';

import {
  Activity,
  CalendarDays,
  Check,
  Droplets,
  Flower2,
  Hand,
  Package,
  Pencil,
  Smile,
  Sparkles,
  Waves,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { Chip } from '@/components/forma/chip';
import { DateStrip, type DateStripDay } from '@/components/forma/date-strip';
import { EmptyState } from '@/components/forma/empty-state';
import { SegmentedControl } from '@/components/forma/segmented-control';
import { Sheet } from '@/components/forma/sheet';
import { SkeletonCard } from '@/components/forma/skeleton';
import {
  formatPrice,
  todayKey,
  useSpaBooking,
  WAITLIST_TIME_PILLS,
  type CalendarSlot,
} from './use-spa-booking';

const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const monthTitleFmt = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
});

type WizardStep =
  | 'category'
  | 'service'
  | 'payment'
  | 'specialist'
  | 'datetime';

const STEP_LABELS: { id: WizardStep; label: string }[] = [
  { id: 'category', label: 'Услуга' },
  { id: 'specialist', label: 'Специалист' },
  { id: 'datetime', label: 'Время' },
];

function categoryIcon(name: string): ReactNode {
  if (/классическ/i.test(name)) return <Hand className="h-5 w-5" />;
  if (/расслаб|релакс/i.test(name)) return <Flower2 className="h-5 w-5" />;
  if (/коррекц/i.test(name)) return <Sparkles className="h-5 w-5" />;
  if (/спортив/i.test(name)) return <Activity className="h-5 w-5" />;
  if (/оберт/i.test(name)) return <Droplets className="h-5 w-5" />;
  if (/состав|анализ/i.test(name)) return <Waves className="h-5 w-5" />;
  if (/уход|лиц/i.test(name)) return <Smile className="h-5 w-5" />;
  return <Package className="h-5 w-5" />;
}

function StepSummary({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="card flex w-full items-center gap-3 py-3 text-left touch-manipulation hover:bg-white/[0.03]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        <p className="truncate font-medium text-white">{value}</p>
      </div>
      <Pencil className="h-4 w-4 shrink-0 text-zinc-500" />
    </button>
  );
}

function StepRail({
  active,
  doneService,
}: {
  active: WizardStep;
  doneService: boolean;
}) {
  const phase =
    active === 'category' || active === 'service' || active === 'payment'
      ? 'category'
      : active === 'specialist'
        ? 'specialist'
        : 'datetime';
  return (
    <ol className="flex items-center gap-1.5">
      {STEP_LABELS.map((step, i) => {
        const isActive = step.id === phase;
        const isDone =
          (step.id === 'category' && doneService && phase !== 'category') ||
          (step.id === 'specialist' && phase === 'datetime');
        return (
          <li key={step.id} className="flex flex-1 items-center gap-1.5">
            <div
              className={`flex flex-1 flex-col items-center rounded-2xl px-2 py-2 text-center ${
                isActive
                  ? 'bg-forma-500 text-ink'
                  : isDone
                    ? 'bg-forma-500/20 text-forma-300'
                    : 'bg-ink-raised text-zinc-500'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {i + 1}
              </span>
              <span className="text-xs font-semibold">{step.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MonthCalendar({
  monthKey,
  selected,
  available,
  onSelect,
}: {
  monthKey: string;
  selected: string | null;
  available: Set<string>;
  onSelect: (key: string) => void;
}) {
  const base = new Date(`${monthKey}-01T12:00:00`);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(key);
  }

  return (
    <div>
      <p className="mb-3 text-center font-display text-sm font-semibold capitalize text-white">
        {monthTitleFmt.format(base)}
      </p>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-zinc-500">
        {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((key, i) => {
          if (!key) return <span key={`e-${i}`} />;
          const has = available.has(key);
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              disabled={!has}
              onClick={() => onSelect(key)}
              className={`rounded-xl py-2 text-sm tabular-nums touch-manipulation disabled:opacity-30 ${
                active
                  ? 'bg-forma-500 font-semibold text-ink'
                  : has
                    ? 'bg-ink-raised text-white hover:bg-white/[0.08]'
                    : 'text-zinc-600'
              }`}
            >
              {Number(key.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WaitlistTimePills({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {WAITLIST_TIME_PILLS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`rounded-xl border px-3 py-2 text-sm tabular-nums touch-manipulation ${
            value === t
              ? 'border-forma-500 bg-forma-500 text-ink'
              : 'border-white/10 bg-ink-raised text-zinc-300'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function groupSlotsByPeriod(slots: CalendarSlot[]) {
  const morning: CalendarSlot[] = [];
  const day: CalendarSlot[] = [];
  const evening: CalendarSlot[] = [];
  for (const slot of slots) {
    const h = new Date(slot.startAt).getHours();
    if (h < 12) morning.push(slot);
    else if (h < 17) day.push(slot);
    else evening.push(slot);
  }
  return [
    { key: 'morning', label: 'Утро', items: morning },
    { key: 'day', label: 'День', items: day },
    { key: 'evening', label: 'Вечер', items: evening },
  ].filter((g) => g.items.length > 0);
}

export default function ClientSpaSchedulePage() {
  const spa = useSpaBooking();
  const [editStep, setEditStep] = useState<WizardStep | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    todayKey().slice(0, 7),
  );

  const showPaymentChoice =
    !!spa.selectedEligibility &&
    !spa.forcedQuota &&
    !!spa.selectedEligibility.quotaAvailable;

  const activeStep: WizardStep = useMemo(() => {
    if (editStep) return editStep;
    if (!spa.selectedCategory) return 'category';
    if (!spa.selectedServiceId) return 'service';
    return 'datetime';
  }, [editStep, spa.selectedCategory, spa.selectedServiceId]);

  const dateStripDays: DateStripDay[] = spa.availableDays.map((d) => ({
    key: d.key,
    count: d.count,
  }));

  const availableSet = useMemo(
    () => new Set(spa.availableDays.map((d) => d.key)),
    [spa.availableDays],
  );

  const serviceSummary = spa.selectedEligibility
    ? `${spa.selectedEligibility.service.name} · ${spa.selectedEligibility.service.durationMin} мин · ${formatPrice(spa.selectedEligibility.service.priceMinor, spa.selectedEligibility.service.currency)}`
    : '';

  const paymentSummary =
    spa.paymentType === 'QUOTA' ? 'По абонементу' : 'Платно';

  const specialist =
    spa.specialistFilter === 'ALL'
      ? null
      : spa.specialists.find((s) => s.id === spa.specialistFilter);
  const specialistSummary = specialist
    ? `${specialist.firstName} ${specialist.lastName}`.trim()
    : 'Любой специалист';

  const editingPayment = editStep === 'payment';
  const editingSpecialist = editStep === 'specialist';
  const doneCategory = !!spa.selectedCategory && activeStep !== 'category';
  const doneService = !!spa.selectedServiceId && activeStep !== 'service';
  const paymentEditorVisible =
    showPaymentChoice && !!spa.selectedServiceId && editingPayment;
  const paymentSummaryVisible =
    showPaymentChoice &&
    !!spa.selectedServiceId &&
    !editingPayment &&
    doneService;
  const showSpecialistEditor = editingSpecialist;
  const showSpecialistSummary =
    !!spa.selectedServiceId &&
    spa.specialists.length > 0 &&
    !showSpecialistEditor &&
    doneService;

  const slotGroups = useMemo(
    () => groupSlotsByPeriod(spa.daySlots),
    [spa.daySlots],
  );

  if (spa.loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (spa.bookingSuccess) {
    const s = spa.bookingSuccess;
    return (
      <div className="space-y-5 py-4">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-forma-500 text-ink shadow-forma-glow">
            <Check className="h-8 w-8" strokeWidth={2.5} />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold text-white">
            Вы записаны
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {dateTimeFmt.format(new Date(s.startAt))}
          </p>
        </div>
        <div className="card space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Услуга
            </p>
            <p className="font-medium text-white">{s.serviceName}</p>
          </div>
          {s.specialistName ? (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Специалист
              </p>
              <p className="font-medium text-white">{s.specialistName}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Оплата
            </p>
            <p className="font-medium text-white">
              {s.paymentType === 'QUOTA'
                ? s.packageName
                  ? `Списано из «${s.packageName}»`
                  : 'По абонементу'
                : s.priceLabel
                  ? `К оплате на ресепшене · ${s.priceLabel}`
                  : 'К оплате на ресепшене'}
            </p>
            {s.paymentType === 'QUOTA' && s.quotaRemaining !== undefined ? (
              <p className="mt-1 text-sm text-forma-300">
                Осталось: {s.quotaRemaining}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Link href="/client/bookings" className="btn-primary text-center">
            Мои записи
          </Link>
          <Link href="/client" className="btn-secondary text-center">
            На главную
          </Link>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => spa.resetBookingSuccess()}
          >
            Записаться ещё
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StepRail active={activeStep} doneService={doneService} />

      {spa.forcedQuota ? (
        <p className="text-sm text-zinc-400">
          Запись по абонементу: {spa.membershipServiceName}
        </p>
      ) : null}

      {spa.message && !spa.selectedServiceId ? (
        <p className="rounded-xl bg-forma-500/10 px-3 py-2 text-sm text-forma-400">
          {spa.message}
        </p>
      ) : null}

      {spa.services.length === 0 ? (
        <EmptyState
          icon={<Flower2 className="h-6 w-6" />}
          title="Нет доступных услуг"
          description="Обратитесь на ресепшен или выберите другое направление"
        />
      ) : (
        <>
          {!spa.forcedQuota &&
          !spa.selectedServiceId &&
          spa.quotaShortcuts.length > 0 ? (
            <div className="space-y-2">
              <h3 className="font-medium text-white">По вашему абонементу</h3>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {spa.quotaShortcuts.map((item) => (
                  <button
                    key={item.service.id}
                    type="button"
                    onClick={() => {
                      spa.pickCategory(
                        // category via pick then service
                        spa.categories.find((c) =>
                          c.items.some((i) => i.service.id === item.service.id),
                        )?.name ?? item.service.name,
                      );
                      spa.pickService(item);
                      setEditStep(null);
                    }}
                    className="min-w-[9.5rem] shrink-0 rounded-2xl border border-forma-500/40 bg-forma-500/15 px-3 py-3 text-left touch-manipulation"
                  >
                    <p className="line-clamp-2 text-sm font-semibold text-white">
                      {item.service.name}
                    </p>
                    <p className="mt-1 text-xs text-forma-300">
                      {item.quotaRemaining !== undefined
                        ? `Осталось ${item.quotaRemaining}`
                        : 'По абонементу'}
                      {item.packageName ? ` · ${item.packageName}` : ''}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {doneCategory ? (
            <StepSummary
              label="Направление"
              value={spa.selectedCategory!}
              onEdit={() => setEditStep('category')}
            />
          ) : (
            <div className="space-y-2">
              <h3 className="font-medium text-white">Направление</h3>
              <div className="grid grid-cols-2 gap-2">
                {spa.categories.map((cat) => {
                  const active = cat.name === spa.selectedCategory;
                  const minPrice = Math.min(
                    ...cat.items.map((i) => i.service.priceMinor),
                  );
                  const currency = cat.items[0]?.service.currency ?? 'BYN';
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => {
                        spa.pickCategory(cat.name);
                        setEditStep(null);
                      }}
                      className={`rounded-2xl border px-3 py-3 text-left transition touch-manipulation ${
                        active
                          ? 'border-forma-500 bg-forma-500 text-ink'
                          : cat.quota
                            ? 'border-forma-500/50 bg-ink-elevated text-zinc-200'
                            : 'border-white/10 bg-ink-elevated text-zinc-300 hover:border-white/20'
                      }`}
                    >
                      <span
                        className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${
                          active
                            ? 'bg-ink/15 text-ink'
                            : 'bg-forma-500/15 text-forma-400'
                        }`}
                      >
                        {categoryIcon(cat.name)}
                      </span>
                      <span className="block text-sm font-semibold leading-tight">
                        {cat.name}
                      </span>
                      <span
                        className={`mt-1 block text-[11px] ${
                          active ? 'text-ink/70' : 'text-zinc-500'
                        }`}
                      >
                        {cat.items.length}{' '}
                        {cat.items.length === 1 ? 'вид' : 'вида'} · от{' '}
                        {formatPrice(minPrice, currency)}
                      </span>
                      {cat.quota ? (
                        <span
                          className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            active
                              ? 'bg-ink/15 text-ink'
                              : 'bg-forma-500/20 text-forma-300'
                          }`}
                        >
                          По абонементу
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {spa.selectedCategory ? (
            doneService ? (
              <StepSummary
                label="Услуга"
                value={serviceSummary}
                onEdit={() => setEditStep('service')}
              />
            ) : spa.activeCategory ? (
              <div className="space-y-2">
                <h3 className="font-medium text-white">Вид услуги</h3>
                <ul className="space-y-2">
                  {spa.activeCategory.items.map((item) => {
                    const active = item.service.id === spa.selectedServiceId;
                    return (
                      <li key={item.service.id}>
                        <button
                          type="button"
                          onClick={() => {
                            spa.pickService(item);
                            setEditStep(null);
                          }}
                          className={`card w-full text-left touch-manipulation ${
                            active ? 'ring-2 ring-forma-500' : ''
                          }`}
                        >
                          <p className="font-medium text-white">
                            {item.service.name}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Chip className="!px-2 !py-0.5 text-xs">
                              {item.service.durationMin} мин
                            </Chip>
                            <Chip className="!px-2 !py-0.5 text-xs">
                              {formatPrice(
                                item.service.priceMinor,
                                item.service.currency,
                              )}
                            </Chip>
                            {item.quotaAvailable ? (
                              <Chip className="!border-forma-500/40 !bg-forma-500/15 !px-2 !py-0.5 text-xs !text-forma-300">
                                {item.packageName
                                  ? `из ${item.packageName}`
                                  : 'По абонементу'}
                                {item.quotaRemaining !== undefined
                                  ? ` · ${item.quotaRemaining}`
                                  : ''}
                              </Chip>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null
          ) : null}

          {paymentSummaryVisible ? (
            <StepSummary
              label="Оплата"
              value={paymentSummary}
              onEdit={() => setEditStep('payment')}
            />
          ) : null}
          {paymentEditorVisible ? (
            <div className="space-y-2">
              <h3 className="font-medium text-white">Оплата</h3>
              <SegmentedControl
                value={spa.paymentType}
                onChange={(v) => {
                  spa.setPaymentType(v);
                  setEditStep(null);
                }}
                options={[
                  { value: 'QUOTA' as const, label: 'По абонементу' },
                  { value: 'PAID' as const, label: 'Платно' },
                ]}
              />
            </div>
          ) : null}

          {spa.selectedServiceId && spa.specialists.length > 0 ? (
            showSpecialistEditor ? (
              <div className="space-y-2">
                <h3 className="font-medium text-white">Специалист</h3>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      spa.setSpecialistFilter('ALL');
                      setEditStep(null);
                    }}
                    className={`flex w-20 shrink-0 flex-col items-center rounded-2xl border px-2 py-3 text-center text-xs ${
                      spa.specialistFilter === 'ALL'
                        ? 'border-forma-500 bg-forma-500/15 text-white'
                        : 'border-white/10 bg-ink-elevated text-zinc-300'
                    }`}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
                      ✦
                    </span>
                    <span className="mt-2 font-semibold">Любой</span>
                  </button>
                  {spa.specialists.map((sp) => {
                    const name = `${sp.firstName} ${sp.lastName}`.trim();
                    const active = spa.specialistFilter === sp.id;
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => {
                          spa.setSpecialistFilter(sp.id);
                          setEditStep(null);
                        }}
                        className={`flex w-24 shrink-0 flex-col items-center rounded-2xl border px-2 py-3 text-center text-xs ${
                          active
                            ? 'border-forma-500 bg-forma-500/15 text-white'
                            : 'border-white/10 bg-ink-elevated text-zinc-300'
                        }`}
                      >
                        <Avatar name={name} size="md" />
                        <span className="mt-2 line-clamp-2 font-semibold">
                          {sp.firstName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : showSpecialistSummary ? (
              <StepSummary
                label="Специалист"
                value={specialistSummary}
                onEdit={() => setEditStep('specialist')}
              />
            ) : null
          ) : null}

          {spa.selectedServiceId ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-white">Дата и время</h3>
                {spa.availableDays.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarMonth(
                        (spa.selectedDate ?? spa.dateMin).slice(0, 7),
                      );
                      setCalendarOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-raised px-3 py-1.5 text-xs font-medium text-zinc-300 touch-manipulation hover:text-white"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Календарь
                  </button>
                ) : null}
              </div>

              {spa.message ? (
                <p
                  className={`rounded-xl px-3 py-2 text-sm ${
                    /ошибк|недоступ|не удалось|нет /i.test(spa.message)
                      ? 'bg-rose-500/10 text-rose-300'
                      : 'bg-forma-500/10 text-forma-300'
                  }`}
                >
                  {spa.message}
                </p>
              ) : null}

              {spa.specialists.length === 0 ? (
                <EmptyState
                  icon={<Flower2 className="h-6 w-6" />}
                  title="Нет специалистов"
                  description="Для этой услуги пока нет расписания"
                />
              ) : spa.loadingSlots ? (
                <SkeletonCard />
              ) : spa.availableDays.length === 0 ? (
                <div className="card space-y-3 text-center">
                  <EmptyState
                    icon={<CalendarDays className="h-6 w-6" />}
                    title="Нет свободных слотов"
                    description="На ближайшие две недели всё занято"
                    className="!border-0 !bg-transparent !p-0 !shadow-none"
                  />
                  {spa.specialistFilter !== 'ALL' ? (
                    <div className="space-y-3 text-left">
                      <p className="text-sm text-zinc-300">
                        Можно встать в лист ожидания
                      </p>
                      <WaitlistTimePills
                        value={spa.waitlistDesiredTime}
                        onChange={spa.setWaitlistDesiredTime}
                      />
                      <Button
                        variant="secondary"
                        className="w-full"
                        disabled={spa.waitlistBusy}
                        loading={spa.waitlistBusy}
                        onClick={() => {
                          void spa.joinWaitlistForDesiredTime(
                            spa.selectedDate ?? todayKey(),
                          );
                        }}
                      >
                        В лист ожидания
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">
                      Выберите специалиста выше, чтобы встать в лист ожидания
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <DateStrip
                    days={dateStripDays}
                    value={spa.selectedDate}
                    onChange={(key) => {
                      spa.setSelectedDate(key);
                      spa.setMessage('');
                    }}
                  />

                  {spa.daySlots.length === 0 ? (
                    <div className="card space-y-3 text-center">
                      <EmptyState
                        title="На этот день нет времени"
                        description={
                          spa.specialistFilter === 'ALL'
                            ? 'Выберите специалиста, чтобы встать в лист ожидания'
                            : undefined
                        }
                        className="!border-0 !bg-transparent !p-0 !shadow-none"
                      />
                      {spa.specialistFilter !== 'ALL' ? (
                        <div className="space-y-3 text-left">
                          <WaitlistTimePills
                            value={spa.waitlistDesiredTime}
                            onChange={spa.setWaitlistDesiredTime}
                          />
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={spa.waitlistBusy}
                            loading={spa.waitlistBusy}
                            onClick={() =>
                              void spa.joinWaitlistForDesiredTime()
                            }
                          >
                            В лист ожидания
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {slotGroups.map((group) => (
                        <div key={group.key} className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {group.items.map((slot) => {
                              const key = `${slot.specialistId}:${slot.startAt}`;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  disabled={spa.bookingKey === key}
                                  onClick={() => spa.requestBook(slot)}
                                  className="rounded-2xl border border-white/10 bg-ink-elevated px-2 py-3 text-center touch-manipulation hover:border-forma-500 disabled:opacity-50"
                                >
                                  <span className="block font-display text-base font-bold text-white">
                                    {timeFmt.format(new Date(slot.startAt))}
                                  </span>
                                  {spa.specialistFilter === 'ALL' &&
                                  spa.specialists.length > 1 ? (
                                    <span className="mt-1 flex items-center justify-center gap-1 text-[11px] text-zinc-500">
                                      <Avatar
                                        name={slot.specialistName}
                                        size="sm"
                                        className="!h-5 !w-5 !text-[8px]"
                                      />
                                      {slot.specialistName.split(' ')[0]}
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {spa.joinedWaitlistIds.length > 0 ? (
                    <p className="text-xs text-forma-300">
                      Заявок в листе ожидания: {spa.joinedWaitlistIds.length}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      )}

      <Sheet
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        title="Календарь"
        description="Дни со слотами подсвечены"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const [y, m] = calendarMonth.split('-').map(Number);
                const d = new Date(y, m - 2, 1);
                setCalendarMonth(
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                );
              }}
            >
              ←
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const [y, m] = calendarMonth.split('-').map(Number);
                const d = new Date(y, m, 1);
                setCalendarMonth(
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                );
              }}
            >
              →
            </Button>
          </div>
          <MonthCalendar
            monthKey={calendarMonth}
            selected={spa.selectedDate}
            available={availableSet}
            onSelect={(key) => {
              spa.jumpToDate(key);
              setCalendarOpen(false);
            }}
          />
        </div>
      </Sheet>

      <Sheet
        open={spa.pendingSlot != null}
        onOpenChange={(open) => {
          if (!open) spa.setPendingSlot(null);
        }}
        title="Подтверждение записи"
        description={
          spa.pendingSlot
            ? dateTimeFmt.format(new Date(spa.pendingSlot.startAt))
            : undefined
        }
      >
        {spa.pendingSlot && spa.selectedEligibility ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-2xl bg-ink-raised px-4 py-3 text-sm">
              <p>
                <span className="text-zinc-500">Услуга · </span>
                <span className="text-white">
                  {spa.selectedEligibility.service.name}
                </span>
              </p>
              <p>
                <span className="text-zinc-500">Специалист · </span>
                <span className="text-white">
                  {spa.pendingSlot.specialistName || 'Любой'}
                </span>
              </p>
              <p>
                <span className="text-zinc-500">Оплата · </span>
                <span className="text-white">
                  {spa.paymentType === 'QUOTA' &&
                  spa.selectedEligibility.quotaAvailable
                    ? spa.selectedEligibility.packageName
                      ? `Спишется 1 из «${spa.selectedEligibility.packageName}»`
                      : 'По абонементу'
                    : formatPrice(
                        spa.selectedEligibility.service.priceMinor,
                        spa.selectedEligibility.service.currency,
                      )}
                </span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => spa.setPendingSlot(null)}
              >
                Отмена
              </Button>
              <Button
                className="flex-1"
                loading={spa.bookingKey != null}
                disabled={spa.bookingKey != null}
                onClick={() => {
                  if (!spa.pendingSlot) return;
                  void spa.handleBook(spa.pendingSlot);
                }}
              >
                Записаться
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={spa.waitlistOffer != null}
        onOpenChange={(open) => {
          if (!open) spa.setWaitlistOffer(null);
        }}
        title="Слот занят"
        description={
          spa.waitlistOffer
            ? `${timeFmt.format(new Date(spa.waitlistOffer.startAt))}${
                spa.waitlistOffer.specialistName
                  ? ` · ${spa.waitlistOffer.specialistName}`
                  : ''
              }`
            : undefined
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Встать в лист ожидания на это время?
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => spa.setWaitlistOffer(null)}
            >
              Нет
            </Button>
            <Button
              className="flex-1"
              loading={spa.waitlistBusy}
              disabled={spa.waitlistBusy || !spa.waitlistOffer}
              onClick={() => {
                if (!spa.waitlistOffer) return;
                void spa.joinWaitlist({
                  specialistId: spa.waitlistOffer.specialistId,
                  startAt: spa.waitlistOffer.startAt,
                });
              }}
            >
              В лист ожидания
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
