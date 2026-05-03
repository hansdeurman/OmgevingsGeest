import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages serves project sites from /<repo>/, so all asset URLs need
// that prefix in production. Local dev still serves from /.
const base = process.env.GITHUB_PAGES === 'true' ? '/OmgevingsGeest/' : '/';

export default defineConfig({
  base,
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
  },
});
