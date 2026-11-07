'use client';

import { HOMEWORK_TEMPLATES } from '@fitgo/shared-types';
import { ResponsiveSheet, SegmentedControl } from '@fitgo/forma-ui';
import { Mic, MicOff, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NotesTab = 'client' | 'private' | 'homework';

export type HomeworkDraftItem = {
  kind?: string;
  title: string;
  target?: string;
  timesRequired?: number;
};

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
  homeworkItems = [],
  onChangeClient,
  onChangePrivate,
  onChangeHomework,
  onChangeHomeworkItems,
  onRepeatPrevious,
  activeHomeworkProgress,
  onSave,
  busy,
  showHomeworkTab = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientNotes: string;
  privateNotes: string;
  homeworkDraft: string;
  homeworkItems?: HomeworkDraftItem[];
  onChangeClient: (v: string) => void;
  onChangePrivate: (v: string) => void;
  onChangeHomework: (v: string) => void;
  onChangeHomeworkItems?: (items: HomeworkDraftItem[]) => void;
  onRepeatPrevious?: () => void | Promise<void>;
  activeHomeworkProgress?: {
    done: number;
    total: number;
    summary?: string;
  } | null;
  onSave?: () => void | Promise<void>;
  busy?: boolean;
  showHomeworkTab?: boolean;
}) {
  const [tab, setTab] = useState<NotesTab>('client');
  const [listening, setListening] = useState(false);
  const [repeatBusy, setRepeatBusy] = useState(false);
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

  const applyTemplate = (tplId: string) => {
    const tpl = HOMEWORK_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    onChangeHomework(tpl.title);
    onChangeHomeworkItems?.(tpl.items.map((i) => ({ ...i })));
  };

  const repeatPrevious = async () => {
    if (!onRepeatPrevious) return;
    setRepeatBusy(true);
    try {
      await onRepeatPrevious();
    } finally {
      setRepeatBusy(false);
    }
  };

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
          <div className="space-y-3">
            {activeHomeworkProgress && activeHomeworkProgress.total > 0 ? (
              <p className="rounded-2xl border border-forma-500/20 bg-forma-500/10 px-3 py-2 text-xs text-forma-300">
                Текущее задание:{' '}
                <span className="font-semibold text-forma-400">
                  {activeHomeworkProgress.done} из{' '}
                  {activeHomeworkProgress.total}
                </span>
                {activeHomeworkProgress.summary
                  ? ` · ${activeHomeworkProgress.summary}`
                  : null}
              </p>
            ) : null}

            <p className="text-xs text-zinc-500">
              Шаблон или прошлое задание — пункты с прогрессом у клиента. Можно
              оставить только текст.
            </p>

            <div className="flex flex-wrap gap-2">
              {HOMEWORK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl.id)}
                  title={tpl.description}
                  className="rounded-full border border-forma-500/30 bg-forma-500/10 px-3 py-1.5 text-xs text-forma-300"
                >
                  {tpl.title}
                </button>
              ))}
              {onRepeatPrevious ? (
                <button
                  type="button"
                  disabled={repeatBusy || busy}
                  onClick={() => void repeatPrevious()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-raised px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {repeatBusy ? 'Загрузка…' : 'Повторить прошлое'}
                </button>
              ) : null}
            </div>

            {homeworkItems.length > 0 ? (
              <ul className="space-y-1.5 rounded-2xl border border-white/10 bg-ink-raised/40 px-3 py-2">
                {homeworkItems.map((item, idx) => (
                  <li
                    key={`${item.title}-${idx}`}
                    className="text-xs text-zinc-300"
                  >
                    <span className="font-medium text-white">{item.title}</span>
                    {item.target ? (
                      <span className="text-zinc-500"> · {item.target}</span>
                    ) : null}
                    {item.timesRequired && item.timesRequired > 1 ? (
                      <span className="text-zinc-500">
                        {' '}
                        · {item.timesRequired}×
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
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
        )}

        <textarea
          className="input min-h-[140px] w-full resize-y py-3 text-sm leading-relaxed"
          style={{ height: 'auto', minHeight: 140 }}
          placeholder={
            tab === 'client'
              ? 'Что увидит клиент после тренировки…'
              : tab === 'private'
                ? 'Только для вас…'
                : 'Краткое описание задания (или выберите шаблон)…'
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
