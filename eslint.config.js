import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,jsx,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**'],
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],

  {
    name: 'app/browser-globals',
    languageOptions: {
      globals: {
        Viz: 'readonly',   // viz.js, loaded from index.html
      },
    },
    rules: {
      // Existing single-word component names (processor, program)
      'vue/multi-word-component-names': 'off',
    },
  },

  {
    name: 'app/web-worker',
    files: ['public/worker.js'],
    languageOptions: {
      globals: {
        self:          'readonly',
        importScripts: 'readonly',
        loadPyodide:   'readonly',
      },
    },
  },

  {
    name: 'app/node-scripts',
    files: ['scripts/**/*.{js,mjs}', '*.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/*.test.js'],
  },
]
