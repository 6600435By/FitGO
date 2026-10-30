'use client';

const NOTE_MAX = 280;

type Props = {
  clientNote: string;
  visitNote: string;
  clientNoteSaved: string;
  clientNoteEnabled: boolean;
  clientNoteBusy?: boolean;
  onClientNoteChange: (value: string) => void;
  onVisitNoteChange: (value: string) => void;
  onSaveClientNote: () => void;
};

export function SpaBookingNotesFields({
  clientNote,
  visitNote,
  clientNoteSaved,
  clientNoteEnabled,
  clientNoteBusy,
  onClientNoteChange,
  onVisitNoteChange,
  onSaveClientNote,
}: Props) {
  const clientDirty = clientNote.trim() !== clientNoteSaved.trim();
  const showSave = clientNoteEnabled && clientDirty;

  return (
    <div className="space-y-3 rounded-xl border border-white/5 bg-slate-900/40 p-3">
      <p className="text-sm font-medium text-slate-300">Комментарии</p>

      <label className="block space-y-1 text-sm">
        <span className="text-slate-400">Клиент · на всех записях</span>
        <textarea
          className="input min-h-[4.5rem] resize-y"
          value={clientNote}
          disabled={!clientNoteEnabled}
          maxLength={NOTE_MAX}
          placeholder={
            clientNoteEnabled
              ? 'Например: не звонить для подтверждения'
              : 'Выберите клиента или укажите телефон'
          }
          onChange={(e) => onClientNoteChange(e.target.value)}
        />
        <p className="text-[11px] text-slate-500">
          Виден в журнале SPA и в задачах на подтверждение для этого человека.
        </p>
        {showSave ? (
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={clientNoteBusy}
            onClick={() => onSaveClientNote()}
          >
            {clientNoteBusy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        ) : null}
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-slate-400">Эта запись</span>
        <textarea
          className="input min-h-[4.5rem] resize-y"
          value={visitNote}
          maxLength={NOTE_MAX}
          placeholder="Например: выдать 2 полотенца"
          onChange={(e) => onVisitNoteChange(e.target.value)}
        />
        <p className="text-[11px] text-slate-500">
          Только для этого занятия — в ячейке журнала и в задаче подтверждения.
        </p>
      </label>
    </div>
  );
}

export { NOTE_MAX as SPA_NOTE_MAX };
