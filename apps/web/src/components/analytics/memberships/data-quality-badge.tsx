'use client';

import type { MembershipDataQuality } from '@fitgo/shared-types';
import { cov } from './format';

export function DataQualityBadge({
  quality,
}: {
  quality: MembershipDataQuality;
}) {
  const visitLink = quality.visitLinkCoverage ?? quality.saleMatchCoverage;
  const ok =
    quality.packageDocCoverage >= 0.8 &&
    visitLink >= 0.5 &&
    quality.gpTrainerRateCoverage >= 0.5 &&
    quality.profilesNeedingReview === 0;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs ${
        ok
          ? 'bg-emerald-500/10 text-emerald-300'
          : 'bg-amber-500/10 text-amber-300'
      }`}
      title={quality.warning ?? undefined}
    >
      Данные: Doc {cov(quality.packageDocCoverage)} · визиты{' '}
      {cov(visitLink)} · ЛС {cov(quality.personalAccountCoverage)} · скидки{' '}
      {cov(quality.discountMatchCoverage)} · тренер ГП{' '}
      {cov(quality.gpTrainerRateCoverage)}
      {quality.profilesNeedingReview > 0 && (
        <> · карточек на проверку {quality.profilesNeedingReview}</>
      )}
    </div>
  );
}
