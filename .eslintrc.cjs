// ESLint config for TIMES_POS.
//
// Goals:
//   - Catch common React + hooks bugs (exhaustive-deps, key warnings).
//   - Stay practical: this is an existing 7k-line codebase, so we set most
//     stylistic rules to "warn" rather than "error" to avoid blocking work.
//   - Defer formatting to Prettier (`eslint-config-prettier` disables
//     stylistic rules that would conflict with prettier output).
//
// Run:
//   npm run lint        # report
//   npm run lint:fix    # auto-fix what it can
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: '18.3' } },
  plugins: ['react-refresh'],
  ignorePatterns: [
    'dist',
    'node_modules',
    'legacy-index.html',
    'graphify-out',
    '*.config.js',
    '*.config.cjs',
    'public',
  ],
  rules: {
    // React-specific
    'react/prop-types': 'off',          // we don't use PropTypes (would migrate to TS later)
    'react/no-unescaped-entities': 'off',
    'react/display-name': 'off',
    // Disabled until Phase 3 file-split — main.jsx has 30+ components in one file.
    'react-refresh/only-export-components': 'off',
    'no-constant-condition': ['error', { checkLoops: false }], // allow `while(true)` for pagination loops

    // Hooks — these catch real bugs, keep as warnings (codebase has many violations)
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // Quality
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_',
    }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-binary-expression': 'warn',
    'no-prototype-builtins': 'off',
  },
  overrides: [
    {
      files: ['tests/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
      env: { node: true },
      globals: { describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', vi: 'readonly' },
      rules: { 'no-console': 'off' },
    },
    {
      files: ['src/sw.js', 'src/lib/offline-queue.js'],
      env: { serviceworker: true, browser: true },
      globals: { self: 'readonly', clients: 'readonly', importScripts: 'readonly' },
    },
  ],
};
