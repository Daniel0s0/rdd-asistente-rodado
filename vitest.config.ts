import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    // Run all test files in the same process to avoid native module teardown
    // crashes with better-sqlite3 across Vitest worker boundaries.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@config': path.resolve(__dirname, './src/config'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@domain': path.resolve(__dirname, './src/types'),
      '@api': path.resolve(__dirname, './src/api'),
      '@agent': path.resolve(__dirname, './src/agent'),
      '@sheets': path.resolve(__dirname, './src/sheets'),
      '@drive': path.resolve(__dirname, './src/drive'),
      '@database': path.resolve(__dirname, './src/database'),
    },
  },
});
