'use client';

import { useEffect, useMemo, useState } from 'react';

export type ManagerReworkAssignee = {
  id: string;
  name: string;
  roles?: string[];
  externalId?: string | null;
};

export type ManagerReworkTargetOption = {
  id: string;
  label: string;
  /** When set, submit without picking from the staff list. */
  presetAssigneeId?: string | null;
  /** Show staff picker (filtered). */
  needsAssignee?: boolean;
  /** Role filter for staff picker. */
  roleFilter?: string[];
  hint?: string;
};

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  targets: ManagerReworkTargetOption[];
  assignees: ManagerReworkAssignee[];
  warning?: string | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: {
    targetId: string;
    assigneeId?: string;
    comment: string;
    dueAt?: string;
  }) => Promise<void> | void;
};

export function ManagerReworkSheet({
  open,
  title,
  subtitle,
  targets,
  assignees,
  warning,
  busy,
  onClose,
  onSubmit,
}: Props) {
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [comment, setComment] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const first = targets[0];
    setTargetId(first?.id ?? '');
    setAssigneeId(first?.presetAssigneeId ?? '');
    setComment('');
    setDueLocal('');
    setError('');
  }, [open, targets]);

  const selected = useMemo(
    () => targets.find((t) => t.id === targetId) ?? targets[0],
    [targets, targetId],
  );

  const filteredAssignees = useMemo(() => {
    const roles = selected?.roleFilter;
    if (!roles?.length) return assignees;
    return assignees.filter((a) =>
      (a.roles ?? []).some((r) => roles.includes(r)),
    );
  }, [assignees, selected]);

  useEffect(() => {
    if (!selected) return;
    if (selected.presetAssigneeId) {
      setAssigneeId(selected.presetAssigneeId);
      return;
    }
    if (selected.needsAssignee) {
      setAssigneeId((prev) =>
        filteredAssignees.some((a) => a.id === prev)
          ? prev
          : (filteredAssignees[0]?.id ?? ''),
      );
    } else {
      setAssigneeId('');
    }
  }, [selected, filteredAssignees]);

  if (!open) return null;

  const needsAssignee = Boolean(
    selected?.needsAssignee ||
      (selected && !selected.presetAssigneeId && selected.id === 'staff'),
  );

  const canSubmit =
    comment.trim().length >= 2 &&
    Boolean(selected) &&
    (!needsAssignee || Boolean(assigneeId)) &&
    !busy;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
            ) : null}
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-400">Кому</legend>
            {targets.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  className="mt-1"
                  name="rework-target"
                  checked={targetId === t.id}
                  onChange={() => setTargetId(t.id)}
                />
                <span>
                  <span className="font-medium text-slate-100">{t.label}</span>
                  {t.hint ? (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {t.hint}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>

          {needsAssignee ? (
            <label className="block text-xs text-slate-500">
              Сотрудник
              <select
                className="input mt-1 block w-full text-sm"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Выберите…</option>
                {filteredAssignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-xs text-slate-500">
            Комментарий
            <textarea
              className="input mt-1 min-h-[4rem] w-full text-sm"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что исправить"
            />
          </label>

          <label className="block text-xs text-slate-500">
            Срок (необязательно)
            <input
              type="datetime-local"
              className="input mt-1 block w-full text-sm"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
            />
          </label>

          {warning ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {warning}
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-rose-300">{error}</p>
          ) : null}

          <button
            type="button"
            className="btn-primary w-full text-sm"
            disabled={!canSubmit}
            onClick={() => {
              void (async () => {
                setError('');
                try {
                  await onSubmit({
                    targetId: selected!.id,
                    assigneeId: needsAssignee ? assigneeId : selected?.presetAssigneeId || undefined,
                    comment: comment.trim(),
                    dueAt: dueLocal
                      ? new Date(dueLocal).toISOString()
                      : undefined,
                  });
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Не удалось отправить',
                  );
                }
              })();
            }}
          >
            {busy ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
}
