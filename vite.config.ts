import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { execSync } from 'node:child_process';

// GitHub Pages serves project sites from /<repo>/, so all asset URLs need
// that prefix in production. Local dev still serves from /.
const base = process.env.GITHUB_PAGES === 'true' ? '/OmgevingsGeest/' : '/';

// Bake the git SHA into the bundle so the running page can identify itself.
// On GitHub Actions, GITHUB_SHA is set automatically; locally we fall back to
// `git rev-parse`. Either way, no manual version bumping needed.
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base,
  plugins: [vue()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    port: 5173,
  },
});
