import { fileURLToPath, URL } from 'node:url'
import { defineConfig }       from 'vite'
import vue                    from '@vitejs/plugin-vue'
import vueDevTools            from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  // Relative base: the same build works on any GitHub Pages site
  // (HPCA4SE-UAB for students, JCMoure for testing) and locally.
  base: './'
})
