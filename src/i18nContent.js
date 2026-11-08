// Contents in several languages (tutorials, lessons): a text can be a string or { en, es, ca }.
// The tutorial editor edits the text of one language: flattenTexts() replaces the multilingual
// texts by the text of that language and keeps the originals; restoreTexts() puts the edited
// texts back into their language, keeping the other languages.

import { locale } from '@/i18n'

const isMulti = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

// Paths of the texts of a tutorial card
const TEXT_PATHS = (step) => [
  'title', 'description', 'questionText', 'numericCorrect', 'numericWrong', 'numericUnit', 'validation.message',
  ...(step.answers ?? []).flatMap((_, k) => [`answers.${k}.text`, `answers.${k}.explanation`]),
  ...(step.nextLabels ?? []).map((_, k) => `nextLabels.${k}`),
]

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
function set(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const holder = keys.reduce((o, k) => (o == null ? undefined : o[k]), obj)
  if (holder != null) holder[last] = value
}

const textIn = (value, lang) => value[lang] ?? value.en ?? Object.values(value)[0] ?? ''

// { flat: copy with strings, i18n: { path: original }, lang }
export function flattenTexts(obj, paths, lang = locale.value) {
  const flat = JSON.parse(JSON.stringify(obj ?? {}))
  const i18n = {}
  for (const path of paths) {
    const v = get(flat, path)
    if (isMulti(v)) { i18n[path] = v; set(flat, path, textIn(v, lang)) }
  }
  return { flat, i18n, lang }
}
export const flattenStep = (step, lang) => flattenTexts(step, TEXT_PATHS(step ?? {}), lang)

// The edited texts of out (strings) go back into the multilingual originals
export function restoreTexts(out, i18n, lang) {
  for (const [path, original] of Object.entries(i18n ?? {})) {
    const edited = get(out, path)
    if (typeof edited === 'string') set(out, path, { ...original, [lang ?? locale.value]: edited })
  }
  return out
}
