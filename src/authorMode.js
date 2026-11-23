// Author mode: the tools to create material (program and tutorial editors, the structure of the
// processor, saving and removing configurations) are hidden from students.
// It is turned on with the URL parameter ?author (and off with ?author=0); the choice is
// remembered in this browser, and the header shows a badge to leave the mode.
import { ref, watch } from 'vue'
import { isLocked } from '@/lessons'

const STORAGE_KEY = 'authorMode'

function initialMode() {
  let stored = false
  try { stored = localStorage.getItem(STORAGE_KEY) === 'true' } catch { /* not stored */ }
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('author')) return !['0', 'false', 'no', 'off'].includes(params.get('author').toLowerCase())
  } catch { /* no URL (tests) */ }
  return stored
}

export const authorMode = ref(initialMode())
watch(authorMode, (on) => {
  try { localStorage.setItem(STORAGE_KEY, String(on)) } catch { /* not stored */ }
}, { immediate: true })

// What only the author can do. Students can still change the main parameters of the processor
// (widths, ROB, cache, branch penalty), save and remove configurations (a lesson can lock them),
// and load program, processor and lesson files.
export const AUTHOR_ONLY = new Set([
  'programEditor', 'tutorialEditor', 'loopTransforms',
  'processor.ports', 'processor.latencies', 'lessonExport',
])

export function authorLocked(what, author = authorMode.value) {
  return !author && AUTHOR_ONLY.has(what)
}

// Locked by the lesson in progress, or reserved to the author. A lesson can still allow
// something to its students ("allow" of the lesson or of a card).
export function uiLocked(lesson, what, allow = []) {
  if (allow.includes(what) || (what.startsWith('processor.') && allow.includes('processor'))) return false
  return isLocked(lesson, what, allow) || authorLocked(what)
}
