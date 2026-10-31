/** Download a minimal .ics for a booking / class. */
export function downloadIcsEvent(opts: {
  title: string;
  startAt: string;
  endAt?: string;
  location?: string;
  description?: string;
}) {
  const start = new Date(opts.startAt);
  const end = opts.endAt
    ? new Date(opts.endAt)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Forma//FitGO//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2)}@forma.ffs.by`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(opts.title)}`,
    opts.location ? `LOCATION:${escape(opts.location)}` : '',
    opts.description ? `DESCRIPTION:${escape(opts.description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${opts.title.replace(/\s+/g, '-').slice(0, 40)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
