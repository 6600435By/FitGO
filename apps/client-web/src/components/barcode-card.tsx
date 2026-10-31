'use client';

import type { Membership } from '@fitgo/shared-types';
import JsBarcode from 'jsbarcode';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { writeAccessCardCache } from '@/lib/access-card-cache';
import { FormaWordmark } from '@/components/forma/wordmark';
import { cn } from '@/lib/utils';

interface BarcodeCardProps {
  barcode: string;
  barcodeFormat?: 'CODE128' | 'PDF417' | 'QR';
  clientName: string;
  clubName: string;
  membership?: Membership;
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

export function BarcodeCard({
  barcode,
  barcodeFormat = 'CODE128',
  clientName,
  clubName,
  membership,
}: BarcodeCardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [flipped, setFlipped] = useState(false);
  const isQr = barcodeFormat === 'QR';
  const isPdf417 = barcodeFormat === 'PDF417';
  const showLinear = !isQr && !isPdf417;
  const validUntil = formatShort(membership?.validUntil);

  useEffect(() => {
    if (showLinear && flipped && svgRef.current) {
      JsBarcode(svgRef.current, barcode, {
        format: 'CODE128',
        width: 2.4,
        height: 100,
        displayValue: true,
        fontSize: 16,
        font: 'monospace',
        textMargin: 4,
        margin: 14,
        background: '#ffffff',
        lineColor: '#000000',
      });
    }

    writeAccessCardCache({ barcode, barcodeFormat, clientName, clubName });
  }, [barcode, barcodeFormat, clientName, clubName, showLinear, flipped]);

  return (
    <div className="perspective-[1200px]">
      <motion.div
        className="relative min-h-[28rem] w-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
      >
        {/* Front — brand pass */}
        <button
          type="button"
          onClick={() => setFlipped(true)}
          className={cn(
            'absolute inset-0 flex flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-ink-elevated via-ink to-black p-5 text-left shadow-forma-card touch-manipulation',
            'backface-hidden',
          )}
          style={{ backfaceVisibility: 'hidden' }}
          aria-label="Показать штрихкод"
        >
          <div className="flex items-start justify-between gap-3">
            <FormaWordmark size="sm" />
            {validUntil ? (
              <span className="rounded-full bg-forma-500/15 px-2.5 py-1 text-[11px] font-semibold text-forma-400">
                до {validUntil}
              </span>
            ) : null}
          </div>

          <div className="mt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Пропуск
            </p>
            <p className="mt-1 font-display text-3xl font-bold tracking-tight text-white">
              {clientName}
            </p>
            <p className="mt-1 text-sm text-zinc-400">{clubName || 'Forma'}</p>
          </div>

          {membership ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Абонемент
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-white">
                {membership.name}
              </p>
              {membership.visitsRemaining !== undefined ? (
                <p className="mt-1 text-sm text-zinc-400">
                  Осталось визитов: {membership.visitsRemaining}
                  {membership.visitsTotal ? ` / ${membership.visitsTotal}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-auto flex items-end justify-between pt-8">
            <div>
              <p className="text-xs text-zinc-500">Нажмите, чтобы открыть код</p>
              <p className="mt-1 font-display text-sm font-semibold text-forma-400">
                Показать штрихкод →
              </p>
            </div>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-forma-500 font-display text-lg font-extrabold text-ink shadow-forma-glow">
              Ф
            </span>
          </div>
        </button>

        {/* Back — scanner plate */}
        <button
          type="button"
          onClick={() => setFlipped(false)}
          className={cn(
            'absolute inset-0 flex flex-col overflow-hidden rounded-[1.75rem] bg-white text-slate-900 shadow-xl touch-manipulation',
            'backface-hidden',
          )}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
          aria-label="Вернуться к карте"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <p className="font-display text-sm font-bold uppercase tracking-wider text-slate-900">
              Forma
            </p>
            <span className="text-xs font-medium text-slate-500">
              Нажмите, чтобы закрыть
            </span>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center px-4 py-6">
            {showLinear ? (
              <svg ref={svgRef} className="max-w-full" />
            ) : isQr ? (
              <QrCode value={barcode} size={220} />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <QrCode value={barcode} size={200} />
                <p className="font-mono text-lg tracking-wider text-black">
                  {barcode}
                </p>
              </div>
            )}
            <p className="mt-4 text-center text-xs text-slate-500">
              Поднесите код к сканеру · яркость на максимум
            </p>
            <p className="mt-2 text-center text-sm font-medium text-slate-800">
              {clientName}
            </p>
          </div>
        </button>
      </motion.div>
    </div>
  );
}
