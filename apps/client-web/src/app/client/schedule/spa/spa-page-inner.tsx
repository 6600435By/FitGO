'use client';

import { CalendarDays, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { DateStrip, type DateStripDay } from '@/components/forma/date-strip';
import { SegmentedControl } from '@/components/forma/segmented-control';
import { Sheet } from '@/components/forma/sheet';
import { SkeletonCard } from '@/components/forma/skeleton';
import {
  formatPrice,
  todayKey,
  useSpaBooking,
  WAITLIST_TIME_PILLS,
} from './use-spa-booking';

const timeFmt = new Intl.DateTimeFormat('ru-RU', {
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

  if (spa.loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      {spa.membership ? (
        <p className="text-xs text-zinc-500">
          Абонемент обновлён
          {spa.membership.services
            ?.filter((s) => /массаж|состав/i.test(s.name))
            .map((s) => ` · ${s.name}: ${s.remaining ?? '∞'}`)
            .join('') ?? ''}
        </p>
      ) : null}

      {spa.services.length === 0 ? (
        <div className="card text-center text-zinc-400">Нет доступных услуг</div>
      ) : (
        <>
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
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => {
                        spa.pickCategory(cat.name);
                        setEditStep(null);
                      }}
                      className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                        active
                          ? 'border-forma-500 bg-forma-500/15 text-white'
                          : 'border-white/10 bg-ink-elevated text-zinc-300 hover:border-white/20'
                      }`}
                    >
                      <span className="block font-medium leading-tight">
                        {cat.name}
                      </span>
                      {cat.quota ? (
                        <span className="mt-1 block text-xs text-forma-300">
                          Есть по абонементу
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
                          className={`card w-full text-left ${
                            active ? 'ring-2 ring-forma-500' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{item.service.name}</p>
                              <p className="text-sm text-zinc-400">
                                {item.service.durationMin} мин
                              </p>
                            </div>
                            <div className="text-right text-sm">
                              {item.quotaAvailable ? (
                                <p className="text-forma-300">
                                  По абонементу
                                  {item.quotaRemaining !== undefined
                                    ? ` (${item.quotaRemaining})`
                                    : ''}
                                </p>
                              ) : null}
                              <p className="text-zinc-300">
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
                <div className="card text-center text-zinc-400">
                  Нет специалистов с расписанием для этой услуги
                </div>
              ) : spa.loadingSlots ? (
                <SkeletonCard />
              ) : spa.availableDays.length === 0 ? (
                <div className="card space-y-3 text-center text-zinc-400">
                  <p>Нет свободных слотов на ближайшие две недели</p>
                  {spa.specialistFilter !== 'ALL' ? (
                    <div className="space-y-3 text-left">
                      <p className="text-sm text-zinc-300">
                        Можно встать в лист ожидания на нужное время
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
                    <p className="text-xs">
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
                    <div className="card space-y-3 text-center text-zinc-400">
                      <p>На этот день нет свободного времени</p>
                      {spa.specialistFilter !== 'ALL' ? (
                        <div className="space-y-3 text-left">
                          <p className="text-sm text-zinc-300">Желаемое время</p>
                          <WaitlistTimePills
                            value={spa.waitlistDesiredTime}
                            onChange={spa.setWaitlistDesiredTime}
                          />
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={spa.waitlistBusy}
                            loading={spa.waitlistBusy}
                            onClick={() => void spa.joinWaitlistForDesiredTime()}
                          >
                            В лист ожидания
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs">
                          Выберите специалиста, чтобы встать в лист ожидания
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {spa.daySlots.map((slot) => {
                        const key = `${slot.specialistId}:${slot.startAt}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={spa.bookingKey === key}
                            onClick={() => void spa.handleBook(slot)}
                            className="rounded-xl border border-white/10 bg-ink-elevated px-2 py-2.5 text-center text-sm touch-manipulation hover:border-forma-500 disabled:opacity-50"
                          >
                            <span className="block font-medium">
                              {timeFmt.format(new Date(slot.startAt))}
                            </span>
                            {spa.specialistFilter === 'ALL' &&
                            spa.specialists.length > 1 ? (
                              <span className="block text-[11px] text-zinc-500">
                                {slot.specialistName.split(' ')[0]}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
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
