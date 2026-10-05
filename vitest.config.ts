import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    // magnet links are resolved before rqbit responds, slower with a fresh dht
    testTimeout: 60_000,
  },
});
