'use client';

import { ResponsiveSheet, SegmentedControl } from '@fitgo/forma-ui';
import { Mic, MicOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NotesTab = 'client' | 'private' | 'homework';

const CLIENT_CHIPS = [
  'Отличная техника',
  'В следующий раз +2,5 кг',
  'Следить за коленями',
  'Дыхание ровнее',
  'Хорошая работа сегодня',
] as const;

const PRIVATE_CHIPS = [
  'Снизить нагрузку на колено',
  'Обсудить питание',
  'Мотивация проседает',
  'Готов к прогрессии',
] as const;

export function SessionNotesSheet({
  open,
  onOpenChange,
  clientNotes,
  privateNotes,
  homeworkDraft,
  onChangeClient,
  onChangePrivate,
  onChangeHomework,
  onSave,
  busy,
  showHomeworkTab = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientNotes: string;
  privateNotes: string;
  homeworkDraft: string;
  onChangeClient: (v: string) => void;
  onChangePrivate: (v: string) => void;
  onChangeHomework: (v: string) => void;
  onSave?: () => void | Promise<void>;
  busy?: boolean;
  showHomeworkTab?: boolean;
}) {
  const [tab, setTab] = useState<NotesTab>('client');
  const [listening, setListening] = useState(false);
  type SpeechRec = {
    stop: () => void;
    abort: () => void;
    start: () => void;
    onresult: ((ev: unknown) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    lang: string;
    continuous: boolean;
    interimResults: boolean;
  };
  const recognitionRef = useRef<SpeechRec | null>(null);

  const appendToActive = useCallback(
    (text: string) => {
      const chunk = text.trim();
      if (!chunk) return;
      if (tab === 'client') {
        onChangeClient(
          clientNotes ? `${clientNotes.trim()} ${chunk}` : chunk,
        );
      } else if (tab === 'private') {
        onChangePrivate(
          privateNotes ? `${privateNotes.trim()} ${chunk}` : chunk,
        );
      } else {
        onChangeHomework(
          homeworkDraft ? `${homeworkDraft.trim()} ${chunk}` : chunk,
        );
      }
    },
    [
      tab,
      clientNotes,
      privateNotes,
      homeworkDraft,
      onChangeClient,
      onChangePrivate,
      onChangeHomework,
    ],
  );

  useEffect(() => {
    if (!open) {
      recognitionRef.current?.stop();
      setListening(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const toggleDictation = () => {
    const SR =
      typeof window !== 'undefined'
        ? (
            window as unknown as {
              SpeechRecognition?: new () => SpeechRec;
              webkitSpeechRecognition?: new () => SpeechRec;
            }
          ).SpeechRecognition ||
          (
            window as unknown as {
              webkitSpeechRecognition?: new () => SpeechRec;
            }
          ).webkitSpeechRecognition
        : undefined;
    if (!SR) {
      window.alert('Диктовка не поддерживается в этом браузере');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec: SpeechRec = new SR();
    recognitionRef.current = rec;
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev: unknown) => {
      const e = ev as {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      };
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i]?.isFinal) text += e.results[i]![0].transcript;
      }
      if (text) appendToActive(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const value =
    tab === 'client'
      ? clientNotes
      : tab === 'private'
        ? privateNotes
        : homeworkDraft;
  const setValue =
    tab === 'client'
      ? onChangeClient
      : tab === 'private'
        ? onChangePrivate
        : onChangeHomework;
  const chips = tab === 'private' ? PRIVATE_CHIPS : CLIENT_CHIPS;

  const options: Array<{ value: NotesTab; label: string }> = [
    { value: 'client', label: 'Для клиента' },
    { value: 'private', label: 'Для себя' },
  ];
  if (showHomeworkTab) {
    options.push({ value: 'homework', label: 'Задание' });
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Заметки"
      description="Клиент увидит только вкладку «Для клиента» и задание"
      desktop="dialog"
    >
      <div className="space-y-4 pb-4">
        <SegmentedControl
          options={options}
          value={tab}
          onChange={setTab}
          size="sm"
          layoutId="session-notes-tab"
        />

        {tab === 'homework' ? (
          <p className="text-xs text-zinc-500">
            Кратко опишите задание — структурированные пункты и прогресс
            появятся в карточке клиента после сохранения.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => appendToActive(chip)}
              className="rounded-full border border-white/10 bg-ink-raised px-3 py-1.5 text-xs text-zinc-300"
            >
              {chip}
            </button>
          ))}
        </div>

        <textarea
          className="input min-h-[140px] w-full resize-y py-3 text-sm leading-relaxed"
          style={{ height: 'auto', minHeight: 140 }}
          placeholder={
            tab === 'client'
              ? 'Что увидит клиент после тренировки…'
              : tab === 'private'
                ? 'Только для вас…'
                : 'Задание до следующей тренировки…'
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleDictation}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
          >
            {listening ? (
              <MicOff className="h-4 w-4 text-forma-400" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {listening ? 'Стоп' : 'Диктовка'}
          </button>
          {onSave ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSave()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
          ) : null}
        </div>
      </div>
    </ResponsiveSheet>
  );
}
