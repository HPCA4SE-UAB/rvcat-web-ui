import { describe, it, expect, afterEach } from 'vitest'
import { t, setLocale, localized, locale } from './i18n'
import { flattenStep, restoreTexts, flattenTexts } from './i18nContent'
import { MESSAGES } from './i18n/messages'

afterEach(() => setLocale('en'))

describe('translations', () => {
  it('give the English text by default, with parameters', () => {
    expect(locale.value).toBe('en')
    expect(t('Usage of port {p}', { p: 3 })).toBe('Usage of port 3')
    expect(t('a text without translation')).toBe('a text without translation')
  })
  it('use the selected language, and English when a translation is missing', () => {
    setLocale('es')
    expect(t('Processor')).toBe(MESSAGES.Processor.es)
    expect(t('a text without translation')).toBe('a text without translation')
    setLocale('xx')                     // unknown languages are ignored
    expect(locale.value).toBe('es')
  })
  it('have Spanish and Catalan for every key, with the same parameters', () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      if (key.startsWith('help.') && !entry.es && !entry.ca) continue   // pending (todo below): shown in English
      const en = entry.en ?? key
      const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
      for (const lang of ['es', 'ca']) {
        expect({ key, lang, has: typeof entry[lang] === 'string' && entry[lang].length > 0 }).toEqual({ key, lang, has: true })
        if (!key.startsWith('help.') && !key.startsWith('about.'))
          expect({ key, lang, params: params(entry[lang]) }).toEqual({ key, lang, params: params(en) })
      }
    }
  })
  it.todo('Spanish and Catalan texts of the help windows (help.*): shown in English meanwhile')
})

describe('multilingual contents', () => {
  it('show the text of the current language', () => {
    expect(localized({ en: 'Hello', es: 'Hola' })).toBe('Hello')
    setLocale('es')
    expect(localized({ en: 'Hello', es: 'Hola' })).toBe('Hola')
    setLocale('ca')
    expect(localized({ en: 'Hello', es: 'Hola' })).toBe('Hello')    // missing: English
    expect(localized('plain')).toBe('plain')
  })
  it('are edited in one language and keep the others', () => {
    const step = { id: 'a', title: { en: 'Title', es: 'Título' }, description: 'plain',
                   answers: [{ text: { en: 'Yes', ca: 'Sí' }, explanation: 'x' }], nextLabels: [{ en: 'Next', es: 'Siguiente' }] }
    const { flat, i18n, lang } = flattenStep(step, 'es')
    expect(flat).toMatchObject({ title: 'Título', description: 'plain', answers: [{ text: 'Yes' }], nextLabels: ['Siguiente'] })
    flat.title = 'Título nuevo'
    const out = restoreTexts(flat, i18n, lang)
    expect(out.title).toEqual({ en: 'Title', es: 'Título nuevo' })
    expect(out.answers[0].text).toEqual({ en: 'Yes', ca: 'Sí', es: 'Yes' })
    expect(out.description).toBe('plain')
    expect(flattenTexts({ name: 'n' }, ['name']).i18n).toEqual({})
  })
})
