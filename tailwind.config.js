/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#116dff',
        'primary-dark': '#0d55cc',
        'primary-light': '#e8f0ff',
        surface: '#ffffff',
        background: '#f4f6fb',
        border: '#e5e9f2',
        'text-primary': '#111827',
        'text-secondary': '#6b7280',
        'text-muted': '#9ca3af',
        badge: {
          lobby: '#e67e22',
          perimeter: '#27ae60',
          driver: '#8e44ad',
          break: '#7f8c8d',
          routine: '#f39c12',
          relief: '#0f766e',
          close: '#0891b2',
          exterior: '#b45309',
          management: '#116dff',
        },
        shift: {
          morning: '#f59e0b',
          afternoon: '#3b82f6',
          night: '#6366f1',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        card: '16px',
        badge: '8px',
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,0.08)',
        'card-md': '0 4px 16px rgba(0,0,0,0.10)',
        'card-lg': '0 8px 32px rgba(0,0,0,0.12)',
      },
      maxWidth: {
        mobile: '430px',
      },
    },
  },
  plugins: [],
};
