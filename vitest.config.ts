import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (whose root is src/web) so tests resolve from repo root.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
