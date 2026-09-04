/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      colors: {
        ink: '#0b0d14',
        panel: '#11141f',
        vio: '#8b5cf6',
        cy: '#22d3ee',
        hot: '#f43f5e',
        warm: '#f59e0b',
        cool: '#38bdf8',
        ok: '#34d399'
      },
      boxShadow: {
        glow: '0 0 40px -12px rgba(139,92,246,.55)'
      },
      animation: {
        fadeUp: 'fadeUp .45s ease both',
        pulseHot: 'pulseHot 1.6s ease-in-out infinite'
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' }
        },
        pulseHot: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '.55' }
        }
      }
    }
  },
  plugins: []
}
