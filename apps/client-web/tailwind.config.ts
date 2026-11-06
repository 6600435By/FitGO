import type { Config } from 'tailwindcss';
import formaPreset from '@fitgo/forma-ui/preset';

const config: Config = {
  presets: [formaPreset],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/forma-ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Keep fitgo aliases → Forma yellow so legacy classNames still work
      colors: {
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
        // Override font CSS vars fallback for Google Fonts link (no next/font here)
        // preset already sets display/sans with Unbounded/Manrope fallbacks
      },
      fontFamily: {
        display: ['Unbounded', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
};

export default config;
