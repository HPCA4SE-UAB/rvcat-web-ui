import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateTutorialFlow, addNewDistributionFiles, removeDroppedDistributionFiles } from './common'

describe('migrateTutorialFlow: button labels', () => {
  it('keeps each label with its successor when empty successors are removed', () => {
    const t = migrateTutorialFlow({
      flowVersion: 2,
      steps: [
        { id: 'a', next: ['', 'b'], nextLabels: ['unused', 'More detail'] },
        { id: 'b', next: ['end'] },
      ],
    })
    expect(t.steps[0].next).toEqual(['b'])
    expect(t.steps[0].nextLabels).toEqual(['More detail'])
  })
  it('keeps the labels written in several languages', () => {
    const t = migrateTutorialFlow({
      flowVersion: 2,
      steps: [{ id: 'a', next: ['end'], nextLabels: [{ en: 'Start', es: 'Empezar', ca: 'Comença' }] }],
    })
    expect(t.steps[0].nextLabels).toEqual([{ en: 'Start', es: 'Empezar', ca: 'Comença' }])
  })
})

describe('addNewDistributionFiles', () => {
  beforeEach(() => {
    const store = new Map()   // in-memory localStorage
    vi.stubGlobal('localStorage', {
      getItem:    (k) => (store.has(k) ? store.get(k) : null),
      setItem:    (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear:      () => store.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => ({ name: url.split('/').pop() }),
    })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('adds new distribution tutorials once, not the ones already stored', async () => {
    localStorage.setItem('tutorial.navigation-tour', '{}')
    const added = await addNewDistributionFiles('tutorial', ['navigation-tour', 'tutorial2'], ['navigation-tour'])
    expect(added).toEqual(['tutorial2'])
    expect(localStorage.getItem('tutorial.tutorial2')).toContain('tutorial2.json')
  })

  it('does not add again a tutorial that the user deleted', async () => {
    await addNewDistributionFiles('tutorial', ['tutorial2'], [])
    localStorage.removeItem('tutorial.tutorial2')            // the user deletes it
    const added = await addNewDistributionFiles('tutorial', ['tutorial2'], [])
    expect(added).toEqual([])
    expect(localStorage.getItem('tutorial.tutorial2')).toBeNull()
  })

  it('removes the unmodified copies of files dropped from the distribution, and keeps the others', () => {
    localStorage.setItem('program.f0', 'A');   localStorage.setItem('distribution.program.f0', 'A')   // unmodified
    localStorage.setItem('program.f1', 'B2');  localStorage.setItem('distribution.program.f1', 'B')   // modified by the user
    localStorage.setItem('program.mine', 'C')                                                       // the user's own
    localStorage.setItem('program.Base', 'D'); localStorage.setItem('distribution.program.Base', 'D') // still distributed
    const removed = removeDroppedDistributionFiles('program', ['Base'], ['Base', 'f0', 'f1', 'mine'])
    expect(removed).toEqual(['f0'])
    expect(localStorage.getItem('program.f0')).toBeNull()
    expect(localStorage.getItem('program.f1')).toBe('B2')
    expect(localStorage.getItem('distribution.program.f1')).toBeNull()      // now a file of the user
    expect(localStorage.getItem('program.mine')).toBe('C')
    expect(localStorage.getItem('program.Base')).toBe('D')
  })
})
