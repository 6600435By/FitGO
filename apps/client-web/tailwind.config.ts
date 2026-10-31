import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        forma: {
          50: '#fffbeb',
          100: '#fff3c4',
          200: '#ffe685',
          300: '#ffd84a',
          400: '#ffd000',
          500: '#ffd000',
          600: '#e6b800',
          700: '#b38a00',
          800: '#806200',
          900: '#4d3b00',
        },
        // Keep fitgo aliases → Forma yellow so legacy classNames still work
        fitgo: {
          50: '#fffbeb',
          100: '#fff3c4',
          200: '#ffe685',
          300: '#ffd84a',
          400: '#ffd000',
          500: '#ffd000',
          600: '#e6b800',
          700: '#b38a00',
          800: '#806200',
          900: '#4d3b00',
        },
        ink: {
          DEFAULT: '#0B0B0C',
          elevated: '#141416',
          raised: '#1C1C1F',
          line: 'rgba(255,255,255,0.08)',
        },
      },
      fontFamily: {
        display: ['Unbounded', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '3xl': '1.5rem',
        '4xl': '1.75rem',
      },
      boxShadow: {
        'forma-glow': '0 0 40px -8px rgba(255, 208, 0, 0.45)',
        'forma-card':
          '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 40px -16px rgba(0,0,0,0.65)',
        dock: '0 -8px 32px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        'forma-mesh':
          'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255,208,0,0.12), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(255,208,0,0.05), transparent)',
        'forma-noise':
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant(
        'phone-land',
        '@media (orientation: landscape) and (max-height: 500px)',
      );
    }),
  ],
};

export default config;
