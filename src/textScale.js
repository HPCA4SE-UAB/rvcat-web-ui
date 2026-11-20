// Size of the text of the whole interface (the A− / A+ buttons of the header), remembered in
// this browser: for small screens, projectors or readers who need a larger text. Every size of
// the interface is in rem, so it follows the size of the root element; the canvas of the
// timeline reads it when it draws.
import { ref, watch, nextTick } from 'vue'

const STORAGE_KEY = 'textScale'
export const TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.375, 1.5]

function initialScale() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY))
    if (TEXT_SCALES.includes(v)) return v
  } catch { /* default */ }
  return 1
}

export const textScale = ref(initialScale())

function apply(scale) {
  try { document.documentElement.style.fontSize = `${16 * scale}px` } catch { /* no document (tests) */ }
}
apply(textScale.value)

watch(textScale, (scale) => {
  apply(scale)
  try { localStorage.setItem(STORAGE_KEY, String(scale)) } catch { /* not stored */ }
  // panels that measure their size (timeline, diagrams) adapt to the new text
  nextTick(() => window.dispatchEvent(new Event('resize')))
})

export function changeTextScale(step) {
  const i = TEXT_SCALES.indexOf(textScale.value)
  const next = Math.min(TEXT_SCALES.length - 1, Math.max(0, (i < 0 ? 1 : i) + step))
  textScale.value = TEXT_SCALES[next]
}
export const canGrow   = () => textScale.value < TEXT_SCALES.at(-1)
export const canShrink = () => textScale.value > TEXT_SCALES[0]
