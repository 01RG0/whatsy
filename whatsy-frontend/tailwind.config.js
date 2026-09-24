/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        wa: {
          green: '#25D366',
          'green-dark': '#128C7E',
          'green-darker': '#075E54',
          teal: '#00BFA5',
          bg: '#111b21',
          'panel-bg': '#202c33',
          'hover-bg': '#2a3942',
          'input-bg': '#2a3942',
          'bubble-out': '#005c4b',
          'bubble-in': '#202c33',
          text: '#e9edef',
          'text-secondary': '#8696a0',
          border: '#313d45',
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
