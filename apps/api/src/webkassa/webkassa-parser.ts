import * as ExcelJS from 'exceljs';

export type ParsedWebkassaReceipt = {
  receiptId: string;
  occurredAt: Date;
  shiftNumber: string | null;
  kedNumber: string | null;
  amount: number;
  cash: number;
  cashless: number;
  receiptType: string;
  tradeObject: string | null;
  cashier: string | null;
  status: string | null;
  uid: string | null;
};

const HEADER_ALIASES: Record<string, keyof ParsedWebkassaReceipt | 'skip'> = {
  'дата документа': 'occurredAt',
  'id чека': 'receiptId',
  '№ смены': 'shiftNumber',
  '№ кэд': 'kedNumber',
  '№ кэд ': 'kedNumber',
  'сумма кэд': 'amount',
  'тип кэд': 'receiptType',
  'торговый объект': 'tradeObject',
  кассир: 'cashier',
  'статус кэд': 'status',
  наличные: 'cash',
  безналичные: 'cashless',
  uid: 'uid',
};

function normHeader(h: string) {
  return h
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function parseMinskDate(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(raw));
    const frac = raw - Math.floor(raw);
    epoch.setUTCMilliseconds(Math.round(frac * 86400000));
    // Treat as Minsk wall clock → UTC
    return new Date(epoch.getTime() - 3 * 3600000);
  }
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // dd.MM.yyyy HH:mm:ss
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    s,
  );
  if (m) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    // Europe/Minsk = UTC+3 (no DST)
    return new Date(
      Date.UTC(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh) - 3,
        Number(mi),
        Number(ss),
      ),
    );
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw ?? '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export async function parseWebkassaXlsx(
  buffer: Buffer,
): Promise<ParsedWebkassaReceipt[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs accepts Buffer / ArrayBuffer
  await wb.xlsx.load(buffer as never);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const colMap = new Map<number, keyof ParsedWebkassaReceipt>();
  headerRow.eachCell((cell, col) => {
    const key = HEADER_ALIASES[normHeader(String(cell.value ?? ''))];
    if (key && key !== 'skip') colMap.set(col, key);
  });

  if (![...colMap.values()].includes('receiptId')) {
    throw new Error(
      'Не найден столбец «ID Чека» — проверьте файл отчёта Webkassa',
    );
  }

  const out: ParsedWebkassaReceipt[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const draft: Partial<ParsedWebkassaReceipt> = {};
    for (const [col, field] of colMap) {
      const val = row.getCell(col).value;
      if (field === 'occurredAt') {
        draft.occurredAt = parseMinskDate(val) ?? undefined;
      } else if (
        field === 'amount' ||
        field === 'cash' ||
        field === 'cashless'
      ) {
        draft[field] = num(val);
      } else {
        const s = String(val ?? '').trim();
        (draft as Record<string, unknown>)[field] = s || null;
      }
    }
    if (!draft.receiptId || !draft.occurredAt) return;
    out.push({
      receiptId: String(draft.receiptId),
      occurredAt: draft.occurredAt,
      shiftNumber: draft.shiftNumber ?? null,
      kedNumber: draft.kedNumber ?? null,
      amount: draft.amount ?? 0,
      cash: draft.cash ?? 0,
      cashless: draft.cashless ?? 0,
      receiptType: draft.receiptType ?? 'Чек продажи',
      tradeObject: draft.tradeObject ?? null,
      cashier: draft.cashier ?? null,
      status: draft.status ?? null,
      uid: draft.uid ?? null,
    });
  });
  return out;
}
