import { defineConfig } from 'vite';

// In local dev the moderation API (Vercel functions in /api) is served by
// `vercel dev`; proxy those calls so `npm run dev` keeps working. Production
// serves both from the same origin.
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
