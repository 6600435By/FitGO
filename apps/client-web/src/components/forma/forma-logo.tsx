import { cn } from '@/lib/utils';

/**
 * Horizontal Forma lockup: heavy ФОРМА + yellow «ФИТНЕС / СТУДИЯ» block.
 * Redrawn from the club mark (sharp geometry, same proportions).
 * Word color follows currentColor so it stays light on the dark shell.
 */

const WORD_END = 474;
const FULL_WIDTH = 714;

type Glyph = { d: string; w: number; holes?: boolean };

const GLYPH: Record<string, Glyph> = {
  Ф: {
    w: 108,
    holes: true,
    d: 'M16 4H92L104 18V44L92 58H70V100H38V58H16L4 44V18Z M26 20H44V40H26Z M64 20H82V40H64Z',
  },
  О: {
    w: 76,
    holes: true,
    d: 'M14 2H62C72 2 74 12 74 28V72C74 88 72 98 62 98H14C4 98 2 88 2 72V28C2 12 4 2 14 2Z M27 22H49V78H27Z',
  },
  Р: {
    w: 74,
    holes: true,
    d: 'M2 0H52L72 16V38L30 60V100H2Z M28 14H48V36H28Z',
  },
  М: {
    w: 92,
    d: 'M0 0H26L40 44H52L66 0H92V100H68L50 62H42L24 100H0Z',
  },
  А: {
    w: 80,
    holes: true,
    d: 'M22 0H58L80 100H58L50 72H30L22 100H0Z M32 20H48L54 46H26Z',
  },
  И: {
    w: 70,
    d: 'M0 0H22V58L48 0H70V100H48V42L22 100H0Z',
  },
  Т: {
    w: 66,
    d: 'M0 0H66V24H44V100H22V24H0Z',
  },
  Н: {
    w: 70,
    d: 'M0 0H22V38H48V0H70V100H48V62H22V100H0Z',
  },
  Е: {
    w: 62,
    d: 'M0 0H62V20H22V40H52V58H22V80H62V100H0Z',
  },
  С: {
    w: 64,
    d: 'M18 0H64V22H34V78H64V100H18L2 84V16Z',
  },
  У: {
    w: 66,
    d: 'M0 0H22L33 34L44 0H66L46 46V100H22V46Z',
  },
  Д: {
    w: 74,
    d: 'M16 0H58V76H74V100H0V76H16Z',
  },
  Я: {
    w: 74,
    holes: true,
    d: 'M72 0H22L2 16V38L44 60V100H72Z M26 14H46V36H26Z',
  },
};

const WORD = ['Ф', 'О', 'Р', 'М', 'А'] as const;
const LINE_TOP = ['Ф', 'И', 'Т', 'Н', 'Е', 'С'] as const;
const LINE_BOTTOM = ['С', 'Т', 'У', 'Д', 'И', 'Я'] as const;

function GlyphPaths({
  letters,
  gap,
  scale,
  x,
  y,
}: {
  letters: readonly string[];
  gap: number;
  scale: number;
  x: number;
  y: number;
}) {
  let cursor = x;
  return (
    <>
      {letters.map((letter) => {
        const glyph = GLYPH[letter];
        const node = (
          <path
            key={`${letter}-${cursor}`}
            d={glyph.d}
            fillRule={glyph.holes ? 'evenodd' : undefined}
            transform={`translate(${cursor} ${y}) scale(${scale})`}
          />
        );
        cursor += glyph.w * scale + gap;
        return node;
      })}
    </>
  );
}

export function FormaLogo({
  className,
  showBadge = true,
  title = 'Форма — фитнес студия',
}: {
  className?: string;
  showBadge?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${showBadge ? FULL_WIDTH : WORD_END} 100`}
      role="img"
      aria-label={title}
      className={cn('block text-white', className)}
    >
      <title>{title}</title>
      <g fill="currentColor">
        <GlyphPaths letters={WORD} gap={11} scale={1} x={0} y={0} />
      </g>
      {showBadge ? (
        <g>
          <path fill="#FFD000" d="M490 0H714V100H512Z" />
          <g fill="#0B0B0C">
            <GlyphPaths letters={LINE_TOP} gap={5} scale={0.33} x={528} y={8} />
            <GlyphPaths
              letters={LINE_BOTTOM}
              gap={5}
              scale={0.33}
              x={528}
              y={54}
            />
          </g>
        </g>
      ) : null}
    </svg>
  );
}
