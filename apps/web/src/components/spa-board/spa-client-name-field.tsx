'use client';

import type { SpaSpecialistClientSuggestion } from '@fitgo/shared-types';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatLastVisit(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

export function SpaClientNameField({
  guestName,
  guestPhone,
  specialistId,
  onGuestNameChange,
  onPick,
  onClearPick,
}: {
  guestName: string;
  guestPhone: string;
  specialistId?: string;
  onGuestNameChange: (name: string) => void;
  onPick: (s: SpaSpecialistClientSuggestion) => void;
  onClearPick?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<
    SpaSpecialistClientSuggestion[]
  >([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = guestName.trim();
    const phoneDigits = guestPhone.replace(/\D/g, '');
    const nameOk = q.length >= 2;
    const phoneOk = phoneDigits.length >= 4;
    if (!nameOk && !phoneOk) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const token = getToken();
    if (!token) return;

    const my = ++seq.current;
    const t = window.setTimeout(() => {
      setBusy(true);
      void api
        .searchSpaSpecialistClients(
          token,
          nameOk ? q : phoneDigits,
          specialistId,
        )
        .then((rows) => {
          if (my !== seq.current) return;
          setSuggestions(rows);
          setOpen(rows.length > 0);
        })
        .catch(() => {
          if (my !== seq.current) return;
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => {
          if (my === seq.current) setBusy(false);
        });
    }, 300);
    return () => window.clearTimeout(t);
  }, [guestName, guestPhone, specialistId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="relative space-y-1 text-sm">
      <label className="block space-y-1">
        <span className="text-slate-400">ФИО</span>
        <input
          className="input"
          value={guestName}
          autoComplete="off"
          onChange={(e) => {
            onGuestNameChange(e.target.value);
            onClearPick?.();
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          placeholder="Начните вводить имя"
        />
      </label>
      {busy ? (
        <p className="text-[11px] text-slate-500">Поиск…</p>
      ) : null}
      {open && suggestions.length > 0 ? (
        <ul className="absolute z-20 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 py-1 shadow-lg">
          {suggestions.map((s) => (
            <li key={`${s.clientExternalId ?? ''}:${s.clientId ?? ''}:${s.label}:${s.guestPhone ?? ''}`}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(s);
                  setOpen(false);
                }}
              >
                <span className="text-slate-100">{s.label}</span>
                <span className="text-[11px] text-slate-500">
                  {[
                    s.guestPhone,
                    s.visitCount > 1 ? `${s.visitCount} визита` : '1 визит',
                    formatLastVisit(s.lastVisitAt),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
