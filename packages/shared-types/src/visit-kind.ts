export type VisitKind =
  | 'GYM'
  | 'GROUP'
  | 'PT'
  | 'SPA_MASSAGE'
  | 'SPA_BODYCOMP'
  | 'SOLARIUM'
  | 'UNKNOWN';

export type VisitVerificationStatus =
  | 'PENDING'
  | 'VERIFIED_1C'
  | 'VERIFIED_TRAINER'
  | 'VERIFIED_CLIENT_SELF'
  | 'REJECTED';

export type VisitBasisType = 'membership' | 'class' | 'service' | 'other';

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  GYM: 'Тренажёрный зал',
  GROUP: 'Групповая',
  PT: 'Персональная',
  SPA_MASSAGE: 'Массаж',
  SPA_BODYCOMP: 'Анализ состава тела',
  SOLARIUM: 'Солярий',
  UNKNOWN: 'Посещение',
};

const KIND_ALIASES: Record<string, VisitKind> = {
  GYM: 'GYM',
  GROUP: 'GROUP',
  PT: 'PT',
  PERSONAL: 'PT',
  SPA_MASSAGE: 'SPA_MASSAGE',
  MASSAGE: 'SPA_MASSAGE',
  SPA_BODYCOMP: 'SPA_BODYCOMP',
  BODYCOMP: 'SPA_BODYCOMP',
  BODY_COMPOSITION: 'SPA_BODYCOMP',
  SOLARIUM: 'SOLARIUM',
  UNKNOWN: 'UNKNOWN',
};

/** Normalize kind from 1C / API string. */
export function parseVisitKind(raw?: string | null): VisitKind | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return KIND_ALIASES[key];
}

/**
 * Heuristic classification when 1C has not sent an explicit `kind`.
 * Prefer `parseVisitKind` / basisType when available.
 */
export function classifyVisitKind(input: {
  kind?: string | null;
  basisType?: string | null;
  title?: string | null;
  sessionType?: string | null;
}): VisitKind {
  const explicit = parseVisitKind(input.kind);
  if (explicit) return explicit;

  const basis = (input.basisType ?? '').toLowerCase();
  if (basis === 'membership') return 'GYM';
  if (basis === 'class') return 'GROUP';

  const session = (input.sessionType ?? '').toUpperCase();
  if (session === 'PERSONAL' || session === 'PT') return 'PT';
  if (session === 'GROUP') return 'GROUP';

  const title = (input.title ?? '').toLowerCase();
  if (!title) return basis === 'service' ? 'UNKNOWN' : 'GYM';

  if (
    /персонал|personal|pt\b|индивидуал/.test(title) ||
    title.includes('персональная')
  ) {
    return 'PT';
  }
  if (
    /массаж|massage|spa\b/.test(title) &&
    !/состав|inbody|анализ/.test(title)
  ) {
    return 'SPA_MASSAGE';
  }
  if (/состав\s*тела|inbody|биоимпеданс|body\s*comp/.test(title)) {
    return 'SPA_BODYCOMP';
  }
  if (/соляр|solarium|tanning/.test(title)) {
    return 'SOLARIUM';
  }
  if (
    /йога|yoga|pilates|пилатес|spin|сайкл|aerobics|аэробик|зумба|zumba|crossfit|кроссфит|функционал|бассейн|swim|танц|dance|stretch|стретч|группа|group|занятие/.test(
      title,
    )
  ) {
    return 'GROUP';
  }
  if (/членство|абонемент|тренаж|зал|gym|fitness|посещение/.test(title)) {
    return 'GYM';
  }

  if (basis === 'service') return 'UNKNOWN';
  return 'GYM';
}

export function isVerifiedVisitStatus(
  status?: VisitVerificationStatus | null,
): boolean {
  return (
    status === 'VERIFIED_1C' ||
    status === 'VERIFIED_TRAINER' ||
    status === 'VERIFIED_CLIENT_SELF'
  );
}
