import { defineConfig } from 'vite';

// In local dev the /api functions are served by `vercel dev`; proxy them so
// `npm run dev` keeps working. Production serves both from one origin.
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
