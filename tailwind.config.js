/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        accent: { DEFAULT: '#10B981', hover: '#059669', light: '#D1FAE5', dark: '#065F46' },
        positive: { DEFAULT: '#059669', light: '#D1FAE5', text: '#065F46' },
        negative: { DEFAULT: '#E11D48', light: '#FFE4E6', text: '#9F1239' },
        warning: { DEFAULT: '#D97706', light: '#FEF3C7', text: '#92400E' },
        neutral: { DEFAULT: '#64748B', light: '#F1F5F9', text: '#334155' },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glass: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
        'glass-lg': '0 8px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        'glass-sm': '0 2px 12px rgba(0,0,0,0.05)',
        'accent-glow': '0 4px 20px rgba(16,185,129,0.25)',
      },
    },
  },
  plugins: [],
}
