/** Config para precompilar el CSS premium (sin CDN en producción). */
module.exports = {
  darkMode: 'class',
  content: ['./premium.html', './src/app/premium.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        income:  { DEFAULT: '#10b981', soft: '#34d399', bg: 'rgba(16,185,129,.10)' },
        expense: { DEFAULT: '#fb7185', soft: '#f97362', bg: 'rgba(251,113,133,.10)' },
        invest:  { DEFAULT: '#8b5cf6', soft: '#a78bfa', bg: 'rgba(139,92,246,.10)' },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,.04), 0 12px 32px -12px rgba(15,23,42,.10)',
        lift: '0 2px 4px rgba(15,23,42,.05), 0 24px 48px -16px rgba(15,23,42,.18)',
      },
      borderRadius: { '2xl': '1.25rem', '3xl': '1.75rem' },
    },
  },
};
