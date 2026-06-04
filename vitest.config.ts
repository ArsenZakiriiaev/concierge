import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 10_000,
    pool: 'forks',
  },
})
