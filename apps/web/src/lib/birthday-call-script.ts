const CLUB_TZ = 'Europe/Minsk';

/** Greeting by club local hour (Europe/Minsk). */
export function birthdayGreeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: CLUB_TZ,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return 'доброе утро';
  if (hour < 17) return 'добрый день';
  return 'добрый вечер';
}

/**
 * First name from task title «День рождения: Фамилия Имя» when meta has no firstName.
 */
export function firstNameFromBirthdayTitle(title?: string | null): string {
  const raw = (title ?? '').replace(/^День рождения:\s*/i, '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1]! : parts[0] ?? '';
}

export function formatBirthdayCallScript(opts: {
  firstName?: string | null;
  middleName?: string | null;
  title?: string | null;
  now?: Date;
}): string {
  const first =
    (opts.firstName ?? '').trim() ||
    firstNameFromBirthdayTitle(opts.title) ||
    'Уважаемый клиент';
  const middle = (opts.middleName ?? '').trim();
  const address = middle ? `${first} ${middle}` : first;
  const greeting = birthdayGreeting(opts.now);

  return [
    `${address}, ${greeting}.`,
    'Фитнес-студия «Форма» поздравляет Вас с днём рождения.',
    'Желаем ярких дней, тёплых встреч и хорошего настроения. Оставайтесь в форме — будем рады видеть Вас.',
    'В подарок для Вас — бесплатный напиток в студии. Забрать можно в течение этой недели.',
  ].join('\n');
}
