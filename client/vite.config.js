import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately; point the proxy elsewhere with API_URL if needed.
const api = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  // Live pages (/f/...) render in the browser during dev; server rendering applies to production builds.
  server: { port: Number(process.env.WEB_PORT) || 5173, proxy: { '/api': api, '/uploads': api } },
  ssr: { noExternal: true },
});
