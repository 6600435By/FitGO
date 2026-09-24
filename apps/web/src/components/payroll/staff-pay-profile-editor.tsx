'use client';

import {
  DEFAULT_PT_TIERS,
  DEFAULT_SPA_QUOTA_RATES,
  defaultPayProfile,
  departmentsForPayTrack,
  formatMinor,
  formatPercent,
  packPayProfile,
  parseDecimal,
  parseMoneyToMinor,
  sliceForTrack,
  type StaffPayProfile,
  type StaffPayTrack,
  type StaffPayTrackSlice,
} from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const TRACKS: { id: StaffPayTrack; label: string }[] = [
  { id: 'ADMIN', label: 'Админ (часы + % продаж)' },
  { id: 'GROUP_TRAINER', label: 'Групповой тренер' },
  { id: 'SPA', label: 'SPA-специалист' },
  { id: 'TECH', label: 'Техперсонал (часы)' },
  { id: 'PT', label: 'Персональный тренер' },
];

type Props = {
  userId: string;
  roles?: UserRole[];
  suggestedTrack?: StaffPayTrack;
};

function tracksForRoles(roles: UserRole[] | undefined): StaffPayTrack[] {
  if (!roles?.length) return TRACKS.map((t) => t.id);
  const out: StaffPayTrack[] = [];
  if (roles.includes(UserRole.ADMIN)) out.push('ADMIN');
  if (roles.includes(UserRole.TRAINER)) out.push('PT', 'GROUP_TRAINER');
  if (roles.includes(UserRole.SPECIALIST)) out.push('SPA');
  if (roles.includes(UserRole.TECH)) out.push('TECH');
  return out.length ? out : TRACKS.map((t) => t.id);
}

export function StaffPayProfileEditor({ userId, roles, suggestedTrack }: Props) {
  const allowed = useMemo(() => tracksForRoles(roles), [roles]);
  const [profile, setProfile] = useState<StaffPayTrackSlice>(
    defaultPayProfile(suggestedTrack && allowed.includes(suggestedTrack)
      ? suggestedTrack
      : allowed[0] ?? 'PT'),
  );
  const [byTrack, setByTrack] = useState<
    Partial<Record<StaffPayTrack, StaffPayTrackSlice>>
  >({});
  const [baseSalary, setBaseSalary] = useState('0');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const profileRef = useRef(profile);
  const byTrackRef = useRef(byTrack);
  const baseSalaryRef = useRef(baseSalary);
  profileRef.current = profile;
  byTrackRef.current = byTrack;
  baseSalaryRef.current = baseSalary;

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .payrollStaffProfile(token, userId)
      .then((row) => {
        if (row?.payProfile) {
          const packed = row.payProfile;
          const track =
            packed.track && allowed.includes(packed.track)
              ? packed.track
              : allowed[0] ?? packed.track;
          const map: Partial<Record<StaffPayTrack, StaffPayTrackSlice>> = {
            ...(packed.byTrack ?? {}),
          };
          for (const t of Object.keys(map) as StaffPayTrack[]) {
            map[t] = { ...map[t]!, track: t };
          }
          map[packed.track] = sliceForTrack(packed, packed.track);
          setByTrack(map);
          setProfile(sliceForTrack({ ...packed, byTrack: map }, track));
        } else if (suggestedTrack && allowed.includes(suggestedTrack)) {
          setProfile(defaultPayProfile(suggestedTrack));
          setByTrack({});
        } else if (allowed[0]) {
          setProfile(defaultPayProfile(allowed[0]));
          setByTrack({});
        }
        if (row) setBaseSalary(formatMinor(row.baseSalaryMinor));
      })
      .catch(() => {
        if (suggestedTrack && allowed.includes(suggestedTrack)) {
          setProfile(defaultPayProfile(suggestedTrack));
        }
      });
  }, [userId, suggestedTrack, allowed]);

  const switchTrack = (track: StaffPayTrack) => {
    setByTrack((prev) => ({ ...prev, [profile.track]: profile }));
    setProfile((prev) => {
      const saved = byTrack[track] ?? sliceForTrack(
        packPayProfile(prev, { ...byTrack, [prev.track]: prev }),
        track,
      );
      return { ...saved, track };
    });
  };

  const flushDrafts = () => {
    flushSync(() => {
      if (typeof document !== 'undefined') {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    });
  };

  const save = async () => {
    const token = getToken();
    if (!token) return;
    flushDrafts();
    setSaving(true);
    setMessage('');
    try {
      const payProfile = packPayProfile(
        profileRef.current,
        byTrackRef.current,
      );
      await api.payrollSaveStaffProfile(token, userId, {
        baseSalaryMinor: parseMoneyToMinor(baseSalaryRef.current),
        payProfile,
      });
      setByTrack(payProfile.byTrack ?? {});
      setMessage('Мотивация сохранена');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const copyToDepartment = async () => {
    const token = getToken();
    if (!token) return;
    flushDrafts();
    const current = profileRef.current;
    const depts = departmentsForPayTrack(current.track);
    const label =
      current.track === 'ADMIN'
        ? 'администраторам'
        : current.track === 'SPA'
          ? 'SPA-специалистам'
          : current.track === 'TECH'
            ? 'техперсоналу'
            : 'тренерам';
    if (
      !window.confirm(
        `Скопировать текущую схему «${TRACKS.find((t) => t.id === current.track)?.label}» и оклад всем ${label}? У них перезапишется мотивация этой схемы.`,
      )
    ) {
      return;
    }
    setCopying(true);
    setMessage('');
    try {
      const payProfile = packPayProfile(current, byTrackRef.current);
      await api.payrollSaveStaffProfile(token, userId, {
        baseSalaryMinor: parseMoneyToMinor(baseSalaryRef.current),
        payProfile,
      });
      setByTrack(payProfile.byTrack ?? {});
      const result = await api.payrollCopyStaffProfile(token, userId, {
        departments: depts.filter(
          (d): d is 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH' =>
            d !== 'EXTERNAL',
        ),
        tracks: [current.track],
      });
      setMessage(`Скопировано сотрудникам: ${result.copied}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка копирования');
    } finally {
      setCopying(false);
    }
  };

  const visibleTracks = TRACKS.filter((t) => allowed.includes(t.id));

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 md:p-5">
      <div>
        <h3 className="text-lg font-semibold text-white">Мотивация и ставки</h3>
        <p className="mt-1 text-sm text-slate-400">
          Можно задать несколько схем, если сотрудник в нескольких подразделениях.
          Дробные ставки — через точку или запятую (например 2,5).
        </p>
      </div>

      {visibleTracks.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {visibleTracks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTrack(t.id)}
              className={
                profile.track === t.id
                  ? 'btn-primary px-3 py-1.5 text-sm'
                  : 'btn-secondary px-3 py-1.5 text-sm'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {visibleTracks.length <= 1 && (
        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
          Схема
          <select
            className="input mt-1.5 w-full"
            value={profile.track}
            onChange={(e) => switchTrack(e.target.value as StaffPayTrack)}
          >
            {TRACKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <MoneyField label="Оклад / база (мес.), BYN" value={baseSalary} onChange={setBaseSalary} />

      {profile.track === 'ADMIN' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            ЗП = ставка за часы (админы) или оклад (управляющая) + % оплаченных
            продаж: абонементы, массаж/солярий и магазин отдельно. Неоплаченные
            видны в «Мои продажи», в ЗП — после оплаты в месяц оплаты.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MoneyField
              label="Ставка за час, BYN"
              value={formatMinor(profile.hourlyRateMinor)}
              onChange={(v) =>
                setProfile({ ...profile, hourlyRateMinor: parseMoneyToMinor(v) })
              }
            />
            <PercentField
              label="% абонементы и КП"
              value={formatPercent(profile.membershipSalesPercent)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  membershipSalesPercent: parseDecimal(v),
                })
              }
            />
            <label className="block space-y-1 text-sm">
              <span className="text-slate-400">Абонементы засчитывать</span>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
                value={profile.membershipSalesAttribution ?? 'individual'}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    membershipSalesAttribution:
                      e.target.value === 'shiftShare'
                        ? 'shiftShare'
                        : 'individual',
                  })
                }
              >
                <option value="individual">Тому, кто продал (автор 1С)</option>
                <option value="shiftShare">
                  По графику смены в FitGO
                </option>
              </select>
              <span className="block text-xs text-slate-500">
                «По графику»: сумма абонемента делится на админов из графика в
                день продажи (1 — целиком, 2+ — поровну). Автор из 1С только в
                списке.
              </span>
            </label>
            <PercentField
              label="% массаж и солярий"
              value={formatPercent(profile.extraSalesPercent)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  extraSalesPercent: parseDecimal(v),
                })
              }
            />
            <PercentField
              label="% магазина"
              value={formatPercent(profile.shopSalesPercent)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  shopSalesPercent: parseDecimal(v),
                })
              }
            />
            {parseMoneyToMinor(baseSalary) > 0 && (
              <PercentField
                label="% корпо (р/с вручную)"
                value={formatPercent(profile.corporateSalesPercent)}
                onChange={(v) =>
                  setProfile({
                    ...profile,
                    corporateSalesPercent: parseDecimal(v),
                  })
                }
              />
            )}
            <MoneyField
              label="Фикс аванс 25-е, BYN"
              value={formatMinor(profile.fixedAdvanceMinor)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  fixedAdvanceMinor: parseMoneyToMinor(v),
                })
              }
            />
          </div>
        </div>
      )}

      {profile.track === 'GROUP_TRAINER' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Ставка за занятие по залу из расписания и числу людей. Клубные
            дефолты: малый 3–5→25 / 6–8→30 / 9–10→35; большой 3–5→25 / 6–9→30 /
            10–14→35 / 15+→40. Ниже — legacy без зала.
          </p>
          <MoneyField
            label="Ставка за час смены, BYN"
            value={formatMinor(profile.hourlyRateMinor)}
            onChange={(v) =>
              setProfile({ ...profile, hourlyRateMinor: parseMoneyToMinor(v) })
            }
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyField
              label="Ставка за занятие (fallback), BYN"
              value={formatMinor(profile.groupSessionRateMinor)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  groupSessionRateMinor: parseMoneyToMinor(v),
                })
              }
            />
            <IntField
              label="Мин. человек (fallback)"
              value={String(profile.groupMinAttendees ?? 1)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  groupMinAttendees: Math.max(
                    0,
                    Math.round(parseDecimal(v) || 1),
                  ),
                })
              }
            />
            <MoneyField
              label="+ за человека, BYN"
              value={formatMinor(profile.groupPerAttendeeMinor)}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  groupPerAttendeeMinor: parseMoneyToMinor(v),
                })
              }
            />
          </div>
          <p className="text-xs text-slate-500">
            Тиры залов в профиле: {profile.groupRateTiers?.length ?? 0} (дефолты
            клуба подставляются при новой схеме GROUP).
          </p>
        </div>
      )}

      {profile.track === 'SPA' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            % от оплаченных услуг + фикс из абонемента + фикс AllSports (метка на
            записи SPA).
          </p>
          <PercentField
            label="% от проведённых / оплаченных платных услуг"
            value={formatPercent(profile.spaSoldPercent)}
            onChange={(v) =>
              setProfile({ ...profile, spaSoldPercent: parseDecimal(v) })
            }
          />
          <MoneyField
            label="Ставка AllSports / партнёр, BYN"
            value={formatMinor(profile.spaPartnerRateMinor)}
            onChange={(v) =>
              setProfile({
                ...profile,
                spaPartnerRateMinor: parseMoneyToMinor(v),
              })
            }
          />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Ставка за услугу из абонемента
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(profile.spaQuotaRates ?? DEFAULT_SPA_QUOTA_RATES).map((r, i) => (
              <MoneyField
                key={r.serviceKey}
                label={r.label}
                value={formatMinor(r.rateMinor)}
                onChange={(v) => {
                  const next = [
                    ...(profile.spaQuotaRates ?? DEFAULT_SPA_QUOTA_RATES),
                  ];
                  next[i] = { ...next[i], rateMinor: parseMoneyToMinor(v) };
                  setProfile({ ...profile, spaQuotaRates: next });
                }}
              />
            ))}
          </div>
        </div>
      )}

      {profile.track === 'TECH' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Оплата по часам смены из графика. Премии и штрафы — отдельными
            корректировками в разделе расчёта ЗП (не в этой схеме).
          </p>
          <MoneyField
            label="Ставка за час, BYN"
            value={formatMinor(profile.hourlyRateMinor)}
            onChange={(v) =>
              setProfile({ ...profile, hourlyRateMinor: parseMoneyToMinor(v) })
            }
          />
        </div>
      )}

      {profile.track === 'PT' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            % от оплаченной ПТ. Подарочные идут в количество, но не в оплату.
            Часы дежурства — по ставке за час. Штатные: 25-го — фикс аванс;
            15-го — остаток (часть на карту, остальное из кассы).
          </p>
          <MoneyField
            label="Ставка за час смены, BYN"
            value={formatMinor(profile.hourlyRateMinor)}
            onChange={(v) =>
              setProfile({ ...profile, hourlyRateMinor: parseMoneyToMinor(v) })
            }
          />
          <MoneyField
            label="Фикс аванс 25-е, BYN"
            value={formatMinor(profile.fixedAdvanceMinor)}
            onChange={(v) =>
              setProfile({
                ...profile,
                fixedAdvanceMinor: parseMoneyToMinor(v),
              })
            }
          />
          <MoneyField
            label="Стоимость ПТ для расчёта, BYN"
            value={formatMinor(profile.ptSessionPriceMinor)}
            onChange={(v) =>
              setProfile({
                ...profile,
                ptSessionPriceMinor: parseMoneyToMinor(v),
              })
            }
          />
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Ступени %
            </p>
            {(profile.ptPercentTiers ?? DEFAULT_PT_TIERS).map((t, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <IntField
                  label="От N тренировок"
                  value={String(t.minSessions)}
                  onChange={(v) => {
                    const next = [
                      ...(profile.ptPercentTiers ?? DEFAULT_PT_TIERS),
                    ];
                    next[i] = {
                      ...next[i],
                      minSessions: Math.max(0, Math.round(parseDecimal(v))),
                    };
                    setProfile({ ...profile, ptPercentTiers: next });
                  }}
                />
                <PercentField
                  label="% оплаты"
                  value={formatPercent(t.percent)}
                  onChange={(v) => {
                    const next = [
                      ...(profile.ptPercentTiers ?? DEFAULT_PT_TIERS),
                    ];
                    next[i] = { ...next[i], percent: parseDecimal(v) };
                    setProfile({ ...profile, ptPercentTiers: next });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || copying}
          onClick={save}
        >
          {saving ? 'Сохранение…' : 'Сохранить мотивацию'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={saving || copying}
          onClick={copyToDepartment}
        >
          {copying ? 'Копирование…' : 'Скопировать на подразделение'}
        </button>
      </div>
      {message && <p className="text-sm text-fitgo-300">{message}</p>}
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <input
        className="input mt-1 w-full"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          flushSync(() => onChange(draft));
        }}
      />
    </label>
  );
}

function PercentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <input
        className="input mt-1 w-full"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          flushSync(() => onChange(draft));
        }}
      />
    </label>
  );
}

function IntField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <input
        className="input mt-1 w-full"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          flushSync(() => onChange(draft));
        }}
      />
    </label>
  );
}
