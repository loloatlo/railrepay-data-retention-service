import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.*',
        'src/index.ts', // Main entry point - tested via integration tests
        'src/database/client.ts', // Database client - tested via integration tests
        'migrations/**', // Migrations tested separately
      ],
    },
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
