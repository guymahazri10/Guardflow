/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Security-blue brand system (see design.md)
        primary: '#1362FF',
        'primary-600': '#0F4FD1',
        'primary-dark': '#0B3EA8',
        'primary-light': '#E8EFFF',
        'primary-200': '#C9DAFF',
        gold: '#D4A24A',
        'gold-soft': '#FFF1D8',
        surface: '#ffffff',
        background: '#F4F6FF',
        'background-2': '#EAEFFC',
        border: '#DDE3F3',
        'border-strong': '#C9D2EA',
        'text-primary': '#0C084A',
        'text-secondary': '#5A6072',
        'text-muted': '#8A90A3',
        // Small label text that carries information (role label, "לא הוגדר").
        // 7.7:1 on white; text-muted is for decoration/placeholder only.
        'text-label': '#4B5163',
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
        sans: ['Assistant', 'sans-serif'],
      },
      borderRadius: {
        card: '20px',
        badge: '999px',
      },
      boxShadow: {
        card: '0 6px 20px rgba(19,98,255,0.08)',
        'card-md': '0 10px 28px rgba(19,98,255,0.12)',
        'card-lg': '0 16px 40px rgba(19,98,255,0.14)',
      },
      maxWidth: {
        mobile: '430px',
      },
    },
  },
  plugins: [],
};
