import type { Config } from 'tailwindcss';

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
  plugins: [],
};

export default config;
