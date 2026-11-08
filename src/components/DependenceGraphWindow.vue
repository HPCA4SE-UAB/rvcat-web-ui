<script setup>
  import { t } from '@/i18n'
  // Floating, movable and resizable window with the data dependence graph.
  // Graph options are owned by the parent (they regenerate the graph in RVCAT);
  // the window geometry and zoom are stored here.
  import { ref, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'
  import { useDraggable, useResizeObserver }                     from '@vueuse/core'
  import { parseNode, parseEdge, chainSteps, isChainEdge }      from '@/graphHighlight'

  const props = defineProps({
    svg:        { type: String, default: '' },
    options:    { type: Object, required: true },   // iters, showIntern, showLaten, showSmall, showFull
    chain:      { type: Object, default: null },    // selected latency bound: { instructions, recurrence, cycles }
    hoverInstr: { type: Number, default: -1 },      // instruction highlighted in the tables / program
  })
  const emit = defineEmits(['close', 'clear-chain', 'help', 'set-option'])

  const STORAGE_KEY = 'dependenceGraphWindow'
  const HEADER_H = 36, MIN_W = 320, MIN_H = 220, MARGIN = 8

  // Default: wide and low (the graph is laid out left to right), at the bottom-right corner,
  // so the program panel (where hovered instructions are highlighted) stays visible.
  // BOTTOM_FREE leaves room for the floating tutorial buttons at the bottom of the screen.
  const BOTTOM_FREE = 90
  const defaultW = Math.round(Math.min(1000, window.innerWidth  * 0.6))
  const defaultH = Math.round(Math.min(420,  window.innerHeight * 0.42))
  const geometry = reactive({
    w: defaultW, h: defaultH,
    x: window.innerWidth  - defaultW - 2 * MARGIN,
    y: Math.max(MARGIN, window.innerHeight - defaultH - BOTTOM_FREE),
  })
  try { Object.assign(geometry, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) } catch { /* defaults */ }
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry)) } catch { /* ignore */ } }

  // Keep the whole window on screen (e.g. after the browser window is made smaller)
  function keepInWindow() {
    geometry.w = Math.min(Math.max(geometry.w, MIN_W), window.innerWidth  - 2 * MARGIN)
    geometry.h = Math.min(Math.max(geometry.h, MIN_H), window.innerHeight - 2 * MARGIN)
    geometry.x = Math.min(Math.max(geometry.x, MARGIN), window.innerWidth  - geometry.w - MARGIN)
    geometry.y = Math.min(Math.max(geometry.y, MARGIN), window.innerHeight - geometry.h - MARGIN)
  }
  keepInWindow()

  // ---- Move (drag the title bar) and resize (bottom-right corner) ----
  const windowRef = ref(null)
  const headerRef = ref(null)
  useDraggable(headerRef, {
    initialValue: { x: geometry.x, y: geometry.y },
    preventDefault: true,
    onMove(pos) {
      geometry.x = Math.min(Math.max(pos.x, 0), window.innerWidth  - geometry.w)
      geometry.y = Math.min(Math.max(pos.y, 0), window.innerHeight - HEADER_H)
    },
    onEnd: save,
  })
  useResizeObserver(windowRef, (entries) => {
    const box = entries[0].borderBoxSize?.[0]
    geometry.w = box ? box.inlineSize : entries[0].contentRect.width
    geometry.h = box ? box.blockSize  : entries[0].contentRect.height
    save()
  })
  const onWindowResize = () => { keepInWindow(); save() }
  onMounted(() => window.addEventListener('resize', onWindowResize))
  onUnmounted(() => window.removeEventListener('resize', onWindowResize))

  // ---- Zoom (mouse wheel) and pan (drag the graph) ----
  const zoom     = ref(1)
  const graphRef = ref(null)
  // Zoom keeping the point under the mouse in place
  async function onWheel(event) {
    const body   = graphRef.value
    const rect   = body.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const pointX = body.scrollLeft + mouseX       // content coordinates under the mouse
    const pointY = body.scrollTop  + mouseY

    const old  = zoom.value
    const next = Math.min(8, Math.max(0.3, old * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
    if (next === old) return
    zoom.value = next
    await nextTick()
    const ratio = next / old
    body.scrollLeft = pointX * ratio - mouseX
    body.scrollTop  = pointY * ratio - mouseY
  }
  function fit() { zoom.value = 1 }

  let pan = null
  function startPan(event) {
    if (event.button !== 0) return
    pan = { x: event.clientX, y: event.clientY, left: graphRef.value.scrollLeft, top: graphRef.value.scrollTop }
  }
  function movePan(event) {
    if (!pan) return
    graphRef.value.scrollLeft = pan.left - (event.clientX - pan.x)
    graphRef.value.scrollTop  = pan.top  - (event.clientY - pan.y)
  }
  function endPan() { pan = null }

  // ---- Highlight the selected cyclic chain and the hovered instruction ----
  function applyHighlight() {
    const root = graphRef.value
    if (!root) return
    const steps = props.chain ? chainSteps(props.chain.instructions) : null
    const inChain = new Set(props.chain?.instructions ?? [])

    root.querySelectorAll('g.node').forEach(g => {
      const node = parseNode(g.querySelector('title')?.textContent)
      const hl = Boolean(steps && node && inChain.has(node.instr))
      g.classList.toggle('chain', hl)
      g.classList.toggle('dimmed', Boolean(steps) && !hl)
      g.classList.toggle('hovered', Boolean(node) && node.instr === props.hoverInstr)
    })
    root.querySelectorAll('g.edge').forEach(g => {
      const edge = parseEdge(g.querySelector('title')?.textContent)
      const hl = Boolean(steps) && isChainEdge(edge, steps)
      g.classList.toggle('chain', hl)
      g.classList.toggle('dimmed', Boolean(steps) && !hl)
    })
  }
  watch(() => [props.svg, props.chain, props.hoverInstr, zoom.value], () => nextTick(applyHighlight),
        { immediate: true })

  // ---- Graph options (labels are phrased as "what is shown") ----
  const toggle = (key) => emit('set-option', key, !props.options[key])
  const setIterations = (event) => {
    const n = Math.min(7, Math.max(1, Math.round(Number(event.target.value)) || 1))
    event.target.value = n
    emit('set-option', 'iters', n)
  }
</script>

<template>
  <div ref="windowRef" class="graph-window"
       :style="{ left: geometry.x + 'px', top: geometry.y + 'px', width: geometry.w + 'px', height: geometry.h + 'px' }">
    <div ref="headerRef" class="graph-window-header no-pin" :title="t('Drag to move the window')">
      <span class="graph-window-title">{{ t('Data dependence graph') }}</span>
      <span v-if="chain" class="graph-window-chain">
        {{ chain.recurrence }}: {{ chain.cycles }} cycles/iter
        <button class="chain-clear" @click.stop="emit('clear-chain')" :title="t('Show the whole graph')">×</button>
      </span>
      <button class="graph-window-btn" @click.stop="emit('help')" :title="t('Show help')">?</button>
      <button class="graph-window-btn" @click.stop="emit('close')" :title="t('Close')">✕</button>
    </div>

    <div class="graph-window-toolbar">
      <label class="iters" :title="t('Number of loop iterations shown (1 to 7)')">
        {{ t('Iterations') }}
        <input type="number" min="1" max="7" :value="options.iters" @change="setIterations" id="dependence-graph-iterations">
      </label>
      <button class="blue-button toggle-button" :class="{ active: options.showIntern }" @click="toggle('showIntern')"
              id="show-internal-dependences"
              :title="t('Show also the instructions that are not in any cyclic dependence chain')">
        <span v-if="options.showIntern">✔ </span>{{ t('Non-cyclic nodes') }}
      </button>
      <button class="blue-button toggle-button" :class="{ active: options.showLaten }" @click="toggle('showLaten')"
              id="show-latency-dependences" :title="t('Show the latency of each instruction')">
        <span v-if="options.showLaten">✔ </span>{{ t('Latencies') }}
      </button>
      <button class="blue-button toggle-button" :class="{ active: !options.showSmall }" @click="toggle('showSmall')"
              id="show-instruction-dependences" :title="t('Show the text of each instruction (otherwise only its number)')">
        <span v-if="!options.showSmall">✔ </span>{{ t('Instruction text') }}
      </button>
      <button class="blue-button toggle-button" :class="{ active: options.showFull }" @click="toggle('showFull')"
              id="show-full-dependences" :title="t('Show the dependences on constants and read-only inputs')">
        <span v-if="options.showFull">✔ </span>{{ t('Constants & inputs') }}
      </button>
      <span class="toolbar-spacer"></span>
      <!-- Only while zoomed: the graph always fills the window at zoom 100% -->
      <button v-if="zoom !== 1" class="blue-button" id="graph-reset-zoom" @click="fit"
              :title="t('Back to zoom 100%: the graph fills the window (also: double click on the graph)')">
        Zoom {{ Math.round(zoom * 100) }}% ✕
      </button>
    </div>

    <div ref="graphRef" class="graph-window-body no-pin" id="dependence-graph"
         :title="t('Mouse wheel: zoom · Drag: move · Double click: zoom 100%')"
         @wheel.prevent="onWheel" @mousedown="startPan" @mousemove="movePan"
         @mouseup="endPan" @mouseleave="endPan" @dblclick="fit">
      <div class="graph-zoom" :style="{ width: (zoom * 100) + '%' }" v-html="svg"></div>
      <div v-if="!svg" class="graph-empty">{{ t('No graph') }}</div>
    </div>
  </div>
</template>

<style scoped>
  .graph-window {
    position:      fixed;
    z-index:       900;
    display:       flex;
    flex-direction: column;
    box-sizing:    border-box;
    min-width:     320px;
    min-height:    220px;
    background:    #fff;
    border:        1px solid #9aa7b8;
    border-radius: 8px;
    box-shadow:    0 6px 24px rgba(0, 0, 0, 0.25);
    resize:        both;
    overflow:      hidden;
  }

  .graph-window-header {
    display:     flex;
    align-items: center;
    gap:         8px;
    height:      36px;
    padding:     0 8px 0 12px;
    background:  #2c3e50;
    color:       #fff;
    cursor:      grab;
    user-select: none;
    flex-shrink: 0;
  }
  .graph-window-header:active { cursor: grabbing; }
  .graph-window-title { font-weight: 600; white-space: nowrap; }
  .graph-window-chain {
    margin-left:   auto;
    padding:       1px 4px 1px 8px;
    background:    #fff3c4;
    color:         #5a4500;
    border-radius: 4px;
    font-size:     0.85em;
    white-space:   nowrap;
  }
  .chain-clear, .graph-window-btn {
    background: none;
    border:     none;
    color:      inherit;
    cursor:     pointer;
    font-size:  1em;
  }
  .graph-window-btn:first-of-type { margin-left: auto; }
  .graph-window-chain + .graph-window-btn { margin-left: 0; }

  .graph-window-toolbar {
    display:     flex;
    flex-wrap:   wrap;
    align-items: center;
    gap:         4px;
    padding:     4px 8px;
    border-bottom: 1px solid #e0e0e0;
    flex-shrink: 0;
  }
  .toolbar-spacer { flex: 1; }
  .iters { font-size: small; margin-right: 4px; white-space: nowrap; }
  .iters input { width: 3em; margin-left: 4px; }

  .graph-window-body {
    flex:     1;
    overflow: auto;
    cursor:   move;
  }
  .graph-zoom :deep(svg) {
    display: block;
    width:   100%;
    height:  auto;
  }
  .graph-empty { padding: 1em; color: #888; }

  /* Highlighting */
  .graph-zoom :deep(g.dimmed) { opacity: 0.18; }
  .graph-zoom :deep(g.node.chain polygon) { stroke: #d93025; stroke-width: 3px; }
  .graph-zoom :deep(g.edge.chain path)    { stroke: #d93025; stroke-width: 3.5px; }
  .graph-zoom :deep(g.edge.chain polygon) { stroke: #d93025; fill: #d93025; }
  .graph-zoom :deep(g.node.hovered polygon) { fill: #ffd54f; }
</style>
