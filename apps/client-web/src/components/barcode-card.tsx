'use client';

import type { Membership } from '@fitgo/shared-types';
import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';
import { writeAccessCardCache } from '@/lib/access-card-cache';

interface BarcodeCardProps {
  barcode: string;
  barcodeFormat?: 'CODE128' | 'PDF417' | 'QR';
  clientName: string;
  clubName: string;
  membership?: Membership;
  /** Immersive door-scan plate vs compact embed. */
  mode?: 'scan' | 'compact';
  /** @deprecated use mode="scan" */
  fullscreen?: boolean;
}

function formatShort(date?: string) {
  if (!date) return null;
  try {
    return new Date(date).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function QrCode({ value, size }: { value: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    import('qrcode').then((QRCode) => {
      QRCode.toCanvas(canvasRef.current!, value, {
        width: size,
        margin: 3,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    });
  }, [value, size]);

  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Wallet-style club pass: club header + membership summary + a crisp,
 * unobstructed barcode at the bottom. The code itself is pure #000/#fff
 * with quiet zones so any turnstile scanner reads it instantly.
 */
export function BarcodeCard({
  barcode,
  barcodeFormat = 'CODE128',
  clientName,
  clubName,
  membership,
}: BarcodeCardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isQr = barcodeFormat === 'QR';
  const isPdf417 = barcodeFormat === 'PDF417';
  const showLinear = !isQr && !isPdf417;
  const validUntil = formatShort(membership?.validUntil);

  useEffect(() => {
    if (showLinear && svgRef.current) {
      JsBarcode(svgRef.current, barcode, {
        format: 'CODE128',
        width: 2.4,
        height: 96,
        displayValue: true,
        fontSize: 17,
        font: 'monospace',
        textMargin: 4,
        margin: 12,
        background: '#ffffff',
        lineColor: '#000000',
      });
    }

    writeAccessCardCache({ barcode, barcodeFormat, clientName, clubName });
  }, [barcode, barcodeFormat, clientName, clubName, showLinear]);

  return (
    <div className="overflow-hidden rounded-3xl bg-white text-slate-900 shadow-xl ring-1 ring-black/5">
      {/* Header — original brand logo + status */}
      <div className="flex items-center justify-between gap-3 px-5 pt-3.5 pb-2">
        <img
          src="/clubs/forma-logo-hq.png"
          alt={clubName}
          width={200}
          height={28}
          className="h-7 w-auto max-w-[62%] object-contain object-left"
          decoding="async"
        />
        {validUntil && (
          <span className="shrink-0 text-xs font-medium text-slate-500">
            Активен до {validUntil}
          </span>
        )}
      </div>

      {/* Membership summary */}
      {membership && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Абонемент
            </p>
            <p className="truncate text-base font-semibold text-slate-900">
              {membership.name}
            </p>
          </div>
          {membership.visitsRemaining !== undefined && (
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Визиты
              </p>
              <p className="text-base font-semibold text-slate-900">
                {membership.visitsRemaining}
                {membership.visitsTotal ? `/${membership.visitsTotal}` : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Scan zone */}
      <div className="flex flex-col items-center px-4 py-6">
        {showLinear ? (
          <svg ref={svgRef} className="max-w-full" />
        ) : isQr ? (
          <QrCode value={barcode} size={220} />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <QrCode value={barcode} size={200} />
            <p className="font-mono text-lg tracking-wider text-black">{barcode}</p>
          </div>
        )}
        <p className="mt-3 text-center text-xs text-slate-400">
          Поднесите код к сканеру на входе
        </p>
      </div>
    </div>
  );
}
