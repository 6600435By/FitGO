'use client';

import type {
  MembershipEconomicsSettings,
  MembershipEfficiencyBasis,
  MembershipEfficiencyReport,
  MembershipGpCostMethod,
  MembershipProductCatalogRow,
  MembershipProductDetail,
} from '@fitgo/shared-types';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Badge, Field, MoneyInput, NumInput, Toggle } from './fields';
import { errMessage, moneyOrDash, pct } from './format';
import { ProfileForm } from './profile-form';

interface CheckItem {
  key: string;
  ok: boolean;
  title: string;
  detail: string;
}

function buildChecklist(
  draft: MembershipEconomicsSettings,
  report: MembershipEfficiencyReport,
): CheckItem[] {
  const h = report.payrollHints;
  const dq = report.dataQuality;
  const currency = report.currency;
  const items: CheckItem[] = [];

  const commissionSet =
    draft.salesCommissionPctOverride != null ||
    h.combinedSalesCommissionPct != null;
  items.push({
    key: 'commission',
    ok: commissionSet,
    title: 'Комиссия с продаж',
    detail: commissionSet
      ? draft.salesCommissionPctOverride != null
        ? `Задан override: ${draft.salesCommissionPctOverride}%.`
        : `Берём из ЗП-профилей: ${h.combinedSalesCommissionPct}%.`
      : 'Нет override и нет процента с продаж в ЗП-профилях админов/менеджеров — маржа будет завышена. Задайте override ниже или заполните ЗП.',
  });

  const costGaps: string[] = [];
  if (draft.massageCostMinor == null && h.spaMassageRateMinor == null)
    costGaps.push('массаж');
  if (
    draft.bodyCompositionCostMinor == null &&
    h.spaBodyCompositionRateMinor == null
  )
    costGaps.push('анализ состава');
  if (draft.ptGiftCostMinor == null && h.ptGiftRateMinor == null)
    costGaps.push('ПТ-подарок');
  if (draft.solariumMinuteCostMinor == null) costGaps.push('минута солярия');
  items.push({
    key: 'costs',
    ok: costGaps.length === 0,
    title: 'Себестоимость услуг',
    detail:
      costGaps.length === 0
        ? 'Себестоимость всех услуг задана или берётся из ЗП.'
        : `Не задано (и нет в ЗП): ${costGaps.join(', ')}. Считаем как 0 ${currency}.`,
  });

  items.push({
    key: 'overhead',
    ok: draft.overheadPerVisitMinor > 0 || draft.fixedOverheadPerMemberMonthMinor > 0,
    title: 'Накладные расходы',
    detail:
      draft.overheadPerVisitMinor > 0 || draft.fixedOverheadPerMemberMonthMinor > 0
        ? 'Накладные заданы.'
        : 'Накладные на визит и фиксированные равны 0 — маржа не учитывает полотенца, воду, уборку.',
  });

  items.push({
    key: 'profiles',
    ok: dq.profilesNeedingReview === 0,
    title: 'Карточки абонементов',
    detail:
      dq.profilesNeedingReview === 0
        ? 'Все карточки заполнены.'
        : `Требуют проверки: ${dq.profilesNeedingReview}. Проверьте раздел 5.`,
  });

  return items;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel({
  report,
  from,
  to,
  basis,
  onClose,
  onSaved,
  onProductSaved,
  onError,
}: {
  report: MembershipEfficiencyReport;
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  onClose: () => void;
  /** Settings saved: parent closes overlay and reloads. */
  onSaved: () => void;
  /** Product card saved: parent reloads report, overlay stays open. */
  onProductSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<MembershipEconomicsSettings>(
    report.settings,
  );
  const [saving, setSaving] = useState(false);
  const hints = report.payrollHints;
  const currency = report.currency;

  const set = <K extends keyof MembershipEconomicsSettings>(
    k: K,
    v: MembershipEconomicsSettings[K],
  ) => setDraft((d) => ({ ...d, [k]: v }));

  const checklist = useMemo(
    () => buildChecklist(draft, report),
    [draft, report],
  );

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      await api.analyticsMembershipsSettingsPut(token, draft);
      onSaved();
    } catch (e) {
      onError(errMessage(e, 'Ошибка сохранения'));
    } finally {
      setSaving(false);
    }
  };

  const payrollHint = (minor: number | null) =>
    minor != null ? `из ЗП: ${moneyOrDash(minor, currency)}` : 'в ЗП не найдено';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <h2 className="text-lg font-semibold">Настройки экономики абонементов</h2>
        <nav className="ml-4 hidden gap-3 text-xs text-slate-400 lg:flex">
          <a href="#ms-commission" className="hover:text-slate-200">
            Комиссии
          </a>
          <a href="#ms-costs" className="hover:text-slate-200">
            Себестоимость
          </a>
          <a href="#ms-overhead" className="hover:text-slate-200">
            Накладные
          </a>
          <a href="#ms-segments" className="hover:text-slate-200">
            Сегменты
          </a>
          <a href="#ms-products" className="hover:text-slate-200">
            Карточки
          </a>
        </nav>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Сохранение…' : 'Сохранить настройки'}
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
        <div className="card space-y-2">
          <h3 className="font-semibold">Чек-лист данных</h3>
          <ul className="space-y-1.5">
            {checklist.map((c) => (
              <li
                key={c.key}
                className={`flex gap-2 rounded-lg p-2 text-sm ${
                  c.ok ? 'bg-emerald-500/5' : 'bg-amber-500/10'
                }`}
              >
                <span className={c.ok ? 'text-emerald-400' : 'text-amber-400'}>
                  {c.ok ? '✓' : '!'}
                </span>
                <span>
                  <span className="font-medium">{c.title}.</span>{' '}
                  <span className="text-slate-400">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Section id="ms-commission" title="1) Комиссии и налоги">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Комиссия с продаж, % (override)"
              hint={
                <>
                  Админ + менеджер от продажи абонемента. Пусто = берём из ЗП
                  {hints.combinedSalesCommissionPct != null
                    ? `: ${hints.combinedSalesCommissionPct}% (админ ${pct(hints.avgAdminMembershipSalesPct)} + менеджер ${pct(hints.avgManagerMembershipSalesPct)})`
                    : ' (в ЗП не найдено)'}
                  .
                </>
              }
            >
              <NumInput
                step={0.1}
                min={0}
                max={100}
                placeholder={
                  hints.combinedSalesCommissionPct != null
                    ? String(hints.combinedSalesCommissionPct)
                    : 'из ЗП'
                }
                value={draft.salesCommissionPctOverride}
                onChange={(v) => set('salesCommissionPctOverride', v)}
              />
            </Field>
            <Field
              label="Эквайринг, %"
              hint="Комиссия банка/платёжной системы от суммы оплаты."
            >
              <NumInput
                step={0.1}
                min={0}
                max={100}
                value={draft.acquiringPct}
                onChange={(v) => set('acquiringPct', v ?? 0)}
              />
            </Field>
            <Field
              label="Налог, %"
              hint="НДС / налог с оборота — от суммы оплаты."
            >
              <NumInput
                step={0.1}
                min={0}
                max={100}
                value={draft.taxPct}
                onChange={(v) => set('taxPct', v ?? 0)}
              />
            </Field>
            <Field
              label="Метод стоимости визита ГП"
              hint="share — доля «доступа» на визит; marginal — реальная доплата тренеру за участника."
            >
              <select
                className="input"
                value={draft.gpCostMethod}
                onChange={(e) =>
                  set('gpCostMethod', e.target.value as MembershipGpCostMethod)
                }
              >
                <option value="share">share — доля доступа</option>
                <option value="marginal">marginal — предельная</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section id="ms-costs" title="2) Себестоимость услуг">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={`Массаж, себестоимость (${currency})`}
              hint={`Пусто = ставка СПА из ЗП (${payrollHint(hints.spaMassageRateMinor)}).`}
            >
              <MoneyInput
                valueMinor={draft.massageCostMinor}
                placeholder={
                  hints.spaMassageRateMinor != null
                    ? String(hints.spaMassageRateMinor / 100)
                    : undefined
                }
                onChange={(v) => set('massageCostMinor', v)}
              />
            </Field>
            <Field
              label={`Анализ состава тела (${currency})`}
              hint={`Пусто = ставка из ЗП (${payrollHint(hints.spaBodyCompositionRateMinor)}).`}
            >
              <MoneyInput
                valueMinor={draft.bodyCompositionCostMinor}
                placeholder={
                  hints.spaBodyCompositionRateMinor != null
                    ? String(hints.spaBodyCompositionRateMinor / 100)
                    : undefined
                }
                onChange={(v) => set('bodyCompositionCostMinor', v)}
              />
            </Field>
            <Field
              label={`ПТ-подарок, себестоимость (${currency})`}
              hint={`Одна бесплатная персональная тренировка. Пусто = ставка из ЗП (${payrollHint(hints.ptGiftRateMinor)}).`}
            >
              <MoneyInput
                valueMinor={draft.ptGiftCostMinor}
                placeholder={
                  hints.ptGiftRateMinor != null
                    ? String(hints.ptGiftRateMinor / 100)
                    : undefined
                }
                onChange={(v) => set('ptGiftCostMinor', v)}
              />
            </Field>
            <Field
              label={`Солярий, минута (${currency})`}
              hint="Затраты клуба на 1 минуту (электричество, лампы, амортизация)."
            >
              <MoneyInput
                valueMinor={draft.solariumMinuteCostMinor}
                onChange={(v) => set('solariumMinuteCostMinor', v)}
              />
            </Field>
            <Field
              label={`Массаж, прайс (${currency})`}
              hint="Для разложения цены абонемента. Пусто = из продаж."
            >
              <MoneyInput
                valueMinor={draft.massageRetailMinor}
                onChange={(v) => set('massageRetailMinor', v)}
              />
            </Field>
            <Field
              label={`Солярий, прайс за минуту (${currency})`}
              hint="Для разложения цены абонемента."
            >
              <MoneyInput
                valueMinor={draft.solariumMinuteRetailMinor}
                onChange={(v) => set('solariumMinuteRetailMinor', v)}
              />
            </Field>
          </div>
        </Section>

        <Section id="ms-overhead" title="3) Накладные расходы">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={`Накладные на визит (${currency})`}
              hint="Полотенца, вода, уборка — на каждый визит (ГП и зал)."
            >
              <MoneyInput
                valueMinor={draft.overheadPerVisitMinor}
                onChange={(v) => set('overheadPerVisitMinor', v ?? 0)}
              />
            </Field>
            <Field
              label={`Переменные затраты зала на визит (${currency})`}
              hint="Только для визитов в зал; по умолчанию равно накладным на визит."
            >
              <MoneyInput
                valueMinor={draft.gymVisitVariableCostMinor}
                onChange={(v) => set('gymVisitVariableCostMinor', v ?? 0)}
              />
            </Field>
            <Field
              label={`Фикс. накладные на участника в месяц (${currency})`}
              hint="Аренда, коммуналка, ФОТ — на одного активного члена. Учитывается в сценарии «с фикс. накладными»."
            >
              <MoneyInput
                valueMinor={draft.fixedOverheadPerMemberMonthMinor}
                onChange={(v) => set('fixedOverheadPerMemberMonthMinor', v ?? 0)}
              />
            </Field>
            <Field
              label="Доля себестоимости ЛС (0–1)"
              hint="Какая часть потраченных с личного счёта денег — реальные затраты клуба."
            >
              <NumInput
                step={0.05}
                min={0}
                max={1}
                value={draft.personalAccountCogsShare}
                onChange={(v) => set('personalAccountCogsShare', v ?? 0)}
              />
            </Field>
          </div>
        </Section>

        <Section id="ms-segments" title="4) Сегменты клиентов">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Норма визитов ГП в неделю"
              hint="База для индекса использования: визиты/нед. ÷ норма."
            >
              <NumInput
                step={0.1}
                min={0}
                value={draft.normVisitsPerWeek}
                onChange={(v) => set('normVisitsPerWeek', v ?? 2)}
              />
            </Field>
            <Field
              label="Дней без визита → «спящий»"
              hint="Клиент без визитов дольше этого срока попадает в сегмент «Спящие»."
            >
              <NumInput
                step={1}
                min={1}
                value={draft.sleepingDays}
                onChange={(v) => set('sleepingDays', v ?? 21)}
              />
            </Field>
            <Field
              label="Порог «Максимум» (индекс ≥)"
              hint="Выше этого индекса — максимальная загрузка."
            >
              <NumInput
                step={0.05}
                min={0}
                value={draft.segmentThresholds.max}
                onChange={(v) =>
                  set('segmentThresholds', {
                    ...draft.segmentThresholds,
                    max: v ?? draft.segmentThresholds.max,
                  })
                }
              />
            </Field>
            <Field
              label="Порог «Норма» (индекс ≥)"
              hint="Между порогом нормы и максимума — норма."
            >
              <NumInput
                step={0.05}
                min={0}
                value={draft.segmentThresholds.normal}
                onChange={(v) =>
                  set('segmentThresholds', {
                    ...draft.segmentThresholds,
                    normal: v ?? draft.segmentThresholds.normal,
                  })
                }
              />
            </Field>
            <Field
              label="Порог «Недогруз» (индекс ≥)"
              hint="Ниже этого индекса (но не «спящий») — недогруз."
            >
              <NumInput
                step={0.05}
                min={0}
                value={draft.segmentThresholds.under}
                onChange={(v) =>
                  set('segmentThresholds', {
                    ...draft.segmentThresholds,
                    under: v ?? draft.segmentThresholds.under,
                  })
                }
              />
            </Field>
          </div>
        </Section>

        <Section id="ms-products" title="5) Карточки абонементов">
          <p className="text-xs text-slate-500">
            Срок, квоты услуг и доступ задаются по каждой номенклатуре 1С.
            Откройте строку, чтобы изменить карточку; сохранение — отдельно для
            каждого абонемента.
          </p>
          <ProductsEditor
            products={report.products}
            from={from}
            to={to}
            basis={basis}
            onSaved={onProductSaved}
            onError={onError}
          />
        </Section>
      </div>
    </div>
  );
}

function ProductsEditor({
  products,
  from,
  to,
  basis,
  onSaved,
  onError,
}: {
  products: MembershipProductCatalogRow[];
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [onlyReview, setOnlyReview] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, MembershipProductDetail>>(
    {},
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (onlyReview ? !p.compositionComplete : true))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.compositionComplete !== b.compositionComplete) {
          return a.compositionComplete ? 1 : -1;
        }
        return b.soldCount - a.soldCount;
      });
  }, [products, onlyReview, query]);

  const loadDetail = async (id: string) => {
    const token = getToken();
    if (!token) return;
    setLoadingId(id);
    try {
      const d = await api.analyticsMembershipsProductDetail(token, id, {
        from,
        to,
        basis,
      });
      setDetails((cur) => ({ ...cur, [id]: d }));
    } catch (e) {
      onError(errMessage(e, 'Ошибка загрузки карточки'));
    } finally {
      setLoadingId(null);
    }
  };

  const toggle = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!details[id]) void loadDetail(id);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Поиск</span>
          <input
            className="input"
            placeholder="Название абонемента"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Toggle
          checked={onlyReview}
          onChange={setOnlyReview}
          label="Только требующие проверки"
        />
        <span className="ml-auto text-xs text-slate-500">
          {rows.length} из {products.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Абонемент</th>
              <th className="py-1 pr-2">Группа</th>
              <th className="py-1 pr-2">Срок (факт), мес</th>
              <th className="py-1 pr-2">Продано</th>
              <th className="py-1 pr-2">Состав</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const open = openId === p.productExternalId;
              const d = details[p.productExternalId];
              return (
                <Fragment key={p.productExternalId}>
                  <tr className="border-t border-slate-800">
                    <td className="py-1.5 pr-2">
                      {p.name}
                      {d?.profile?.excluded && (
                        <span className="ml-1.5">
                          <Badge tone="rose">исключён</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-400">
                      {p.groupLabel ?? '—'}
                    </td>
                    <td className="py-1.5 pr-2">{p.avgMonths}</td>
                    <td className="py-1.5 pr-2">{p.soldCount}</td>
                    <td className="py-1.5 pr-2">
                      {p.compositionComplete ? (
                        <Badge tone="emerald">заполнен</Badge>
                      ) : (
                        <Badge tone="amber">проверить</Badge>
                      )}
                      {p.autoFilledFields.length > 0 && (
                        <span className="ml-1">
                          <Badge
                            tone="fitgo"
                            title={p.autoFilledFields.join(', ')}
                          >
                            авто: {p.autoFilledFields.length}
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => toggle(p.productExternalId)}
                      >
                        {open ? 'Свернуть' : 'Изменить'}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} className="pb-3">
                        {loadingId === p.productExternalId && !d ? (
                          <p className="py-2 text-xs text-slate-500">
                            Загрузка карточки…
                          </p>
                        ) : d ? (
                          <ProfileForm
                            key={`${p.productExternalId}-${formKey}`}
                            productExternalId={p.productExternalId}
                            name={p.name}
                            profile={d.profile}
                            defaults={{
                              groupLabel: p.groupLabel,
                              termMonths: Math.max(1, Math.round(p.avgMonths) || 1),
                            }}
                            autoFilledFields={p.autoFilledFields}
                            onError={onError}
                            onCancel={() => setOpenId(null)}
                            onSaved={(saved) => {
                              setDetails((cur) => ({
                                ...cur,
                                [p.productExternalId]: { ...d, profile: saved },
                              }));
                              setFormKey((k) => k + 1);
                              setOpenId(null);
                              onSaved();
                            }}
                          />
                        ) : null}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="py-4 text-center text-sm text-slate-500">
            Нет абонементов по фильтру
          </p>
        )}
      </div>
    </div>
  );
}
