import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately; point the proxy elsewhere with API_URL if needed.
const api = process.env.API_URL || 'http://localhost:4000';

// React + the router change rarely: their own long-cached file, shared by funnel pages and the dashboard
const vendor = (id) => (/[\/]node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\/]router)[\/]/.test(id) ? 'vendor' : undefined);

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  // Live pages (/f/...) render in the browser during dev; server rendering applies to production builds.
  server: { port: Number(process.env.WEB_PORT) || 5173, proxy: { '/api': api, '/uploads': api } },
  ssr: { noExternal: true },
  // the server bundle (dist-ssr/entry-server.js) stays one file
  build: isSsrBuild ? {} : { rollupOptions: { output: { manualChunks: vendor } } },
}));
