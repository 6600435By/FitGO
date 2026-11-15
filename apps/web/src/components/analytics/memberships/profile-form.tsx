'use client';

import type { MembershipProductProfileDto } from '@fitgo/shared-types';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Badge, Field, MoneyInput, NumInput, Toggle } from './fields';
import { errMessage } from './format';

interface Draft {
  groupLabel: string;
  termMonths: number;
  accessGp: boolean;
  accessGym: boolean;
  gpVisitsLimit: number | null;
  ptIncluded: number;
  massageIncluded: number;
  bodyCompositionIncluded: number;
  solariumMinutes: number;
  personalAccountCreditMinor: number;
  retailPriceOverrideMinor: number | null;
  excluded: boolean;
}

function toDraft(
  profile: MembershipProductProfileDto | null,
  defaults: { groupLabel: string | null; termMonths: number },
): Draft {
  return {
    groupLabel: profile?.groupLabel ?? defaults.groupLabel ?? '',
    termMonths: profile?.termMonths ?? defaults.termMonths,
    accessGp: profile?.accessGp ?? true,
    accessGym: profile?.accessGym ?? true,
    gpVisitsLimit: profile?.gpVisitsLimit ?? null,
    ptIncluded: profile?.ptIncluded ?? 0,
    massageIncluded: profile?.massageIncluded ?? 0,
    bodyCompositionIncluded: profile?.bodyCompositionIncluded ?? 0,
    solariumMinutes: profile?.solariumMinutes ?? 0,
    personalAccountCreditMinor: profile?.personalAccountCreditMinor ?? 0,
    retailPriceOverrideMinor: profile?.retailPriceOverrideMinor ?? null,
    excluded: profile?.excluded ?? false,
  };
}

/** Field → label map; also used to show «авто» badges. */
export const PROFILE_FIELD_LABEL: Record<string, string> = {
  termMonths: 'Срок, мес',
  accessGp: 'Доступ ГП',
  accessGym: 'Доступ в зал',
  gpVisitsLimit: 'Лимит ГП',
  ptIncluded: 'ПТ в составе',
  massageIncluded: 'Массажи',
  bodyCompositionIncluded: 'Анализ состава тела',
  solariumMinutes: 'Солярий, мин',
  personalAccountCreditMinor: 'Личный счёт',
  retailPriceOverrideMinor: 'Прайс (override)',
  groupLabel: 'Группа',
};

export function ProfileForm({
  productExternalId,
  name,
  profile,
  defaults,
  autoFilledFields,
  onSaved,
  onCancel,
  onError,
}: {
  productExternalId: string;
  name: string;
  profile: MembershipProductProfileDto | null;
  defaults: { groupLabel: string | null; termMonths: number };
  autoFilledFields?: string[];
  onSaved: (saved: MembershipProductProfileDto) => void;
  onCancel?: () => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile, defaults));
  const [saving, setSaving] = useState(false);
  const auto = new Set(autoFilledFields ?? profile?.autoFilledFields ?? []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const label = (key: keyof Draft, text: string) => (
    <span>
      {text}
      {auto.has(key) && (
        <span className="ml-1.5">
          <Badge tone="fitgo" title="Заполнено автоматически из 1С / продаж">
            авто
          </Badge>
        </span>
      )}
    </span>
  );

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const saved = await api.analyticsMembershipsProductPut(
        token,
        productExternalId,
        {
          name,
          groupLabel: draft.groupLabel.trim() || null,
          termMonths: Math.max(1, draft.termMonths),
          accessGp: draft.accessGp,
          accessGym: draft.accessGym,
          gpVisitsLimit: draft.gpVisitsLimit,
          ptIncluded: draft.ptIncluded,
          massageIncluded: draft.massageIncluded,
          bodyCompositionIncluded: draft.bodyCompositionIncluded,
          solariumMinutes: draft.solariumMinutes,
          personalAccountCreditMinor: draft.personalAccountCreditMinor,
          retailPriceOverrideMinor: draft.retailPriceOverrideMinor,
          excluded: draft.excluded,
        },
      );
      onSaved(saved);
    } catch (e) {
      onError(errMessage(e, 'Ошибка сохранения карточки'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl bg-slate-900/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Группа" hint="Для свёртки в каталоге: VIP, Единый…">
          <input
            className="input"
            value={draft.groupLabel}
            onChange={(e) => set('groupLabel', e.target.value)}
          />
        </Field>
        <Field
          label="Срок, мес"
          hint="Обычно берётся из названия номенклатуры 1С."
        >
          <NumInput
            min={1}
            step={1}
            value={draft.termMonths}
            onChange={(v) => set('termMonths', v ?? 1)}
          />
        </Field>
        <Field
          label="Лимит ГП на срок"
          hint="Пусто = безлимит визитов групповых программ."
        >
          <NumInput
            min={0}
            step={1}
            placeholder="безлимит"
            value={draft.gpVisitsLimit}
            onChange={(v) => set('gpVisitsLimit', v)}
          />
        </Field>
        <Field
          label="Прайс (override), валюта"
          hint="Пусто = цена из каталога 1С."
        >
          <MoneyInput
            valueMinor={draft.retailPriceOverrideMinor}
            onChange={(v) => set('retailPriceOverrideMinor', v)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
        <Toggle
          checked={draft.accessGp}
          onChange={(v) => set('accessGp', v)}
          label="Доступ ГП"
        />
        <Toggle
          checked={draft.accessGym}
          onChange={(v) => set('accessGym', v)}
          label="Доступ в зал"
        />
        <Toggle
          checked={draft.excluded}
          onChange={(v) => set('excluded', v)}
          label="Исключить из аналитики"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={label('ptIncluded', 'ПТ в составе, шт.')}
          hint="Подарочные персональные тренировки на весь срок."
        >
          <NumInput
            min={0}
            step={1}
            value={draft.ptIncluded}
            onChange={(v) => set('ptIncluded', v ?? 0)}
          />
        </Field>
        <Field
          label={label('massageIncluded', 'Массажи, шт.')}
          hint="На весь срок."
        >
          <NumInput
            min={0}
            step={1}
            value={draft.massageIncluded}
            onChange={(v) => set('massageIncluded', v ?? 0)}
          />
        </Field>
        <Field
          label={label('bodyCompositionIncluded', 'Анализ состава тела, шт.')}
        >
          <NumInput
            min={0}
            step={1}
            value={draft.bodyCompositionIncluded}
            onChange={(v) => set('bodyCompositionIncluded', v ?? 0)}
          />
        </Field>
        <Field
          label={label('solariumMinutes', 'Солярий, мин')}
        >
          <NumInput
            min={0}
            step={1}
            value={draft.solariumMinutes}
            onChange={(v) => set('solariumMinutes', v ?? 0)}
          />
        </Field>
        <Field
          label={label('personalAccountCreditMinor', 'Личный счёт, кредит')}
          hint="Сумма, зачисляемая на ЛС при продаже (в валюте)."
        >
          <MoneyInput
            valueMinor={draft.personalAccountCreditMinor}
            onChange={(v) => set('personalAccountCreditMinor', v ?? 0)}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Сохранение…' : 'Сохранить карточку'}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onCancel}
          >
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}
