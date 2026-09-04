/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // ── Design Tokens — SIH26191 Command Center ──────────────────────
      // Dark navy base, semantic risk colors, muted accents.
      // All component styles reference these tokens; no ad-hoc hex values.
      colors: {
        // Background layers
        surface: {
          base:    '#0b0f1a',   // page background
          raised:  '#111827',   // card background
          overlay: '#1a2235',   // drawer / modal background
          border:  '#1e2d45',   // subtle card border
        },
        // Accent
        accent: {
          DEFAULT: '#3b82f6',   // blue-500 — links, active states, data feeds
          dim:     '#1d4ed8',   // blue-700 — hover
          glow:    'rgba(59,130,246,0.15)', // subtle card glow on focus
        },
        // Risk semantic colors (must always be paired with icon/label)
        risk: {
          red:    '#ef4444',    // Immediate  (0.75–1.00)
          orange: '#f97316',    // Short-term (0.55–0.74)
          yellow: '#eab308',    // Medium     (0.35–0.54)
          green:  '#22c55e',    // Stable     (0.00–0.34)
        },
        // Supporting semantics
        capacity: '#22c55e',    // site capacity indicators
        ai:       '#a855f7',    // purple — AI-generated outputs
        infra:    '#3b82f6',    // blue — infrastructure / data feeds
        // Text
        text: {
          primary:   '#f1f5f9', // near-white
          secondary: '#94a3b8', // muted slate
          muted:     '#475569', // very muted
        },
      },
      fontFamily: {
        sans:  ['Outfit', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '0.625rem',   // slightly softer than default
      },
      boxShadow: {
        card:     '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.24)',
        critical: '0 0 12px rgba(239,68,68,0.25)',   // red glow for Immediate
        panel:    '0 8px 32px rgba(0,0,0,0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        // Used for Immediate-risk map markers
        'risk-pulse': {
          '0%, 100%': { opacity: 1, transform: 'scale(1)' },
          '50%':       { opacity: 0.7, transform: 'scale(1.15)' },
        },
      },
    },
  },
  plugins: [],
}
