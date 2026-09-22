'use client';

import {
  DEFAULT_PT_TIERS,
  DEFAULT_SPA_QUOTA_RATES,
  defaultPayProfile,
  type StaffPayProfile,
  type StaffPayTrack,
} from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const TRACKS: { id: StaffPayTrack; label: string }[] = [
  { id: 'ADMIN', label: 'Админ (часы + % продаж)' },
  { id: 'GROUP_TRAINER', label: 'Групповой тренер' },
  { id: 'SPA', label: 'SPA-специалист' },
  { id: 'PT', label: 'Персональный тренер' },
];

type Props = {
  userId: string;
  suggestedTrack?: StaffPayTrack;
};

export function StaffPayProfileEditor({ userId, suggestedTrack }: Props) {
  const [profile, setProfile] = useState<StaffPayProfile>(
    defaultPayProfile(suggestedTrack ?? 'PT'),
  );
  const [baseSalary, setBaseSalary] = useState('0');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .payrollStaffProfile(token, userId)
      .then((row) => {
        if (row?.payProfile) setProfile(row.payProfile);
        else if (suggestedTrack) setProfile(defaultPayProfile(suggestedTrack));
        if (row) setBaseSalary(String(row.baseSalaryMinor / 100));
      })
      .catch(() => {
        if (suggestedTrack) setProfile(defaultPayProfile(suggestedTrack));
      });
  }, [userId, suggestedTrack]);

  const setTrack = (track: StaffPayTrack) => {
    setProfile((prev) => ({ ...defaultPayProfile(track), notes: prev.notes }));
  };

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setMessage('');
    try {
      await api.payrollSaveStaffProfile(token, userId, {
        baseSalaryMinor: Math.round(Number(baseSalary || 0) * 100),
        payProfile: profile,
      });
      setMessage('Мотивация сохранена');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 md:p-5">
      <div>
        <h3 className="text-lg font-semibold text-white">Мотивация и ставки</h3>
        <p className="mt-1 text-sm text-slate-400">
          Здесь задаётся схема ЗП сотрудника. Расчёт периода — во вкладке ЗП.
        </p>
      </div>

      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Схема
        <select
          className="input mt-1.5 w-full"
          value={profile.track}
          onChange={(e) => setTrack(e.target.value as StaffPayTrack)}
        >
          {TRACKS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Оклад / база (мес.), BYN
        <input
          className="input mt-1.5 w-full"
          inputMode="decimal"
          value={baseSalary}
          onChange={(e) => setBaseSalary(e.target.value)}
        />
      </label>

      {profile.track === 'ADMIN' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            ЗП = ставка за часы + % от продаж абонементов + % от доп. услуг.
            Премии и штрафы добавляются в ЗП как корректировки.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Ставка за час, BYN"
              value={String((profile.hourlyRateMinor ?? 0) / 100)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  hourlyRateMinor: Math.round(Number(v || 0) * 100),
                })
              }
            />
            <Field
              label="% от продаж абонементов"
              value={String(profile.membershipSalesPercent ?? 0)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  membershipSalesPercent: Number(v || 0),
                })
              }
            />
            <Field
              label="% от доп. услуг"
              value={String(profile.extraSalesPercent ?? 0)}
              onChange={(v) =>
                setProfile({ ...profile, extraSalesPercent: Number(v || 0) })
              }
            />
          </div>
        </div>
      )}

      {profile.track === 'GROUP_TRAINER' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Ставка за проведённое занятие, если пришло не меньше минимума
            человек. Опционально — доплата за каждого.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Ставка за занятие, BYN"
              value={String((profile.groupSessionRateMinor ?? 0) / 100)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  groupSessionRateMinor: Math.round(Number(v || 0) * 100),
                })
              }
            />
            <Field
              label="Мин. человек"
              value={String(profile.groupMinAttendees ?? 1)}
              onChange={(v) =>
                setProfile({ ...profile, groupMinAttendees: Number(v || 1) })
              }
            />
            <Field
              label="+ за человека, BYN"
              value={String((profile.groupPerAttendeeMinor ?? 0) / 100)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  groupPerAttendeeMinor: Math.round(Number(v || 0) * 100),
                })
              }
            />
          </div>
        </div>
      )}

      {profile.track === 'SPA' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            % от проданных и оказанных платных услуг + фиксированная ставка за
            услуги из абонемента (анализ состава тела, массаж классический).
          </p>
          <Field
            label="% от проданных / оказанных платных услуг"
            value={String(profile.spaSoldPercent ?? 0)}
            onChange={(v) =>
              setProfile({ ...profile, spaSoldPercent: Number(v || 0) })
            }
          />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Ставка за услугу из абонемента
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(profile.spaQuotaRates ?? DEFAULT_SPA_QUOTA_RATES).map((r, i) => (
              <Field
                key={r.serviceKey}
                label={r.label}
                value={String(r.rateMinor / 100)}
                onChange={(v) => {
                  const next = [
                    ...(profile.spaQuotaRates ?? DEFAULT_SPA_QUOTA_RATES),
                  ];
                  next[i] = {
                    ...next[i],
                    rateMinor: Math.round(Number(v || 0) * 100),
                  };
                  setProfile({ ...profile, spaQuotaRates: next });
                }}
              />
            ))}
          </div>
        </div>
      )}

      {profile.track === 'PT' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            % от оплаченной и проведённой ПТ. Подарочные идут в счёт количества
            за месяц, но не оплачиваются. Пороги — календарный месяц. Часы смены
            оплачиваются отдельно по ставке.
          </p>
          <Field
            label="Ставка за час смены, BYN"
            value={String((profile.hourlyRateMinor ?? 0) / 100)}
            onChange={(v) =>
              setProfile({
                ...profile,
                hourlyRateMinor: Math.round(Number(v || 0) * 100),
              })
            }
          />
          <Field
            label="Стоимость ПТ для расчёта, BYN"
            value={String((profile.ptSessionPriceMinor ?? 0) / 100)}
            onChange={(v) =>
              setProfile({
                ...profile,
                ptSessionPriceMinor: Math.round(Number(v || 0) * 100),
              })
            }
          />
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Ступени %
            </p>
            {(profile.ptPercentTiers ?? DEFAULT_PT_TIERS).map((t, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <Field
                  label="От N тренировок"
                  value={String(t.minSessions)}
                  onChange={(v) => {
                    const next = [...(profile.ptPercentTiers ?? DEFAULT_PT_TIERS)];
                    next[i] = { ...next[i], minSessions: Number(v || 0) };
                    setProfile({ ...profile, ptPercentTiers: next });
                  }}
                />
                <Field
                  label="% оплаты"
                  value={String(t.percent)}
                  onChange={(v) => {
                    const next = [...(profile.ptPercentTiers ?? DEFAULT_PT_TIERS)];
                    next[i] = { ...next[i], percent: Number(v || 0) };
                    setProfile({ ...profile, ptPercentTiers: next });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn-primary w-full sm:w-auto"
        disabled={saving}
        onClick={save}
      >
        {saving ? 'Сохранение…' : 'Сохранить мотивацию'}
      </button>
      {message && <p className="text-sm text-fitgo-300">{message}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <input
        className="input mt-1 w-full"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
