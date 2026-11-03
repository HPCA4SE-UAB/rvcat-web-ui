import { fileURLToPath, URL } from 'node:url'
import { defineConfig }       from 'vite'
import vue                    from '@vitejs/plugin-vue'
import vueDevTools            from 'vite-plugin-vue-devtools'

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  // Build: relative base, so the same build works on any GitHub Pages site
  // (HPCA4SE-UAB for students, JCMoure for testing).
  // Dev server: same path as GitHub Pages -> http://localhost:5173/rvcat-web-ui/
  base: command === 'build' ? './' : '/rvcat-web-ui/'
}))
