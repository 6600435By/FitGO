import type { PayrollPeriodSummary, StaffPaySummary } from '@fitgo/shared-types';

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAYSLIP_SALE_SEGMENTS: Array<{
  label: string;
  sold: (s: PayrollPeriodSummary) => number;
  contrib: (s: PayrollPeriodSummary) => number;
}> = [
  {
    label: 'Абонементы',
    sold: (s) => s.sales?.membershipMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.membershipMinor ?? 0,
  },
  {
    label: 'SPA',
    sold: (s) => s.sales?.massageMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.spaMinor ?? 0,
  },
  {
    label: 'Солярий',
    sold: (s) => s.sales?.solariumMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.solariumMinor ?? 0,
  },
  {
    label: 'Магазин',
    sold: (s) => s.sales?.shopMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.shopMinor ?? 0,
  },
  {
    label: 'Корпо',
    sold: (s) => s.sales?.corporateMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.corporateMinor ?? 0,
  },
];

function hasPayslipSalesSegments(summary: PayrollPeriodSummary): boolean {
  return summary.sales != null || summary.motivationBreakdown != null;
}

function payslipSalesSegmentHtml(
  summary: PayrollPeriodSummary,
  cur: string,
): string | null {
  if (!hasPayslipSalesSegments(summary)) return null;
  const rows = PAYSLIP_SALE_SEGMENTS.map((seg) => {
    const sold = money(seg.sold(summary), cur);
    const contrib = money(seg.contrib(summary), cur);
    return `<tr><td>${escapeHtml(seg.label)}</td><td class="num">${escapeHtml(sold)}</td><td class="num">${escapeHtml(contrib)}</td></tr>`;
  }).join('');
  return `<h2>Продажи по сегментам</h2><table><thead><tr><th>Сегмент</th><th class="num">Продано</th><th class="num">В мотивацию</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export type PayslipFields = {
  fio: boolean;
  period: boolean;
  motivation: boolean;
  bonus: boolean;
  fine: boolean;
  totals: boolean;
  shifts: boolean;
};

/** Defaults when opening the print dialog. */
export const DEFAULT_PAYSLIP: PayslipFields = {
  fio: true,
  period: true,
  motivation: true,
  bonus: true,
  fine: true,
  totals: true,
  shifts: false,
};

export const ALL_PAYSLIP: PayslipFields = {
  fio: true,
  period: true,
  motivation: true,
  bonus: true,
  fine: true,
  totals: true,
  shifts: true,
};

function payslipHeaderOnly(fields: PayslipFields): boolean {
  return (
    (fields.fio || fields.period) &&
    !fields.motivation &&
    !fields.bonus &&
    !fields.fine &&
    !fields.shifts &&
    !fields.totals
  );
}

export function payslipHtmlFromSummary(
  summary: PayrollPeriodSummary,
  fields: PayslipFields,
): string {
  const cur = summary.currency;
  const bonuses = summary.adjustments.filter((a) => a.amountMinor > 0);
  const fines = summary.adjustments.filter((a) => a.amountMinor < 0);
  const centered = payslipHeaderOnly(fields);
  const slipClass = centered ? 'slip slip--centered' : 'slip';
  const parts: string[] = [`<section class="${slipClass}">`];
  if (centered) {
    parts.push('<div class="sheet">');
  }
  if (fields.fio || fields.period) {
    parts.push('<div class="header-block">');
    if (fields.fio) {
      parts.push(
        `<p class="meta meta-name">${escapeHtml(summary.performerName)}</p>`,
      );
    }
    if (fields.period) {
      parts.push(
        `<p class="meta"><strong>Период:</strong> ${escapeHtml(summary.from)} — ${escapeHtml(summary.to)}</p>`,
      );
    }
    parts.push('</div>');
  }
  if (fields.motivation) {
    parts.push('<h2>Начисления</h2><table>');
    parts.push(
      `<tr><td>Оклад / часы</td><td class="num">${escapeHtml(money(summary.baseSalaryMinor, cur))}</td></tr>`,
    );
    parts.push(
      `<tr><td>Мотивация</td><td class="num">${escapeHtml(money(summary.motivationMinor, cur))}</td></tr>`,
    );
    parts.push('</table>');
    const chips =
      summary.payChips?.length > 0 ? summary.payChips : ['Ставки не заданы'];
    parts.push(
      `<p class="chips">${chips.map((c) => escapeHtml(c)).join(' · ')}</p>`,
    );
    const salesBlock = payslipSalesSegmentHtml(summary, cur);
    if (salesBlock) parts.push(salesBlock);
  }
  if (fields.bonus) {
    parts.push('<h2>Премии</h2>');
    if (!bonuses.length) parts.push('<p class="empty">нет</p>');
    else {
      parts.push('<table>');
      for (const a of bonuses) {
        parts.push(
          `<tr><td>${escapeHtml(a.reason)}</td><td class="num">+${escapeHtml(money(a.amountMinor, cur))}</td></tr>`,
        );
      }
      parts.push('</table>');
    }
  }
  if (fields.fine) {
    parts.push('<h2>Штрафы</h2>');
    if (!fines.length) parts.push('<p class="empty">нет</p>');
    else {
      parts.push('<table>');
      for (const a of fines) {
        parts.push(
          `<tr><td>${escapeHtml(a.reason)}</td><td class="num">${escapeHtml(money(a.amountMinor, cur))}</td></tr>`,
        );
      }
      parts.push('</table>');
    }
  }
  if (fields.shifts) {
    const shifts = summary.workUnits.filter((u) => u.kind === 'SHIFT');
    parts.push('<h2>Смены</h2>');
    if (!shifts.length) parts.push('<p class="empty">нет</p>');
    else {
      parts.push('<table>');
      for (const u of shifts) {
        parts.push(
          `<tr><td>${escapeHtml(u.occurredAt.slice(0, 10))} · ${u.quantity} ч</td><td class="num">${escapeHtml(money(u.priceMinor ?? 0, cur))}</td></tr>`,
        );
      }
      parts.push('</table>');
    }
  }
  if (fields.totals) {
    parts.push(
      `<p class="total"><strong>Итого начислено:</strong> ${escapeHtml(money(summary.totalMinor, cur))}</p>`,
    );
    const paid = summary.paidPayouts;
    if (paid && paid.totalPaidMinor > 0) {
      if (paid.advanceMinor > 0) {
        parts.push(
          `<p>Аванс выплачен (факт): ${escapeHtml(money(paid.advanceMinor, cur))} (карта ${escapeHtml(money(paid.advanceCardMinor, cur))} · касса ${escapeHtml(money(paid.advanceCashMinor, cur))})</p>`,
        );
      }
      parts.push(
        `<p>Выплачено всего: ${escapeHtml(money(paid.totalPaidMinor, cur))}</p>`,
      );
      const rest = Math.max(0, summary.totalMinor - paid.totalPaidMinor);
      parts.push(
        `<p class="total"><strong>Остаток к выплате:</strong> ${escapeHtml(money(rest, cur))}</p>`,
      );
    }
  }
  if (centered) {
    parts.push('</div>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

export function printHtmlPayslips(
  sections: Array<{ name: string; html: string }>,
) {
  if (!sections.length) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'style',
    'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0',
  );
  iframe.setAttribute('title', 'Печать расчётных листков');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  const body = sections
    .map((s, i) =>
      i > 0 ? s.html.replace('class="slip', 'class="slip slip-next') : s.html,
    )
    .join('\n');
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Печать</title>
<style>
  @page{size:A4;margin:14mm}
  html,body{margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#111;line-height:1.45;background:#fff}
  .slip{max-width:640px;margin:0 auto;box-sizing:border-box}
  .slip-next{page-break-before:always;break-before:page}
  .slip--centered{max-width:none;width:100%;margin:0}
  .slip--centered .sheet{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:250mm;text-align:center}
  .header-block{text-align:center;margin:0 0 16px}
  .slip--centered .header-block{margin:0}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin:16px 0 6px}
  table{width:100%;border-collapse:collapse}
  th{padding:4px 0;border-bottom:1px solid #ccc;font-size:11px;text-align:left;font-weight:600;color:#555}
  th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td{padding:4px 0;border-bottom:1px solid #e5e7eb;vertical-align:top}
  .meta{margin:4px 0;color:#333;font-size:14px}
  .meta-name{font-size:16px;font-weight:600}
  .chips{font-size:11px;color:#666;margin-top:6px}
  .empty{color:#999;margin:0}
  .total{margin-top:16px;padding-top:12px;border-top:2px solid #111;font-size:15px}
</style></head><body>${body}</body></html>`);
  doc.close();

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };
  const win = iframe.contentWindow;
  if (win) {
    win.addEventListener('afterprint', cleanup, { once: true });
  }
  const run = () => {
    try {
      win?.focus();
      win?.print();
    } catch {
      cleanup();
    }
    setTimeout(cleanup, 60_000);
  };
  if (iframe.contentDocument?.readyState === 'complete') {
    setTimeout(run, 50);
  } else {
    iframe.addEventListener('load', () => setTimeout(run, 50), { once: true });
  }
}

/** Safe filename: ФИО + period, without forbidden path characters. */
export function payslipFilename(
  name: string,
  from: string,
  to: string,
): string {
  const safe = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
    .slice(0, 80);
  const period = `${from}_${to}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
  return `Raschet_${safe || 'sotrudnik'}_${period}.txt`;
}

export function buildPayslipText(opts: {
  fields: PayslipFields;
  source: PayrollPeriodSummary | null;
  ids: Set<string>;
  from: string;
  to: string;
  staff: StaffPaySummary[];
}): string {
  const { fields, source, ids, from: rangeFrom, to: rangeTo, staff } = opts;
  if (!source) {
    const first = staff.find((s) => ids.has(s.userId))?.name ?? '…';
    const lines: string[] = [];
    if (fields.fio) lines.push(first);
    if (fields.period) lines.push(`Период: ${rangeFrom} — ${rangeTo}`);
    if (
      fields.motivation ||
      fields.bonus ||
      fields.fine ||
      fields.shifts ||
      fields.totals
    ) {
      lines.push('');
      lines.push(
        `(детальные поля подставятся при печати по ${ids.size} сотрудник(ам))`,
      );
    }
    if (ids.size > 1) {
      lines.push('');
      lines.push(`Выбрано сотрудников: ${ids.size}`);
    }
    lines.push('');
    return lines.join('\n');
  }
  const cur = source.currency;
  const bonuses = source.adjustments.filter((a) => a.amountMinor > 0);
  const fines = source.adjustments.filter((a) => a.amountMinor < 0);
  const lines: string[] = [];
  if (fields.fio) lines.push(source.performerName);
  if (fields.period) lines.push(`Период: ${source.from} — ${source.to}`);
  if (fields.motivation) {
    lines.push('');
    lines.push('Мотивация / ставки:');
    const chips =
      source.payChips?.length > 0 ? source.payChips : ['Ставки не заданы'];
    for (const c of chips) lines.push(`  · ${c}`);
    lines.push(`  Оклад / часы: ${money(source.baseSalaryMinor, cur)}`);
    lines.push(`  Мотивация: ${money(source.motivationMinor, cur)}`);
    if (hasPayslipSalesSegments(source)) {
      lines.push('');
      lines.push('Продажи по сегментам (продано → в мотивацию):');
      for (const seg of PAYSLIP_SALE_SEGMENTS) {
        lines.push(
          `  ${seg.label}: ${money(seg.sold(source), cur)} → ${money(seg.contrib(source), cur)}`,
        );
      }
    }
  }
  if (fields.bonus) {
    lines.push('');
    lines.push('Премии:');
    if (!bonuses.length) lines.push('  нет');
    else {
      for (const a of bonuses) {
        lines.push(`  + ${money(a.amountMinor, cur)} — ${a.reason}`);
      }
    }
  }
  if (fields.fine) {
    lines.push('');
    lines.push('Штрафы:');
    if (!fines.length) lines.push('  нет');
    else {
      for (const a of fines) {
        lines.push(`  ${money(a.amountMinor, cur)} — ${a.reason}`);
      }
    }
  }
  if (fields.shifts) {
    const shifts = source.workUnits.filter((u) => u.kind === 'SHIFT');
    lines.push('');
    lines.push('Смены:');
    if (!shifts.length) lines.push('  нет');
    else {
      for (const u of shifts) {
        lines.push(
          `  ${u.occurredAt.slice(0, 10)}  ${u.quantity} ч  ${money(u.priceMinor ?? 0, cur)}`,
        );
      }
    }
  }
  if (fields.totals) {
    lines.push('');
    lines.push('-'.repeat(40));
    lines.push(
      `Корректировки всего: ${money(source.adjustmentsMinor, cur)}`,
    );
    lines.push(`ИТОГО НАЧИСЛЕНО: ${money(source.totalMinor, cur)}`);
    const paid = source.paidPayouts;
    if (paid && (paid.advanceMinor > 0 || paid.totalPaidMinor > 0)) {
      if (paid.advanceMinor > 0) {
        lines.push(
          `Аванс выплачен (факт): ${money(paid.advanceMinor, cur)} (карта ${money(paid.advanceCardMinor, cur)} · касса ${money(paid.advanceCashMinor, cur)})`,
        );
      }
      lines.push(`Выплачено всего (факт): ${money(paid.totalPaidMinor, cur)}`);
      const rest = Math.max(0, source.totalMinor - paid.totalPaidMinor);
      lines.push(`Остаток к выплате: ${money(rest, cur)}`);
    }
  }
  if (ids.size > 1) {
    lines.push('');
    lines.push(`Выбрано сотрудников: ${ids.size}`);
  }
  lines.push('');
  return lines.join('\n');
}
