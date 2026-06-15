'use client';

import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

interface BarcodeCardProps {
  barcode: string;
  barcodeFormat?: 'CODE128' | 'PDF417' | 'QR';
  clientName: string;
  clubName: string;
  membership?: import('@fitgo/shared-types').Membership;
  fullscreen?: boolean;
}

function QrCode({ value, size }: { value: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    import('qrcode').then((QRCode) => {
      QRCode.toCanvas(canvasRef.current!, value, {
        width: size,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
    });
  }, [value, size]);

  return <canvas ref={canvasRef} className="rounded-lg" />;
}

export function BarcodeCard({
  barcode,
  barcodeFormat = 'CODE128',
  clientName,
  clubName,
  membership,
  fullscreen = false,
}: BarcodeCardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const showLinearBarcode = barcodeFormat !== 'PDF417';

  useEffect(() => {
    if (showLinearBarcode && svgRef.current) {
      JsBarcode(svgRef.current, barcode, {
        format: barcodeFormat === 'QR' ? 'CODE128' : barcodeFormat,
        width: fullscreen ? 3 : 2,
        height: fullscreen ? 120 : 80,
        displayValue: true,
        fontSize: fullscreen ? 20 : 14,
        margin: 16,
        background: '#ffffff',
        lineColor: '#0f172a',
      });
    }

    if ('serviceWorker' in navigator && 'caches' in window) {
      caches.open('fitgo-offline').then((cache) => {
        cache.put(
          'access-card',
          new Response(
            JSON.stringify({ barcode, barcodeFormat, clientName, clubName, membership }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });
    }
  }, [barcode, barcodeFormat, fullscreen, clientName, clubName, membership, showLinearBarcode]);

  return (
    <div
      className={
        fullscreen
          ? 'flex min-h-[70vh] flex-col items-center justify-center rounded-3xl bg-white p-8 text-slate-900'
          : 'card flex flex-col items-center bg-white p-6 text-slate-900'
      }
    >
      <p className="mb-1 text-sm font-medium text-slate-500">{clubName}</p>
      <p className="mb-6 text-lg font-semibold">{clientName}</p>
      <div className="mb-4">
        <QrCode value={barcode} size={fullscreen ? 200 : 140} />
      </div>
      {showLinearBarcode ? (
        <svg ref={svgRef} className="max-w-full" />
      ) : (
        <p className="font-mono text-lg tracking-wider text-slate-800">{barcode}</p>
      )}
      <p className="mt-4 text-center text-sm text-slate-500">
        Покажите QR-код или штрих-код на входе в клуб
      </p>
    </div>
  );
}
