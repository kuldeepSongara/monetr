/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        good: 'rgb(var(--good) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl2: '1.25rem', '3xl': '1.75rem' },
      opacity: {
        12: '0.12',
        15: '0.15',
        85: '0.85',
      },
      boxShadow: {
        card: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 10px 30px -18px rgb(0 0 0 / 0.6)',
        pop: '0 24px 64px -24px rgb(0 0 0 / 0.45), 0 2px 6px -2px rgb(0 0 0 / 0.08)',
      },
      keyframes: {
        'slide-up': { from: { transform: 'translateY(16px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { transform: 'scale(.96)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        'sheet-up': { from: { transform: 'translateY(24px)', opacity: '0.6' }, to: { transform: 'translateY(0)', opacity: '1' } },
        tick: { from: { transform: 'scaleY(0.2)', opacity: '0' }, to: { transform: 'scaleY(1)', opacity: '1' } },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
        'fade-in': 'fade-in .18s ease-out',
        'pop-in': 'pop-in .16s cubic-bezier(.2,.8,.2,1)',
        'sheet-up': 'sheet-up .24s cubic-bezier(.2,.8,.2,1)',
        tick: 'tick .5s cubic-bezier(.2,.8,.2,1) both',
        shake: 'shake .4s ease',
      },
    },
  },
  plugins: [],
}
