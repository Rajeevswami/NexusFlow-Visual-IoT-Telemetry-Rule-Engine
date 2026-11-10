/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Manrope Variable', 'sans-serif'], mono: ['DM Mono', 'monospace'] },
      colors: { ink: '#203640', teal: '#187d7a' },
    },
  },
  plugins: [],
};
