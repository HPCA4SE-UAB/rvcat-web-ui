import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateTutorialFlow, addNewDistributionFiles } from './common'

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
})
