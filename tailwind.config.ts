import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0A0F1E', navy: '#0D1B3E', navy2: '#112244', dim: '#1E3A5F',
        teal: '#00C9A7', tealdim: '#009E83', danger: '#EF4444', amber: '#F59E0B',
        muted: '#94A3B8', offwhite: '#E2E8F0',
      },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config;
