'use client';

import { useEffect, useState } from 'react';
import type {
  DiscrepancyAssignMode,
  DiscrepancyAutoRunResult,
  DiscrepancyTab,
  DiscrepancyTaskLink,
  DiscrepancyTaskOptions,
  DiscrepancyTaskRuleDto,
  DiscrepancyTaskStaff,
  DiscrepancyTaskSubject,
} from '@fitgo/shared-types';
import {
  DISCREPANCY_ASSIGN_MODE_LABELS,
  DISCREPANCY_DEPT_LABELS,
  DISCREPANCY_TAB_DEPTS,
  DISCREPANCY_TAB_TITLES,
  discrepancyTaskText,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const DUE_OPTIONS: Array<[number, string]> = [
  [4, '4 часа'],
  [24, '1 день'],
  [48, '2 дня'],
  [72, '3 дня'],
  [168, 'Неделя'],
];

const ROLE_GROUPS: Array<[DiscrepancyTaskStaff['role'], string]> = [
  ['ADMIN', 'Администраторы'],
  ['MANAGER', 'Руководители'],
  ['TRAINER', 'Тренеры'],
  ['SPECIALIST', 'SPA-специалисты'],
];

function linkLabel(link: DiscrepancyTaskLink) {
  const who = link.assignees.slice(0, 2).join(', ');
  const more = link.assignees.length > 2 ? ` +${link.assignees.length - 2}` : '';
  const status =
    link.status === 'DONE'
      ? 'выполнена'
      : link.status === 'IN_PROGRESS'
        ? 'в работе'
        : 'открыта';
  return `${link.auto ? 'Авто-задача' : 'Задача'}: ${who}${more} · ${status}`;
}

export function TaskButton({
  tab,
  itemKey,
  fingerprint,
  subject,
  date,
  at,
  performerUserId,
  link,
  onCreated,
}: {
  tab: DiscrepancyTab;
  itemKey: string;
  fingerprint: string;
  subject: DiscrepancyTaskSubject;
  date?: string;
  at?: string;
  performerUserId?: string | null;
  link?: DiscrepancyTaskLink;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [options, setOptions] = useState<DiscrepancyTaskOptions | null>(null);
  const [assignee, setAssignee] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueHours, setDueHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    const token = getToken();
    if (!token) return;
    const text = discrepancyTaskText(subject);
    setTitle(text.title);
    setDescription(text.description);
    setError('');
    setMore(false);
    setOpen(true);
    try {
      const opts = await api.discrepancyTaskOptions(token, {
        date,
        at,
        tab,
        performerUserId: performerUserId || undefined,
      });
      setOptions(opts);
      setAssignee(opts.suggested);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const submit = async () => {
    const token = getToken();
    if (!token || !assignee) return;
    setBusy(true);
    setError('');
    try {
      await api.discrepancyTaskCreate(token, {
        tab,
        itemKey,
        fingerprint,
        assignee,
        title,
        description,
        dueHours,
        date,
      });
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {link ? (
          <span
            className={`text-xs ${link.status === 'DONE' ? 'text-emerald-400' : 'text-amber-300'}`}
          >
            {linkLabel(link)}
          </span>
        ) : null}
        {!link || link.status === 'DONE' ? (
          <button
            type="button"
            className="text-xs text-slate-400 underline-offset-2 hover:text-emerald-400 hover:underline"
            onClick={() => void start()}
          >
            Задача
          </button>
        ) : null}
      </span>
    );
  }

  const depts = options?.depts ?? DISCREPANCY_TAB_DEPTS[tab];

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border border-slate-800 p-3 text-sm">
      <label className="block text-xs text-slate-500">
        Кому
        <select
          className="input mt-1 block w-full text-sm"
          value={assignee}
          disabled={!options}
          onChange={(e) => setAssignee(e.target.value)}
        >
          {!options ? <option value="">Загрузка…</option> : null}
          {options ? (
            <>
              <optgroup label="Подразделение">
                {depts.map((d) => (
                  <option key={d} value={`dept:${d}`}>
                    {DISCREPANCY_DEPT_LABELS[d]}
                  </option>
                ))}
              </optgroup>
              {ROLE_GROUPS.map(([role, label]) => {
                const people = options.staff.filter((s) => s.role === role);
                if (!people.length) return null;
                return (
                  <optgroup key={role} label={label}>
                    {people.map((s) => (
                      <option key={s.id} value={`user:${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </>
          ) : null}
        </select>
        {options && assignee === options.suggested ? (
          <span className="mt-1 block text-slate-500">
            По умолчанию: {options.suggestedReason}
          </span>
        ) : null}
      </label>
      <input
        className="input block w-full text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {more ? (
        <textarea
          className="input block w-full text-sm"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      ) : (
        <button
          type="button"
          className="text-xs text-slate-500 underline-offset-2 hover:underline"
          onClick={() => setMore(true)}
        >
          Изменить текст
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input text-sm"
          value={dueHours}
          onChange={(e) => setDueHours(Number(e.target.value))}
        >
          {DUE_OPTIONS.map(([h, label]) => (
            <option key={h} value={h}>
              Срок: {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={busy || !assignee || title.trim().length < 2}
          onClick={() => void submit()}
        >
          {busy ? 'Ставлю…' : 'Поставить'}
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setOpen(false)}
        >
          Отмена
        </button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

const RULE_TEXT: Record<
  DiscrepancyTab,
  {
    threshold: string;
    scopes: Array<[string, string]>;
    performer: boolean;
    hint: string;
  }
> = {
  sales: {
    threshold: 'Расхождение за день от, BYN',
    scopes: [
      ['all', 'Нал или карта'],
      ['cash', 'Только нал'],
      ['card', 'Только карта'],
    ],
    performer: false,
    hint: 'По умолчанию — последний администратор на смене за тот день.',
  },
  spa: {
    threshold: 'Списаний за день на специалиста от',
    scopes: [
      ['all', 'Все списания'],
      ['red', 'Только красные'],
    ],
    performer: true,
    hint: 'По умолчанию — сам специалист. Нет входа — отдел SPA.',
  },
  pt: {
    threshold: 'Списаний за день на тренера от',
    scopes: [
      ['all', 'Все списания'],
      ['red', 'Только красные'],
    ],
    performer: true,
    hint: 'По умолчанию — сам тренер. Нет входа — тренеры ПТ.',
  },
  gp: {
    threshold: 'Поздних записей на занятие от',
    scopes: [],
    performer: true,
    hint: 'По умолчанию — тренер занятия. Нет входа — тренеры ГП.',
  },
  segments: {
    threshold: 'Продаж позиции от',
    scopes: [
      ['problems', 'Вне сегмента и конфликты'],
      ['all', '+ угаданные'],
    ],
    performer: false,
    hint: 'По умолчанию — все администраторы. Это настройка 1С, не смена.',
  },
};

export function AutoTasksSettings() {
  const [rules, setRules] = useState<DiscrepancyTaskRuleDto[] | null>(null);
  const [staff, setStaff] = useState<DiscrepancyTaskStaff[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      api.discrepancyTaskRules(token),
      api.discrepancyTaskOptions(token, {}),
    ])
      .then(([r, o]) => {
        setRules(r);
        setStaff(o.staff);
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : 'Ошибка'));
  }, []);

  const patch = (tab: DiscrepancyTab, p: Partial<DiscrepancyTaskRuleDto>) =>
    setRules((prev) =>
      prev ? prev.map((r) => (r.tab === tab ? { ...r, ...p } : r)) : prev,
    );

  const save = async () => {
    const token = getToken();
    if (!token || !rules) return;
    setBusy('save');
    setMessage('');
    try {
      setRules(await api.discrepancyTaskRulesSave(token, rules));
      setMessage('Сохранено. Авто-задачи создаются после ночной синхронизации за вчера.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const run = async () => {
    const token = getToken();
    if (!token) return;
    setBusy('run');
    setMessage('');
    try {
      const r: DiscrepancyAutoRunResult = await api.discrepancyTaskAutoRun(token);
      const parts = Object.entries(r.byTab)
        .filter(([, n]) => n)
        .map(([t, n]) => `${DISCREPANCY_TAB_TITLES[t as DiscrepancyTab]} ${n}`);
      setMessage(
        r.created
          ? `Создано задач: ${r.created} (${parts.join(', ')})`
          : 'Новых задач нет',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  if (!rules) {
    return (
      <div className="card p-3 text-sm text-slate-400">
        {message || 'Загрузка…'}
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-3 text-sm">
      <div>
        <p className="font-medium">Авто-задачи</p>
        <p className="text-xs text-slate-500">
          После ночной синхронизации смотрим вчерашний день (или сколько дней
          задано) и ставим задачу на каждую новую нестыковку. Разобранные и уже
          с задачей пропускаем. Текст: дата и суть проблемы.
        </p>
      </div>
      <ul className="space-y-2">
        {rules.map((rule) => {
          const text = RULE_TEXT[rule.tab];
          const modes = (
            Object.keys(DISCREPANCY_ASSIGN_MODE_LABELS) as DiscrepancyAssignMode[]
          ).filter((m) => m !== 'PERFORMER' || text.performer);
          return (
            <li
              key={rule.tab}
              className="space-y-2 border-t border-slate-800 pt-2 first:border-0 first:pt-0"
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={rule.enabled}
                  onChange={(e) => patch(rule.tab, { enabled: e.target.checked })}
                />
                <span className="font-medium">{DISCREPANCY_TAB_TITLES[rule.tab]}</span>
              </label>
              {rule.enabled ? (
                <>
              <p className="text-xs text-slate-500">{text.hint}</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className="text-xs text-slate-500">
                    {text.threshold}
                    <input
                      type="number"
                      min={0}
                      step={rule.tab === 'sales' ? 0.5 : 1}
                      className="input mt-1 block w-full text-sm"
                      value={rule.threshold}
                      onChange={(e) =>
                        patch(rule.tab, { threshold: Number(e.target.value) })
                      }
                    />
                  </label>
                  {text.scopes.length ? (
                    <label className="text-xs text-slate-500">
                      Что считать
                      <select
                        className="input mt-1 block w-full text-sm"
                        value={rule.scope}
                        onChange={(e) => patch(rule.tab, { scope: e.target.value })}
                      >
                        {text.scopes.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="text-xs text-slate-500">
                    Кому
                    <select
                      className="input mt-1 block w-full text-sm"
                      value={rule.assignTo}
                      onChange={(e) =>
                        patch(rule.tab, {
                          assignTo: e.target.value as DiscrepancyAssignMode,
                        })
                      }
                    >
                      {modes.map((m) => (
                        <option key={m} value={m}>
                          {DISCREPANCY_ASSIGN_MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {rule.assignTo === 'USER' ? (
                    <label className="text-xs text-slate-500">
                      Сотрудник
                      <select
                        className="input mt-1 block w-full text-sm"
                        value={rule.assigneeId ?? ''}
                        onChange={(e) =>
                          patch(rule.tab, { assigneeId: e.target.value || null })
                        }
                      >
                        <option value="">—</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="text-xs text-slate-500">
                    Срок
                    <select
                      className="input mt-1 block w-full text-sm"
                      value={rule.dueHours}
                      onChange={(e) =>
                        patch(rule.tab, { dueHours: Number(e.target.value) })
                      }
                    >
                      {DUE_OPTIONS.map(([h, label]) => (
                        <option key={h} value={h}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">
                    Проверять дней назад
                    <input
                      type="number"
                      min={1}
                      max={14}
                      className="input mt-1 block w-full text-sm"
                      value={rule.lookbackDays}
                      onChange={(e) =>
                        patch(rule.tab, { lookbackDays: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={!!busy}
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={!!busy}
          onClick={() => void run()}
        >
          {busy === 'run' ? 'Проверка…' : 'Запустить сейчас'}
        </button>
      </div>
      {message ? <p className="text-xs text-slate-400">{message}</p> : null}
    </div>
  );
}
