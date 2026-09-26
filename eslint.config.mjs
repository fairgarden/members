import next from 'eslint-config-next/core-web-vitals'
import prettier from 'eslint-config-prettier/flat'
import monolith from '@fairgarden/monolith/eslint'

/** @type {import('eslint').Linter.Config[]} */
const config = [
  // docs/ is its own workspace package and lints itself
  { ignores: ['node_modules/**', 'dist/**', '.next/**', 'docs/**', 'playwright-report/**', 'test-results/**'] },
  ...next,
  prettier,
  ...monolith.configs.recommended,
]

export default config
