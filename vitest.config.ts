import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // Tests run offline; without this, @copilotkit/runtime's telemetry ping
    // at module load hangs on an outbound fetch with no network egress until
    // the test's own timeout fires.
    env: { COPILOTKIT_TELEMETRY_DISABLED: 'true' },
    setupFiles: ['./tests/unit/setup-dom.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'components/**/*.tsx'],
      exclude: ['lib/db/**', 'lib/email/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
