// Languages of the interface: English (default), Spanish and Catalan.
//
//   t('Run Simulation')                       the English text is the key of short texts
//   t('Usage of port {p}', { p: 1 })          {name} parameters
//   t('help.processor')                       long texts (help windows) have an identifier
//
// The translations are in src/i18n/messages/*.js: { key: { es, ca } } (and en for identifiers).
// A missing translation shows the English text. Numbers keep the English format in every language.
// Contents (tutorials, lessons) can give a text in several languages: { en, es, ca } (localized()).

import { ref } from 'vue'
import { MESSAGES } from '@/i18n/messages'

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'ca', label: 'CA', name: 'Català' },
]
const STORAGE_KEY = 'language'
const codes = LANGUAGES.map(l => l.code)

function initialLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (codes.includes(saved)) return saved
  } catch { /* default */ }
  return 'en'          // the language of the browser is not considered
}

// Reactive: templates and computed values that call t() are updated when it changes
export const locale = ref(initialLocale())

export function setLocale(code) {
  if (!codes.includes(code)) return
  locale.value = code
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = code
}

const fill = (text, params) => (params
  ? text.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m))
  : text)

export function t(key, params) {
  const lang = locale.value
  const entry = MESSAGES[key]
  const text = (entry && (entry[lang] ?? entry.en)) ?? key
  return fill(text, params)
}

// Text of a content in the current language: a string, or { en, es, ca }
export function localized(value) {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value[locale.value] ?? value.en ?? Object.values(value)[0] ?? ''
  return value
}
