'use client';

import {
  MembershipStatus,
  classifyVisitKind,
  type ClientMembershipPackage,
  type Membership,
  type MembershipServiceQuota,
  type ProductModuleKey,
  type VisitKind,
} from '@fitgo/shared-types';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HomeMembershipCard } from '@/components/client/home-membership-card';
import {
  formatDate,
  membershipStatusLabel,
} from '@/lib/utils';

export function membershipServiceAction(
  serviceName: string,
  isEnabled: (key: ProductModuleKey) => boolean,
  packageId?: string,
): { href: string; label: string } | { reception: true; href: string } | null {
  const kind: VisitKind = classifyVisitKind({
    title: serviceName,
    basisType: 'service',
  });
  if (kind === 'SPA_MASSAGE' || kind === 'SPA_BODYCOMP') {
    if (!isEnabled('spa_booking')) return null;
    const q = new URLSearchParams({ service: serviceName });
    if (packageId) q.set('package', packageId);
    return {
      href: `/client/schedule/spa?${q}`,
      label: 'Записаться',
    };
  }
  if (kind === 'GROUP') {
    if (!isEnabled('group_classes')) return null;
    return {
      href: `/client/schedule?service=${encodeURIComponent(serviceName)}`,
      label: 'Записаться',
    };
  }
  if (kind === 'PT') {
    return { href: '/client/schedule/personal', label: 'Записаться' };
  }
  if (kind === 'SOLARIUM' || /полотен|аренда/i.test(serviceName)) {
    return { reception: true, href: '/client/card' };
  }
  return null;
}

function ServiceQuotaRow({
  service,
  action,
}: {
  service: MembershipServiceQuota;
  action: ReturnType<typeof membershipServiceAction>;
}) {
  const hasQuota = service.unlimited || (service.remaining ?? 0) > 0;
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="min-w-0 truncate text-ink/80">{service.name}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums text-ink/55">
          {service.unlimited
            ? '∞'
            : service.remaining !== undefined
              ? service.total
                ? `${service.remaining}/${service.total}`
                : String(service.remaining)
              : '—'}
        </span>
        {hasQuota && action && 'href' in action && !('reception' in action) ? (
          <Link
            href={action.href}
            className="rounded-lg bg-ink/15 px-2 py-1 text-xs font-semibold text-ink"
          >
            {action.label}
          </Link>
        ) : hasQuota && action && 'reception' in action ? (
          <Link
            href={action.href}
            className="rounded-lg bg-ink/10 px-2 py-1 text-xs font-semibold text-ink/70"
          >
            На ресепшене
          </Link>
        ) : null}
      </span>
    </li>
  );
}

function PendingMembershipCard({ pkg }: { pkg: ClientMembershipPackage }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-ink-elevated/90 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Следующий абонемент
          </p>
          <p className="mt-0.5 truncate font-display text-lg font-bold text-white">
            {pkg.name}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200">
          {membershipStatusLabel(pkg.normalizedStatus)}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-400">
        {pkg.validFrom
          ? `Начнёт действовать с ${formatDate(pkg.validFrom)}`
          : 'Ожидает активации'}
        {pkg.validUntil ? ` · до ${formatDate(pkg.validUntil)}` : ''}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Активация на ресепшене или автоматически после текущего
      </p>
    </div>
  );
}

function ServicePackageCard({
  pkg,
  isEnabled,
}: {
  pkg: ClientMembershipPackage;
  isEnabled: (key: ProductModuleKey) => boolean;
}) {
  const quotas = pkg.serviceQuotas ?? [];
  return (
    <div className="rounded-3xl border border-white/10 bg-ink-elevated/90 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Пакет услуг
          </p>
          <p className="mt-0.5 truncate font-display text-base font-bold text-white">
            {pkg.name}
          </p>
        </div>
        {pkg.validUntil ? (
          <span className="shrink-0 text-xs text-zinc-500">
            до {formatDate(pkg.validUntil)}
          </span>
        ) : null}
      </div>
      {quotas.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {quotas.map((service) => {
            const action = membershipServiceAction(
              service.name,
              isEnabled,
              pkg.id,
            );
            const hasQuota =
              service.unlimited || (service.remaining ?? 0) > 0;
            const pct =
              !service.unlimited &&
              service.total &&
              service.remaining !== undefined
                ? Math.round((service.remaining / service.total) * 100)
                : null;
            return (
              <li key={service.name} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-200">
                    {service.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-zinc-400">
                      {service.unlimited
                        ? '∞'
                        : service.remaining !== undefined && service.total
                          ? `${service.remaining} из ${service.total}`
                          : service.remaining !== undefined
                            ? String(service.remaining)
                            : '—'}
                    </span>
                    {hasQuota && action && !('reception' in action) ? (
                      <Link
                        href={action.href}
                        className="rounded-lg bg-forma-500/20 px-2 py-1 text-xs font-semibold text-forma-300"
                      >
                        {action.label}
                      </Link>
                    ) : hasQuota && action && 'reception' in action ? (
                      <Link
                        href={action.href}
                        className="rounded-lg bg-white/5 px-2 py-1 text-xs font-semibold text-zinc-400"
                      >
                        На ресепшене
                      </Link>
                    ) : null}
                  </span>
                </div>
                {pct !== null ? (
                  <div className="h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-forma-500"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Нет доступных услуг</p>
      )}
    </div>
  );
}

export function MembershipWallet({
  membership,
  packages,
  membershipSource,
  isEnabled,
  onFrozen,
}: {
  membership: Membership;
  packages: ClientMembershipPackage[];
  membershipSource?: '1c' | 'osmi' | 'derived' | null;
  isEnabled: (key: ProductModuleKey) => boolean;
  onFrozen: (next: Membership) => void;
}) {
  const primaryId = membership.id;
  const pendingMemberships = packages.filter(
    (p) =>
      (p.kind ?? 'membership') === 'membership' &&
      p.normalizedStatus === MembershipStatus.PENDING &&
      p.id !== primaryId,
  );
  const servicePackages = packages.filter(
    (p) =>
      p.kind === 'package' &&
      p.normalizedStatus !== MembershipStatus.EXPIRED &&
      p.normalizedStatus !== MembershipStatus.PENDING,
  );

  // When packages API is available, show only this membership's own quotas on the hero card.
  const primaryPkg = packages.find((p) => p.id === primaryId);
  const heroServices: MembershipServiceQuota[] =
    primaryPkg?.serviceQuotas?.length
      ? primaryPkg.serviceQuotas
      : packages.length === 0
        ? membership.services ?? []
        : membership.services?.filter((s) => {
            // Exclude lines that already appear on a service package card.
            return !servicePackages.some((pkg) =>
              pkg.serviceQuotas.some((q) => q.name === s.name),
            );
          }) ?? [];

  const membershipForCard: Membership = {
    ...membership,
    services: heroServices,
  };

  const serviceActions: ReactNode =
    heroServices.length > 0 ? (
      <ul className="space-y-1.5 border-t border-ink/10 pt-3">
        {heroServices.slice(0, 8).map((service) => (
          <ServiceQuotaRow
            key={service.name}
            service={service}
            action={membershipServiceAction(
              service.name,
              isEnabled,
              primaryId,
            )}
          />
        ))}
      </ul>
    ) : null;

  return (
    <div className="space-y-3">
      <HomeMembershipCard
        membership={membershipForCard}
        membershipSource={membershipSource}
        onFrozen={onFrozen}
        serviceActions={serviceActions}
      />

      {pendingMemberships.map((pkg) => (
        <PendingMembershipCard key={pkg.id} pkg={pkg} />
      ))}

      {servicePackages.length > 0 ? (
        <div className="space-y-2">
          <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Пакеты услуг
          </p>
          {servicePackages.map((pkg) => (
            <ServicePackageCard
              key={pkg.id}
              pkg={pkg}
              isEnabled={isEnabled}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
