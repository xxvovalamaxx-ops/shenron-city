import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'SourceAssets/**',
      'coverage/**',
      '.playwright-cli/**',
      'Made assets/**',
      'ds/**',
      'check-sketchfab-login.cjs',
      'download-vehicles-robust.cjs',
      'scripts/**/*.cjs',
      'scripts/sketchfab-download.cjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['scripts/**/*.{mjs,cjs}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Puppeteer runners touch the page through evaluate() callbacks.
    files: ['scripts/smoke-manhattan.mjs', 'scripts/probe-game.mjs', 'scripts/probe-game2.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
)
