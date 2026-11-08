<script setup>
  import { t } from '@/i18n'
  // Click (or tap) on any element that has an explanation in its `title` shows that
  // explanation in a box that stays until clicking elsewhere or pressing Escape.
  // Hover-only tooltips are not available on touch screens, and pinned boxes help in class.
  import { ref, onMounted, onUnmounted, nextTick } from 'vue'

  // Controls keep their normal behaviour; these areas never pin
  const IGNORE = 'button, input, select, textarea, a, label, summary, header, canvas, ' +
                 '.no-pin, .info-icon, .help-overlay, .pinned-detail'
  const MARGIN = 8

  const detail = ref(null)   // { text, style }
  const boxRef = ref(null)

  // Graphviz diagrams inside [data-pin-twice] (Processor panel): the first click on a cell
  // runs its own action (select a parameter for editing); a second click on the same cell pins
  // its tooltip, which stays while that cell is clicked again. The attribute value lists the
  // ids of action cells that never pin (a second click repeats their action).
  const XLINK = 'http://www.w3.org/1999/xlink'
  let lastSvgCell = null
  function svgCell(target) {
    const zone = target.closest('[data-pin-twice]')
    const link = target.closest('a')
    const text = link && (link.getAttribute('xlink:title') || link.getAttributeNS(XLINK, 'title'))
    const key  = link?.closest('g[id]')?.id ?? text    // the diagram may be redrawn between clicks
    const never = (zone.getAttribute('data-pin-twice') || '').split(/\s+/)
    if (!text?.trim() || never.includes(key)) { lastSvgCell = null; return null }
    const again = key === lastSvgCell
    lastSvgCell = key
    return again ? { el: link, text } : null
  }

  async function show(el, text = el.getAttribute('title')) {
    const rect = el.getBoundingClientRect()
    // data-pin-code: the explanation is source code (monospace, spaces kept)
    detail.value = { text, code: el.hasAttribute('data-pin-code'),
                     style: { left: '0px', top: '0px', visibility: 'hidden' } }
    await nextTick()
    const box = boxRef.value.getBoundingClientRect()
    const below = rect.bottom + MARGIN + box.height < window.innerHeight
    const left  = Math.min(Math.max(rect.left, MARGIN), window.innerWidth - box.width - MARGIN)
    const top   = below ? rect.bottom + 4 : Math.max(MARGIN, rect.top - box.height - 4)
    detail.value.style = { left: `${left}px`, top: `${top}px` }
  }

  function onClick(event) {
    const target = event.target
    if (!(target instanceof Element) || target.closest('.pinned-detail')) return
    if (target.closest('[data-pin-twice]')) {
      const cell = svgCell(target)
      if (cell) show(cell.el, cell.text)
      else detail.value = null
      return
    }
    lastSvgCell = null
    const el = target.closest('[title]')
    if (!el || target.closest(IGNORE) || !el.getAttribute('title')?.trim()) {
      detail.value = null
      return
    }
    show(el)
  }
  const onKey = (event) => { if (event.key === 'Escape') detail.value = null }

  onMounted(() => {
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
  })
  onUnmounted(() => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKey)
  })
</script>

<template>
  <Teleport to="body">
    <div v-if="detail" ref="boxRef" class="pinned-detail" :style="detail.style" role="tooltip">
      <button class="pinned-detail-close" @click="detail = null" :title="t('Close (Esc)')">✕</button>
      <div class="pinned-detail-text" :class="{ code: detail.code }">{{ detail.text }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
  .pinned-detail {
    position:      fixed;
    z-index:       9000;
    max-width:     min(40rem, calc(100vw - 16px));
    padding:       6px 28px 6px 10px;
    background:    #fffbe6;
    color:         #222;
    border:        1px solid #c9a227;
    border-radius: 6px;
    box-shadow:    0 4px 14px rgba(0, 0, 0, 0.2);
    font-size:     13px;
    line-height:   1.4;
  }
  .pinned-detail-text { white-space: pre-line; }
  .pinned-detail-text.code { white-space: pre; font-family: monospace; overflow-x: auto; }
  .pinned-detail-close {
    position:   absolute;
    top:        2px;
    right:      4px;
    background: none;
    border:     none;
    cursor:     pointer;
    color:      #7a6200;
  }
</style>
