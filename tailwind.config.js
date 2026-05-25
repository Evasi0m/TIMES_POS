// Tailwind config — every colour is a CSS variable so a single
// `data-theme="dark"` attribute on <html> can flip the entire theme.
// Token values themselves live in `src/styles.legacy.css` under
// `:root` (light) and `:root[data-theme="dark"]` (dark = warm
// charcoal). The `<alpha-value>` placeholder is filled in by Tailwind
// at build time so things like `bg-canvas/80` still work.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  // Bind Tailwind's `dark:` variant to our `data-theme="dark"` attribute
  // (set by the index.html boot script + applyTheme in main.jsx). This
  // lets us patch the few spots where Tailwind default palette colours
  // (text-emerald-700, bg-amber-50, ...) need a brighter dark variant
  // without rebuilding the whole component.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary:                'rgb(var(--c-primary) / <alpha-value>)',
        'primary-active':       'rgb(var(--c-primary-active) / <alpha-value>)',
        'primary-disabled':     'rgb(var(--c-primary-disabled) / <alpha-value>)',
        ink:                    'rgb(var(--c-ink) / <alpha-value>)',
        body:                   'rgb(var(--c-body) / <alpha-value>)',
        'body-strong':          'rgb(var(--c-body-strong) / <alpha-value>)',
        muted:                  'rgb(var(--c-muted) / <alpha-value>)',
        'muted-soft':           'rgb(var(--c-muted-soft) / <alpha-value>)',
        hairline:               'rgb(var(--c-hairline) / <alpha-value>)',
        'hairline-soft':        'rgb(var(--c-hairline-soft) / <alpha-value>)',
        canvas:                 'rgb(var(--c-canvas) / <alpha-value>)',
        'surface-soft':         'rgb(var(--c-surface-soft) / <alpha-value>)',
        'surface-card':         'rgb(var(--c-surface-card) / <alpha-value>)',
        'surface-cream-strong': 'rgb(var(--c-surface-cream-strong) / <alpha-value>)',
        'surface-strong':       'rgb(var(--c-surface-strong) / <alpha-value>)',
        'surface-dark':         'rgb(var(--c-surface-dark) / <alpha-value>)',
        'surface-dark-elevated':'rgb(var(--c-surface-dark-elevated) / <alpha-value>)',
        'surface-dark-soft':    'rgb(var(--c-surface-dark-soft) / <alpha-value>)',
        // `nightshade` = literal dark slate that NEVER flips with the
        // theme. Use for chips that must read "dark surface" even on a
        // dark canvas (toasts, certain segment-active pills).
        nightshade:             'rgb(var(--c-nightshade) / <alpha-value>)',
        'on-primary':           'rgb(var(--c-on-primary) / <alpha-value>)',
        'on-dark':              'rgb(var(--c-on-dark) / <alpha-value>)',
        'on-dark-soft':         'rgb(var(--c-on-dark-soft) / <alpha-value>)',
        'accent-teal':          'rgb(var(--c-accent-teal) / <alpha-value>)',
        'accent-amber':         'rgb(var(--c-accent-amber) / <alpha-value>)',
        success:                'rgb(var(--c-success) / <alpha-value>)',
        warning:                'rgb(var(--c-warning) / <alpha-value>)',
        error:                  'rgb(var(--c-error) / <alpha-value>)',
      },
      fontFamily: {
        serif: ['Taviraj', 'Cormorant Garamond', 'Garamond', 'serif'],
        sans:  ['Taviraj', 'Cormorant Garamond', 'serif'],
        mono:  ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px', pill: '9999px',
      },
    },
  },
};
