'use client';

import type { StaffMember } from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type RuleRow = {
  source: string;
  label: string;
  enabled: boolean;
  assignMode: 'POOL' | 'USERS' | 'ON_SHIFT';
  assigneeIds: string[];
  duePolicy: 'END_OF_DAY' | 'HOURS_BEFORE_EVENT' | 'HOURS_AFTER_CREATE';
  dueHours?: number | null;
  params: Record<string, unknown>;
};

export default function AdminTaskSettingsPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [admins, setAdmins] = useState<StaffMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    const token = getToken();
    if (!token) return;
    setError(null);
    Promise.all([api.superAdminTaskRules(token), api.superAdminStaff(token)])
      .then(([r, staff]) => {
        setRules(r);
        setAdmins(
          staff.filter((s) => s.roles.includes(UserRole.ADMIN) && s.isActive),
        );
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      })
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    load();
  }, []);

  const update = (source: string, patch: Partial<RuleRow>) => {
    setRules((prev) =>
      prev.map((r) => (r.source === source ? { ...r, ...patch } : r)),
    );
    setSaved(false);
  };

  const toggleAssignee = (source: string, id: string) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.source !== source) return r;
        const has = r.assigneeIds.includes(id);
        return {
          ...r,
          assigneeIds: has
            ? r.assigneeIds.filter((x) => x !== id)
            : [...r.assigneeIds, id],
        };
      }),
    );
    setSaved(false);
  };

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.superAdminPutTaskRules(
        token,
        rules.map((r) => ({
          source: r.source,
          enabled: r.enabled,
          assignMode: r.assignMode,
          assigneeIds: r.assigneeIds,
          duePolicy: r.duePolicy,
          dueHours: r.dueHours ?? null,
          params: r.params,
        })),
      );
      setRules(next as RuleRow[]);
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const paramNumber = (r: RuleRow, key: string): number => {
    const v = r.params[key];
    return typeof v === 'number' ? v : 0;
  };

  const setParam = (source: string, key: string, value: number) => {
    setRules((prev) =>
      prev.map((r) =>
        r.source === source
          ? { ...r, params: { ...r.params, [key]: value } }
          : r,
      ),
    );
    setSaved(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Настройки задач</h2>
          <p className="text-sm text-slate-400">
            Автозадачи клуба: включение, кому назначать, сроки и пороги.
          </p>
        </div>
        <Link href="/super-admin/tasks" className="btn-secondary text-sm">
          ← К задачам
        </Link>
      </div>

      <p className="text-sm text-slate-400">
        Правила нестыковок настраиваются отдельно:{' '}
        <Link
          href="/super-admin/exceptions"
          className="text-fitgo-400 hover:underline"
        >
          Нестыковки
        </Link>
        .
      </p>

      {!loaded && <p className="text-slate-400">Загрузка…</p>}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Сохранено</p>}

      <ul className="space-y-3">
        {rules.map((r) => (
          <li key={r.source} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) =>
                    update(r.source, { enabled: e.target.checked })
                  }
                />
                {r.label}
              </label>
              <span className="text-xs text-slate-500">{r.source}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-400">Кому</span>
                <select
                  className="input mt-1 w-full text-sm"
                  value={r.assignMode}
                  onChange={(e) =>
                    update(r.source, {
                      assignMode: e.target.value as RuleRow['assignMode'],
                    })
                  }
                >
                  <option value="POOL">Общая очередь</option>
                  <option value="USERS">Конкретные сотрудники</option>
                  <option value="ON_SHIFT">Кто на смене (иначе очередь)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-400">Срок</span>
                <select
                  className="input mt-1 w-full text-sm"
                  value={r.duePolicy}
                  onChange={(e) =>
                    update(r.source, {
                      duePolicy: e.target.value as RuleRow['duePolicy'],
                    })
                  }
                >
                  <option value="END_OF_DAY">Конец дня</option>
                  <option value="HOURS_BEFORE_EVENT">
                    За N часов до события
                  </option>
                  <option value="HOURS_AFTER_CREATE">
                    Через N часов после создания
                  </option>
                </select>
              </label>
            </div>

            {r.duePolicy !== 'END_OF_DAY' ? (
              <label className="block text-sm">
                <span className="text-slate-400">Часов (N)</span>
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-32 text-sm"
                  value={r.dueHours ?? 0}
                  onChange={(e) =>
                    update(r.source, {
                      dueHours: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
            ) : null}

            {r.assignMode === 'USERS' ? (
              <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-slate-700/50 p-2">
                {admins.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.assigneeIds.includes(a.id)}
                      onChange={() => toggleAssignee(r.source, a.id)}
                    />
                    {a.firstName} {a.lastName}
                  </label>
                ))}
              </div>
            ) : null}

            {(r.source === 'CLIENT_DEBT' || r.source === 'STAFF_DEBT') && (
              <label className="block text-sm">
                <span className="text-slate-400">Мин. сумма (BYN)</span>
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-32 text-sm"
                  value={paramNumber(r, 'minAmount')}
                  onChange={(e) =>
                    setParam(r.source, 'minAmount', Number(e.target.value) || 0)
                  }
                />
              </label>
            )}
            {r.source === 'MEMBERSHIP_EXPIRING' && (
              <label className="block text-sm">
                <span className="text-slate-400">Горизонт (дней)</span>
                <input
                  type="number"
                  min={1}
                  className="input mt-1 w-32 text-sm"
                  value={paramNumber(r, 'daysAhead') || 14}
                  onChange={(e) =>
                    setParam(r.source, 'daysAhead', Number(e.target.value) || 14)
                  }
                />
              </label>
            )}
            {r.source === 'INSTALLMENT_PAYMENT' && (
              <label className="block text-sm">
                <span className="text-slate-400">Дней до платежа</span>
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-32 text-sm"
                  value={paramNumber(r, 'daysBeforePayment') || 3}
                  onChange={(e) =>
                    setParam(
                      r.source,
                      'daysBeforePayment',
                      Number(e.target.value) || 3,
                    )
                  }
                />
              </label>
            )}
            {r.source === 'TRAINING_SALE_NO_PERFORMER' && (
              <label className="block text-sm">
                <span className="text-slate-400">Смотреть за N дней</span>
                <input
                  type="number"
                  min={1}
                  className="input mt-1 w-32 text-sm"
                  value={paramNumber(r, 'lookbackDays') || 14}
                  onChange={(e) =>
                    setParam(
                      r.source,
                      'lookbackDays',
                      Number(e.target.value) || 14,
                    )
                  }
                />
              </label>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn-primary"
        disabled={saving || !loaded}
        onClick={() => void save()}
      >
        {saving ? 'Сохранение…' : 'Сохранить'}
      </button>
    </div>
  );
}
