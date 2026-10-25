import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        fitgo: {
          50: '#f0fdf8',
          100: '#ccfbeb',
          200: '#99f6d7',
          300: '#5fe9bf',
          400: '#2dd4a5',
          500: '#14b88a',
          600: '#0d9470',
          700: '#0f765c',
          800: '#115e4b',
          900: '#134e3f',
        },
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      // Phone landscape is often ≥768px wide, so Tailwind `md:` treats it as
      // desktop. Keep mobile chrome (bottom nav, phone-width rules) instead.
      addVariant(
        'phone-land',
        '@media (orientation: landscape) and (max-height: 500px)',
      );
    }),
  ],
};

export default config;
