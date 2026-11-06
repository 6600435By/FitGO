import type { Config } from 'tailwindcss';
import { formaThemeExtend, formaTailwindPlugin } from '@fitgo/forma-ui/preset';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/forma-ui/src/**/*.{js,ts,jsx,tsx}',
  ],
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
        // Forma tokens available under .forma-theme (trainer v2)
        forma: formaThemeExtend.colors.forma,
        ink: formaThemeExtend.colors.ink,
      },
      fontFamily: formaThemeExtend.fontFamily,
      borderRadius: formaThemeExtend.borderRadius,
      boxShadow: formaThemeExtend.boxShadow,
      backgroundImage: formaThemeExtend.backgroundImage,
      keyframes: formaThemeExtend.keyframes,
      animation: formaThemeExtend.animation,
      screens: formaThemeExtend.screens,
    },
  },
  plugins: [formaTailwindPlugin()],
};

export default config;
