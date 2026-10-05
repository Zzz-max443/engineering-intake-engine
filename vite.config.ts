import { defineConfig } from 'vitest/config';

// Vite serves the app (npm run dev); Vitest reads the `test` block (npm test).
export default defineConfig({
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
