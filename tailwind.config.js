/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Security-blue brand system (see design.md)
        primary: '#1B56A5',
        'primary-600': '#123F7A',
        'primary-dark': '#0B2D59',
        'primary-light': '#E8EFF8',
        'primary-200': '#C9D8EC',
        gold: '#D4A24A',
        'gold-soft': '#FFF1D8',
        surface: '#ffffff',
        background: '#F7F8FA',
        'background-2': '#F1F3F5',
        border: '#D9DEE5',
        'border-strong': '#C8D0D9',
        'text-primary': '#15171A',
        'text-secondary': '#6F7782',
        'text-muted': '#98A1AB',
        good: '#2F7D4A',
        'good-light': '#E5F2E9',
        warning: '#A66B13',
        'warning-light': '#F8EDD8',
        danger: '#B63A32',
        'danger-light': '#FBE8E6',
        info: '#17627A',
        'info-light': '#DDF3F7',
        position: {
          lobby: '#D2A85C',
          perimeter: '#5f9e72',
          standby: '#9868b8',
          break: '#7C838C',
          routine: '#d6823f',
          relief: '#3f9aa8',
          close: '#4f7fc4',
          exterior: '#c1613f',
          management: '#1B56A5',
        },
      },
      fontFamily: {
        sans: ['Heebo', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        badge: '999px',
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
