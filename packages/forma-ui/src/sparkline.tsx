'use client';

import { cn } from './cn';

export function Sparkline({
  values,
  className,
  stroke = 'currentColor',
  fill,
  height = 32,
  width = 120,
}: {
  values: number[];
  className?: string;
  stroke?: string;
  fill?: string;
  height?: number;
  width?: number;
}) {
  if (values.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className={cn('text-forma-400', className)}
        aria-hidden
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke}
          strokeWidth={1.5}
          opacity={0.35}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const line = pts.join(' ');
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('text-forma-400', className)}
      aria-hidden
    >
      {fill ? (
        <polygon points={area} fill={fill} opacity={0.25} />
      ) : null}
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
