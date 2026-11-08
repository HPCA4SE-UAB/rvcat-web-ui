<script>
  // The help window is opened from an info icon (ⓘ): remember the last one clicked, to find the
  // panel that the help describes (shared by every help window, so it lives in module scope).
  let lastInfoIcon = null
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (event) => {
      const icon = event.target instanceof Element ? event.target.closest('.info-icon') : null
      if (icon) lastInfoIcon = icon
    }, true)
  }

  // Part of the screen described by the help of an info icon:
  //  - left column: the processor or program panel (a header and the content that follows it)
  //  - right panel (simulation, analysis, timeline): the whole panel
  //  - full-screen editors: none (the help is centered)
  export function describedArea(icon) {
    if (!icon?.isConnected) return null
    const right = icon.closest('#right-panel')
    if (right) return right.getBoundingClientRect()
    const column = icon.closest('#process-panel')
    if (!column) return null
    let block = icon
    while (block.parentElement && block.parentElement !== column) block = block.parentElement
    const rects = [block.getBoundingClientRect()]
    if (block.classList.contains('header') && block.nextElementSibling &&
        !block.nextElementSibling.classList.contains('header'))
      rects.push(block.nextElementSibling.getBoundingClientRect())
    const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top))
    const right2 = Math.max(...rects.map(r => r.right)), bottom = Math.max(...rects.map(r => r.bottom))
    return { left, top, right: right2, bottom, width: right2 - left, height: bottom - top }
  }
</script>

<script setup>
  import { t } from '@/i18n'
  import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

  const props = defineProps({
    position: {
      type: Object,
      default: () => ({ top: '50%', left: '50%' }),
    },
    text: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: '',
    }
  });

  const emit       = defineEmits(['close']);
  const visible    = ref(true);
  const dialogRef  = ref(null);
  const contentRef = ref(null);
  const layout     = ref(null);   // { left, top, width } in px, or null before fitting
  const spot       = ref(null);   // area of the described panel, kept visible (not dimmed)
  const hasSections = ref(false)
  const allOpen     = ref(false)

  const MARGIN    = 8;     // px between the dialog and the window border or the panel
  const MIN_WIDTH = 340;   // narrower free areas are not used: the dialog is centered instead
  const MAX_WIDTH = 960;

  const positionStyle = computed(() => layout.value
    ? { position: 'absolute', left: `${layout.value.left}px`, top: `${layout.value.top}px`, width: `${layout.value.width}px` }
    : { position: 'absolute', top: props.position.top, left: props.position.left, visibility: 'hidden' });

  const spotStyle = computed(() => spot.value && {
    left: `${spot.value.left}px`, top: `${spot.value.top}px`,
    width: `${spot.value.width}px`, height: `${spot.value.height}px` });

  // Width and left side of the dialog: the widest free area beside the described panel
  function horizontalPlace(area) {
    const W = window.innerWidth
    if (area) {
      const sides = [
        { left: area.right + MARGIN, free: W - area.right - 2 * MARGIN },
        { left: MARGIN,              free: area.left - 2 * MARGIN },
      ].sort((a, b) => b.free - a.free)
      if (sides[0].free >= MIN_WIDTH) {
        const width = Math.min(MAX_WIDTH, sides[0].free)
        // next to the panel: on its right side start at the panel, on its left side end at it
        const left = sides[0].left === MARGIN ? area.left - MARGIN - width : sides[0].left
        return { left, width }
      }
    }
    const width = Math.min(MAX_WIDTH, W - 2 * MARGIN)
    return { left: (W - width) / 2, width }
  }

  // Place the dialog beside the panel it describes, as large as the free area allows;
  // the height follows the text (sections opened or closed) up to the window height
  async function fit() {
    const area = describedArea(lastInfoIcon)
    spot.value = area
    const { left, width } = horizontalPlace(area)
    layout.value = { left, width, top: layout.value?.top ?? MARGIN }
    await nextTick()
    const el = dialogRef.value
    if (!el) return
    const height = el.getBoundingClientRect().height
    const wanted = area ? area.top : (window.innerHeight - height) / 2
    const top = Math.max(MARGIN, Math.min(wanted, window.innerHeight - height - MARGIN))
    layout.value = { left, width, top }
  }

  // Sections: <details><summary>Topic</summary> ... </details>
  const sections = () => [...(contentRef.value?.querySelectorAll('details') ?? [])]
  function toggleAll() {
    allOpen.value = !allOpen.value
    for (const d of sections()) d.open = allOpen.value
  }
  function onToggle() {
    const list = sections()
    allOpen.value = list.length > 0 && list.every(d => d.open)
    fit()
  }

  let observer = null
  onMounted(() => {
    hasSections.value = sections().length > 0
    fit();
    window.addEventListener('resize', fit);
    contentRef.value?.addEventListener('toggle', onToggle, true)
    if (typeof ResizeObserver !== 'undefined' && dialogRef.value) {
      observer = new ResizeObserver(() => fit())
      observer.observe(contentRef.value)
    }
  });
  onUnmounted(() => {
    window.removeEventListener('resize', fit)
    observer?.disconnect()
  });

  function close() {
    visible.value = false;
    emit('close');
  }
</script>

<template>
  <div v-if="visible" class="help-overlay" :class="{ dimmed: !spot }" @click.self="close">
    <div v-if="spot" class="help-spot" :style="spotStyle"></div>
    <div ref="dialogRef" class="help-dialog" :style="positionStyle">
      <div class="help-title">
        <b>Help - {{title}}</b>
        <button v-if="hasSections" class="sections-button" @click="toggleAll"
                :title="allOpen ? 'Close every section' : 'Open every section'">
          {{ allOpen ? '▴ close all' : '▾ open all' }}
        </button>
        <button class="close-button" @click="close" :title="t('Close (or click outside)')">x</button>
      </div>
      <div ref="contentRef" class="dialog-content" v-html="text"></div>
    </div>
  </div>
</template>

<style scoped>
  .help-overlay {
    top:    0;
    left:   0;
    inset:  0;
    width:  100vw;
    height: 100vh;
    position: fixed;
    z-index:  10000;
  }
  .help-overlay.dimmed { background: rgba(0,0,0,0.5); }

  /* The described panel stays bright: the rest of the window is dimmed around it */
  .help-spot {
    position:       fixed;
    pointer-events: none;
    border-radius:  4px;
    box-shadow:     0 0 0 200vmax rgba(0, 0, 0, 0.45);
  }

  .help-dialog {
    background: #ffffff;
    padding:    0.8em 1.1em;
    box-sizing: border-box;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    /* Text size adapts to the window: smaller on short or narrow screens */
    font-size:  clamp(13px, min(2.3vh, 3.2vw), 18px);
    font-family: system-ui, -apple-system, BlinkMacSystemFont,
               "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .help-title {
    display:     flex;
    align-items: center;
    gap:         0.8em;
  }
  .help-title b { flex: 1; }

  .sections-button {
    background:    none;
    border:        1px solid #b8c9e8;
    border-radius: 4px;
    color:         #1a4fb3;
    font-size:     0.8em;
    cursor:        pointer;
    padding:       0.1em 0.5em;
    white-space:   nowrap;
  }
  .sections-button:hover { background: #eef3fb; }

  .close-button {
    background: none;
    border:     none;
    font-size:  1.2em;
    color:      #666;
    cursor:     pointer;
  }

  .close-button:hover {
    color: #000;
  }

  .dialog-content {
    margin-top:  0.6em;
    font-size:   0.95em;
    line-height: 1.5;
    text-align:  left;
    color:       #333;
  }

  .dialog-content :deep(p) {
    margin: 0.5em 0;
  }

  /* Expandable sections: <details><summary>Topic</summary><p>...</p></details>
     Reading by levels: the summaries are the headlines, a click shows the detail */
  .dialog-content :deep(details) {
    margin:        0.3em 0;
    border-left:   3px solid #7aa2e3;
    padding-left:  0.6em;
  }
  .dialog-content :deep(summary) {
    cursor:      pointer;
    font-weight: 600;
    color:       #1a4fb3;
  }
  .dialog-content :deep(summary:hover) {
    text-decoration: underline;
  }
  .dialog-content :deep(details[open] > summary) {
    margin-bottom: 0.2em;
  }
  .dialog-content :deep(details details) {
    border-left-color: #c3d4f0;
  }
</style>
