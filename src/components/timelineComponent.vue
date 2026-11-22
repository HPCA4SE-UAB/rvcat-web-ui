<script setup>
  import { t, locale } from '@/i18n'
  import { ref, toRaw, onMounted, nextTick, onUnmounted, onBeforeUnmount,
           watch, inject, reactive, computed}                         from 'vue'
  import HelpComponent                    from '@/components/helpComponent.vue'
  import {
    charToProcessingState,
    createMemoryAddressColorMap,
    getLogicalElementCount,
    getUnsupportedInstructions,
    validateProgram,
    repetitionFields
  } from '@/common'
  import {
    computeCriticalCycles,
    computeInstructionCriticalPercentages,
    findLastRetiredInstructionIndex
  } from '@/criticalPath'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'

  const { getTimeline }     = useRVCAT_Api()
  const { registerHandler } = inject('worker')
  const simState            = inject('simulationState')

  /* ------------------------------------------------------------------
   * Timeline options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'timelineOptions'
  const TIMELINE_RETIRE_LIMIT = 200

  const defaultOptions = {
    instructions:  20,
    cycles:        30,
    autoFitCycles: true,   // cycles follow the available width until the user sets them
    critical:      false,
    showPorts:     true,
    showCache:     true,
    showText:      true,   // the text of each instruction in the first column
    expandPorts:   false,  // the rows of the resources: a summary row, or the summary and its rows
    expandCache:   false,
    expandFill:    false,
    expandWrite:   false,
    expandMemory:  false,  // the rows of the memory (MM, cache, buffers, SB): one row (the use of the MM bus), or all
    canvasScale:   1,
    canvasOffsetX: 0,
    canvasOffsetY: 0
  }

  const timelineOptions = reactive(defaultOptions)
  const DETAILS_KEY = 'timelineDetailsOpen'
  const detailsOpen = ref(true)
  try { detailsOpen.value = localStorage.getItem(DETAILS_KEY) !== 'false' } catch { /* default */ }
  watch(detailsOpen, (v) => {
    try { localStorage.setItem(DETAILS_KEY, String(v)) } catch { /* ignore */ }
    nextTick(() => window.dispatchEvent(new Event('resize')))      // the timeline changes its width
  })

  // Sizes of the cells (px): 14 × 20 at the base size of the text (16 px), scaled with the text of
  // the page (A−/A+). The first column shows the number of the instruction and, with Text, its text.
  const TEXT_CHARS = 16          // longest instruction text shown (longer ones are cut with …)
  function timelineGeometry() {
    const k = Math.max(0.75, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16)
    const font = Math.round(14 * k)
    let chars = 8                  // the names of the summary rows of the resources ("▸ Memory")
    if (timelineOptions.showText) {
      const list = [...(simState.simulatedProcess?.instruction_list ?? []), ...(simState.simulatedProcess?.epilogue ?? [])]
      chars = Math.max(chars, 2 + Math.min(TEXT_CHARS, Math.max(0, ...list.map(i => String(i?.text ?? '').length))))
    }
    return {
      k, font,
      cellW:  Math.round(14 * k),
      cellH:  Math.round(20 * k),
      labelW: Math.max(Math.round(40 * k), Math.round(font * 0.62 * chars) + Math.round(8 * k)),
    }
  }
  const labelText = (instrIdx, text) => {
    if (!timelineOptions.showText) return String(instrIdx % 10)
    const s = String(text ?? '')
    return `${instrIdx % 10} ${s.length > TEXT_CHARS ? s.slice(0, TEXT_CHARS - 1) + '…' : s}`
  }

  // Number of cycles that fit in the visible width of the timeline
  function fitCycles() {
    const wrapper = document.getElementById('canvas-container')
    if (!wrapper || !wrapper.clientWidth) return
    const scale = timelineOptions.canvasScale || 1
    const g = timelineGeometry()
    const fitting = Math.floor(((wrapper.clientWidth - MINIMAP_W) / scale - 2 * 10 - g.labelW) / g.cellW)
    timelineOptions.canvasOffsetX = 0
    // the whole timeline: the window moves along it (it follows the rows)
    timelineOptions.cycles = Math.min(maxCycles(), Math.max(10, fitting, timeline.value?.cycles ?? 0))
  }
  function onResizeFit()   { if (timelineOptions.autoFitCycles) fitCycles() }
  // the canvases of the world cannot be wider than about 32,000 pixels: very long timelines
  // (e.g. a tiny cache that misses all the time) show their first cycles
  const MAX_WORLD_PX = 30000
  function maxCycles() {
    const g = timelineGeometry()
    return Math.max(10, Math.floor((MAX_WORLD_PX - 2 * 10 - g.labelW) / g.cellW))
  }

  // The timeline shows everything (the text, the critical path, the ports, the cache, all the
  // cycles); a lesson can limit it: its hidden parts and its actions (simState.timelineLesson)
  function applyShownParts() {
    const lesson = simState.lesson ? (simState.timelineLesson ?? {}) : {}
    const hidden = simState.lesson?.hidden ?? []
    timelineOptions.showText  = true
    timelineOptions.critical  = !hidden.includes('timelineCritical') && lesson.critical !== false
    timelineOptions.showPorts = !hidden.includes('timelineResources') && lesson.ports !== false
    timelineOptions.showCache = !hidden.includes('timelineResources') && !hidden.includes('timelineCache') && lesson.cache !== false
    if (lesson.cacheRows) {                 // a lesson unfolds the memory and the lines of the cache
      timelineOptions.expandMemory = true
      timelineOptions.expandCache  = true
    }
    const all = timeline.value?.cycles ?? timelineOptions.cycles
    timelineOptions.autoFitCycles = !lesson.cycles
    if (lesson.cycles) timelineOptions.cycles = Math.min(lesson.cycles, all || lesson.cycles, maxCycles())
    else fitCycles()
    nextTick(() => present())
  }
  watch(() => [simState.lesson ? 1 : 0, (simState.lesson?.hidden ?? []).join(','), JSON.stringify(simState.timelineLesson ?? {})],
        () => applyShownParts())

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(timelineOptions, JSON.parse(saved))
        console.log('📈load options')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('📈default load options')
      }
    } catch (error) {
      console.error('📈❌ Failed to load:', error)
    }
  }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timelineOptions))
    } catch (error) {
      console.error('📈❌ Failed to save:', error)
    }
  }

  const timeline       = ref(null)
  const timelineError  = ref('')
  const timelineCanvas = ref(null)
  const overlayCanvas  = ref(null)
  const cacheEnabled   = computed(() => Number(simState.simulatedProcess?.nBlocks) > 0)

// ============================================================================
// WATCHES: timelineOptions, simulatedProcess, timeline  HANDLERS: getTimeline
// ============================================================================

  let timelinePending  = false
  let lastPending      = false

  watch(
    () => {
      const process = simState.simulatedProcess
      return [
        process.iters,
        process.name,
        process.ROBsize,
        process.dispatch,
        process.retire,
        simState.simulationSettings.sched,
        simState.simulationSettings.speculation,
        process.bPenalty,
        process.blkSize,
        process.nBlocks,
        process.nFillBuffers,
        process.nWriteBuffers,
        process.nStoreBuffers,
        process.instruction_list
      ]
    },
    requestTimeline,
    { deep: true, immediate: false }
  )

  watch(
    () => [
      simState.simulatedProcess.mPenalty,
      simState.simulatedProcess.mIssueTime,
      simState.simulatedProcess.nFillBuffers,
      simState.simulatedProcess.nWriteBuffers,
      simState.simulatedProcess.nStoreBuffers,
      simState.simulatedProcess.rThru
    ],
    requestTimeline,
    { flush: 'sync' }
  )

  function requestTimeline() {
    if (simState.state >= 3) {
      const process = simState.simulatedProcess
      const instruction_list = Array.isArray(process?.instruction_list)
        ? process.instruction_list
        : []
      const iters = process?.iters
      const Nloop = getLogicalElementCount(instruction_list, iters)
      const validationErrors = validateProgram(process, {
        logicalElementCount: Nloop
      })
      if (validationErrors.length) {
        timelineError.value = t('Cannot generate timeline for invalid program: {errors}', { errors: validationErrors.join(' ') })
        clearTimelineView()
        console.error('📈❌ Cannot generate timeline for invalid program:', validationErrors)
        return
      }

      const unsupportedInstructions = getUnsupportedInstructions(process)
      if (unsupportedInstructions.length) {
        const instructionList = unsupportedInstructions
          .map(({ index, instruction }) => `#${index + 1} (${instruction.type}.${instruction.oper})`)
          .join(', ')
        timelineError.value =
          t('Cannot generate timeline: the active processor has no execution port for {list}.', { list: instructionList })
        clearTimelineView()
        console.error('📈❌ Cannot generate timeline for unsupported instructions:', unsupportedInstructions)
        return
      }

      timelineError.value = ''
      if (timelinePending) {
        lastPending=true
        return  // skip request if previous request is still pending
      }
      timelinePending = true
      console.log('📈🔄 Request timeline from RVCAT')
      const { name, ROBsize, dispatch, retire,
              blkSize, nBlocks, mPenalty, mIssueTime,
              nFillBuffers, nWriteBuffers, rThru } = process
      const { sched, speculation } = simState.simulationSettings
      getTimeline(JSON.stringify( { name, Nloop, ROBsize, dispatch, retire, sched, speculation,
                                    bPenalty: process.bPenalty ?? 5,
                                    blkSize, nBlocks, mPenalty, mIssueTime,
                                    nFillBuffers: nFillBuffers ?? 2,
                                    nWriteBuffers: nWriteBuffers ?? 2,
                                    nStoreBuffers: process.nStoreBuffers ?? 16,
                                    rThru: rThru ?? 1,
                                    ...repetitionFields(toRaw(process)),
                                    instruction_list: toRaw(instruction_list)}, null, 2),
                  TIMELINE_RETIRE_LIMIT)
        .catch(error => {
          console.error('📈❌Failed to request timeline:', error)
          finishTimelineRequest()
        })
    }
  }

  const handleTimeline = async (data, dataType) => {
    // Handler for 'get_timeline' message (fired by RVCAT getTimeline function)
    if (dataType === 'error') {
      console.error('📈❌Failed to get timeline:', data)
    } else {
      try {
        let timelineRVCAT = JSON.parse(data)
        const graph = timelineRVCAT.critical_path_graph
        if (graph) {
          const computedCriticalCycles = computeCriticalCycles(graph, timelineRVCAT.instructions)
          const mismatchedRows = computedCriticalCycles.reduce((rows, cycles, rowIndex) => {
            if (JSON.stringify(cycles) !== JSON.stringify(timelineRVCAT.instructions[rowIndex][5]))
              rows.push(rowIndex)
            return rows
          }, [])
          if (mismatchedRows.length)
            console.warn('📈⚠️ Python and JavaScript critical-path cells differ for timeline rows:', mismatchedRows.slice(0, 10))
          timelineRVCAT.computedCriticalCycles = computedCriticalCycles
        } else {
          console.error('📈❌ Timeline response is missing critical_path_graph; using Python critical-cycle data.')
        }
        getPortUsage(timelineRVCAT);
        selectedCell.value = null
        timeline.value = timelineRVCAT
        applyShownParts()                                    // the whole new timeline (or the cycles of a lesson)
        timelineOptions.canvasOffsetX = 0
        timelineOptions.canvasOffsetY = 0
        timelineOptions.instructions = 1
        scheduleDraw(timelineOptions.cycles, 0)

      } catch (error) {
        console.error('📈❌Failed to process JSON timeline:', error)
      }
    }
    finishTimelineRequest()
  }

  function finishTimelineRequest() {
    timelinePending = false
    if (lastPending) {
      lastPending = false
      requestTimeline()
    }
  }

  function clearTimelineView() {
    timeline.value = null
    selectedCell.value = null
    for (const canvas of [timelineCanvas.value, overlayCanvas.value]) {
      const context = canvas?.getContext('2d')
      if (context) context.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleTimeline = null
  let unwatch               = null

  onMounted(() => {
    cleanupHandleTimeline = registerHandler('get_timeline', handleTimeline)
    loadOptions()
    addCanvasWrapper()
    requestTimeline()  // generate timeline using RVCAT (if previous components are mounted)
    window.addEventListener('resize', onResizeFit)
    window.addEventListener('keydown', onKeyDown)
    nextTick(() => {
      if (timelineOptions.autoFitCycles) fitCycles()
      unwatch = watch(
        () => [timelineOptions.instructions, timelineOptions.cycles, timelineOptions.critical,
               timelineOptions.showPorts, timelineOptions.showCache, timelineOptions.showText,
               timelineOptions.expandPorts, timelineOptions.expandCache, timelineOptions.expandFill, timelineOptions.expandWrite,
               timelineOptions.expandMemory,
               timelineOptions.canvasScale, timelineOptions.canvasOffsetX, timelineOptions.canvasOffsetY ],
            ([, newCycles], [, oldCycles]) => {
              if (!timelineCanvas.value || !timeline.value) return
              scheduleDraw(newCycles,oldCycles)
              saveOptions()
            }
          )
      console.log('📈🎯 Timeline Component mounted')
    })
  })
  onBeforeUnmount(() => {
    simState.timelineCriticalPathEnabled = false
    simState.timelineCriticalPathPercentages = null
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  })

  onUnmounted(() => {
    window.removeEventListener('resize', onResizeFit)
    window.removeEventListener('keydown', onKeyDown)
    resetSharedHighlights()          // (the Program panel goes back to its own view)
    if (cleanupHandleTimeline) {
      cleanupHandleTimeline()
      cleanupHandleTimeline = null
    }
    console.log('📈👋 Timeline Component unMounted')
  })

/* ------------------------------------------------------------------
* UI actions
* ------------------------------------------------------------------ */

  function toggleCritical()  { timelineOptions.critical = !timelineOptions.critical }

  function getPortUsage(timeline) {
    const inferredUsagePorts = {};
    const usageInstr = Array.from({ length: timeline.cycles }, () => []);
    const recordedPortOwners = timeline.resource_usage?.port_owners
    timeline.portUsageInstrByPort = recordedPortOwners

    for (const [rowIdx, [, , startCycle, port, states, , , flags]] of timeline.instructions.entries()) {
      const Index = states.indexOf("E");             // execution (loads and stores too)
      if (Index < 0 && flags?.wrong) continue      // wrong-path instruction squashed before executing
      if (Index < 0) alert(t('Timeline problem: all instructions must traverse an E state'));
      const cycle = startCycle + Index;

      // Verificar que cycle esté dentro del rango
      if (cycle >= 0 && cycle < timeline.cycles) {
        if (!recordedPortOwners)
          usageInstr[cycle].push(rowIdx);
        (inferredUsagePorts[port] ??= []).push(cycle);
      } else {
        console.warn(`Cycle ${cycle} fuera de rango (0-${timeline.cycles-1}) para instrucción ${rowIdx}`);
      }
    }
    if (recordedPortOwners) {
      for (const cycles of Object.values(recordedPortOwners)) {
        cycles.forEach((rows, cycle) => {
          usageInstr[cycle].push(...rows)
        })
      }
    }

    const recordedPortUsage = timeline.resource_usage?.ports ?? {}
    const configuredPorts = Object.keys(simState.simulatedProcess?.ports ?? {})
    const allPorts = new Set([
      ...configuredPorts,
      ...Object.keys(recordedPortUsage),
      ...Object.keys(inferredUsagePorts)
    ])
    const usagePorts = {}
    for (const port of allPorts) {
      const cycles = recordedPortUsage[port]
      usagePorts[port] = Array.isArray(cycles)
        ? cycles.flatMap((used, cycle) => used ? [cycle] : [])
        : (inferredUsagePorts[port] ?? [])
    }
    timeline.portUsagePorts = usagePorts
    timeline.portUsageInstr = usageInstr
    timeline.resourcePortIds = [...allPorts].sort((a, b) => Number(a) - Number(b))
  }

  function addCanvasWrapper () {
    const wrapper = document.getElementById("canvas-container")

    const observer = new ResizeObserver(() => {
      toggleCritical()  // forces watcher to re-draw canvas
      toggleCritical()  // forces watcher to re-draw canvas
    })

    observer.observe(wrapper)

    const canvas = timelineCanvas.value
    canvas.addEventListener("click", onClick)
    wrapper.addEventListener("mousedown", (e) => { downX = e.clientX; downY = e.clientY })
    wrapper.addEventListener("mousemove", onMouseMove)
    wrapper.addEventListener("mouseleave", onMouseLeave)
    wrapper.addEventListener("wheel", onWheel, { passive: false })
    window.addEventListener("mouseup", onMinimapUp)
  }

/* ------------------------------------------------------------------
 * CANVAS: DRAW timeline
 * ------------------------------------------------------------------ */
  const hoverInfo        = ref(null)
  const selectedCell     = ref(null)
  const interactiveCells = []
  let totalCycles = 0
  let totalInstr  = 0
  let cellW       = 14
  let labelW      = 40
  let cellH       = 20
  let resourceRowCount = 0
  let padX        = 10
  let padY        = 10
  let fontSize    = 14
  let fontXOffset = 2
  let fontYOffset = 3
  let rafPending  = false
  let visibleCriticalPath = null

  // Tooltips of the cells are built when drawing: redrawn in the new language
  watch(locale, () => { if (timeline.value && timelineCanvas.value) scheduleDraw(timelineOptions.cycles, timelineOptions.cycles) })

  function scheduleDraw(cycles, oldCycles) {
    if (rafPending) return
    rafPending = true

    requestAnimationFrame(() => {
      rafPending = false
      try {
        drawTimeline(cycles, oldCycles)
        drawSelectedCell()
        present()
        refocusPinned()
      } catch (e) {
        console.error('📈❌ Failed to draw the timeline:', e)
        timelineError.value = t('The timeline could not be drawn: {e}', { e: e.message })
      }
    })
  }

  // ---- The window of the timeline: fixed rows (cycles and resources) at the top, fixed first
  // column (the instructions) at the left. The rows of the instructions move up and down (wheel:
  // one row; Page Up / Page Down: one iteration; arrows: one row), and the cycles follow them: the
  // first visible row starts at the left. A minimap at the right shows the whole timeline. ----
  const MINIMAP_W  = 64
  const worldCanvas  = document.createElement('canvas')
  const worldOverlay = document.createElement('canvas')
  const minimapCanvas = ref(null)
  const scrollRow = ref(0)            // first visible row of instructions
  let view = { scrollX: 0, scrollY: 0, topH: 0, leftW: 0, w: 0, h: 0 }

  const visibleRowCount = () => Math.max(1, Math.floor((view.h - view.topH) / cellH))
  function maxScrollRow() {
    return Math.max(0, totalInstr - visibleRowCount() + 1)
  }
  function present() {
    const canvas = timelineCanvas.value, overlay = overlayCanvas.value
    const wrapper = canvas?.parentElement
    if (!canvas || !overlay || !wrapper || !timeline.value) return
    let w = Math.max(50, wrapper.clientWidth - MINIMAP_W)
    const h = Math.max(50, wrapper.clientHeight)
    // a lesson can end the timeline at a fraction of the window (its cards are at the right)
    const fraction = simState.lesson ? Number(simState.timelineLesson?.width) : 0
    if (fraction > 0 && fraction <= 1)
      w = Math.max(200, Math.min(w, window.innerWidth * fraction - wrapper.getBoundingClientRect().left))
    view.w = w
    view.h = h
    view.topH  = padY + (resourceRowCount + 1) * cellH
    view.leftW = padX + labelW
    scrollRow.value = Math.min(Math.max(0, scrollRow.value), maxScrollRow())
    view.scrollY = scrollRow.value * cellH
    // the cycles follow the rows: the first visible row is dispatched near the left border
    const first = timeline.value.instructions?.[scrollRow.value]
    const worldW = worldCanvas.width
    const startCycle = first ? Math.max(0, first[2] - 2) : 0
    let scrollX = startCycle * cellW
    // a pinned cell stays in view (it is moved with the arrows)
    const sel = selectedCell.value
    if (keepSelectionInView && sel && sel.colIdx >= 0 && (['resource-cycle', 'cycle-header'].includes(sel.cellType) || (!sel.cellType &&
        sel.rowIdx >= scrollRow.value && sel.rowIdx < scrollRow.value + visibleRowCount()))) {
      const bodyW = w - (padX + labelW)
      const x0 = sel.colIdx * cellW, x1 = x0 + cellW
      if (x0 < scrollX) scrollX = Math.max(0, x0 - 2 * cellW)
      else if (x1 > scrollX + bodyW) scrollX = x1 - bodyW + 2 * cellW
    }
    view.scrollX = Math.max(0, Math.min(scrollX, worldW - w))
    for (const [target, source] of [[canvas, worldCanvas], [overlay, worldOverlay]]) {
      if (target.width !== w || target.height !== h) {
        target.width = w
        target.height = h
        target.style.width = `${w}px`
        target.style.height = `${h}px`
      }
      const c = target.getContext('2d')
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.clearRect(0, 0, w, h)
      if (!source.width || !source.height) continue
      const { scrollX, scrollY, topH, leftW } = view
      const blit = (sx, sy, sw, sh, dx, dy) => {
        sw = Math.min(sw, source.width - sx)
        sh = Math.min(sh, source.height - sy)
        if (sw > 0 && sh > 0) c.drawImage(source, sx, sy, sw, sh, dx, dy, sw, sh)
      }
      blit(leftW + scrollX, topH + scrollY, w - leftW, h - topH, leftW, topH)   // instructions × cycles
      blit(0, topH + scrollY, leftW, h - topH, 0, topH)                        // first column
      blit(leftW + scrollX, 0, w - leftW, topH, leftW, 0)                     // cycles and resources
      blit(0, 0, leftW, topH, 0, 0)                                            // corner
      if (target === canvas) {         // the borders of the fixed parts
        c.strokeStyle = '#7a8aa3'
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(0, topH); c.lineTo(w, topH)
        c.moveTo(leftW, 0); c.lineTo(leftW, h)
        c.stroke()
      }
    }
    drawMinimap()
  }

  // screen point (in the visible canvas) -> point of the world
  function toWorld(sx, sy) {
    return { x: sx < view.leftW ? sx : sx + view.scrollX,
             y: sy < view.topH  ? sy : sy + view.scrollY }
  }

  // after a move with the arrows, the selected cell is kept in view; the wheel, the keys of the
  // page and the minimap move the cycles with the rows again
  let keepSelectionInView = false
  function scrollTo(row) {
    keepSelectionInView = false
    const next = Math.min(Math.max(0, Math.round(row)), maxScrollRow())
    if (next === scrollRow.value) return
    scrollRow.value = next
    present()
  }
  // the first row of the next / previous iteration
  function iterationStep(direction) {
    const rows = timeline.value?.instructions ?? []
    let r = scrollRow.value
    const iterOf = (i) => rows[i]?.[0]
    if (direction > 0) {
      const it = iterOf(r)
      while (r < totalInstr - 1 && iterOf(r) === it) r++
    } else {
      if (r > 0) r--
      const it = iterOf(r)
      while (r > 0 && iterOf(r - 1) === it) r--
    }
    scrollTo(r)
  }
  function onWheel(e) {
    e.preventDefault()
    if (e.deltaY !== 0) scrollTo(scrollRow.value + Math.sign(e.deltaY))
  }

  // ---- Minimap: the whole timeline (a line per instruction, from dispatch to retire), and the
  // visible window; a click (or a drag) moves the window there ----
  function drawMinimap() {
    const canvas = minimapCanvas.value
    if (!canvas || !timeline.value) return
    const h = view.h, w = MINIMAP_W - 6
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    canvas.style.left  = `${view.w + 2}px`
    canvas.style.right = 'auto'
    const c = canvas.getContext('2d')
    c.clearRect(0, 0, w, h)
    c.fillStyle = '#f6f8fb'
    c.fillRect(0, 0, w, h)
    const rows = (timeline.value.instructions ?? []).slice(0, totalInstr)
    if (!rows.length || !totalCycles) return
    const sy = h / rows.length, sx = w / totalCycles
    const lineH = Math.max(1, Math.min(4, sy - 0.5))
    for (const [i, [iter, , start, , states, , , flags]] of rows.entries()) {
      c.fillStyle = flags?.wrong ? '#bdbdbd' : `hsl(${(iter * 80) % 360}, 55%, 55%)`
      c.fillRect(start * sx, i * sy, Math.max(1, states.length * sx), lineH)
    }
    // the visible window
    c.strokeStyle = '#1a4fb3'
    c.lineWidth = 2
    const x0 = (view.scrollX / cellW) * sx
    const vw = ((view.w - view.leftW) / cellW) * sx
    c.strokeRect(Math.max(1, x0), scrollRow.value * sy + 1, Math.max(4, Math.min(w - 2, vw)), Math.max(4, visibleRowCount() * sy) - 2)
  }
  let minimapDrag = false
  function minimapJump(e) {
    const canvas = minimapCanvas.value
    if (!canvas || !totalInstr) return
    const y = e.clientY - canvas.getBoundingClientRect().top
    scrollTo((y / view.h) * totalInstr - visibleRowCount() / 2)
  }
  function onMinimapDown(e) { minimapDrag = true; minimapJump(e) }
  function onMinimapMove(e) { if (minimapDrag) minimapJump(e) }
  function onMinimapUp() { minimapDrag = false }

  function drawTimeline(newCycles, oldCycles) {

    // a drawing requested just before the panel was closed: there is nothing to draw on
    const wrapper = timelineCanvas.value?.parentElement
    if (!wrapper) return
    const viewportWidth = wrapper.clientWidth
    const viewportHeight = wrapper.clientHeight

    const { cycles, instructions, portUsageInstr, portUsageInstrByPort } = timeline.value
    const portByInstructionCycle = new Map()
    for (const [port, cycleRows] of Object.entries(portUsageInstrByPort ?? {})) {
      cycleRows.forEach((rows, cycle) => {
        for (const rowIndex of rows)
          portByInstructionCycle.set(`${rowIndex}:${cycle}`, Number(port))
      })
    }
    const waitDetails = new Map(
      (timeline.value.wait_details ?? []).map(detail => [
        `${detail.instruction_index}:${detail.cycle}`,
        detail
      ])
    )
    // The cycles shown (never more than the timeline has) and the instructions dispatched in them.
    // Always computed from this timeline: the previous one (other processor, cache…) may be longer
    totalCycles = newCycles != oldCycles && newCycles != 0 ? newCycles : timelineOptions.cycles
    totalCycles = Math.max(1, Math.min(totalCycles, cycles))
    totalInstr = 0
    while (totalInstr < instructions.length && instructions[totalInstr][2] < totalCycles) totalInstr++
    timelineOptions.instructions = totalInstr
    timelineOptions.cycles = totalCycles
    const cacheState = timeline.value.resource_usage?.cache_state
    const fillBufferState = timeline.value.resource_usage?.fill_buffers
    const writeBufferState = timeline.value.resource_usage?.write_buffers
    const storeBufferState = timeline.value.resource_usage?.store_buffer
    const storeBufferByCycle = Array.from({ length: totalCycles }, () => null)
    for (const snapshot of storeBufferState?.snapshots ?? [])
      if (snapshot.cycle >= 0 && snapshot.cycle < totalCycles) storeBufferByCycle[snapshot.cycle] = snapshot
    const memoryRequests = timeline.value.resource_usage?.mm_requests ?? []
    const bufferSlotsByCycle = bufferState => {
      const byCycle = Array.from({ length: totalCycles }, () => [])
      for (const snapshot of bufferState?.snapshots ?? []) {
        if (snapshot.cycle >= 0 && snapshot.cycle < totalCycles)
          byCycle[snapshot.cycle] = snapshot.slots
      }
      return byCycle
    }
    const fillBuffersByCycle = bufferSlotsByCycle(fillBufferState)
    const writeBuffersByCycle = bufferSlotsByCycle(writeBufferState)
    const cacheAddresses = (cacheState?.snapshots ?? [])
      .flatMap(snapshot => snapshot.lines)
      .filter(line => line.valid)
      .map(line => line.address)
    const bufferAddresses = [
      ...fillBuffersByCycle.flatMap(slots => slots),
      ...writeBuffersByCycle.flatMap(slots => slots)
    ].filter(slot => slot?.valid).map(slot => slot.address)
    const memoryAddressColors = createMemoryAddressColorMap([
      ...memoryRequests.map(request => request.address),
      ...cacheAddresses,
      ...bufferAddresses
    ])
    const cacheStatesByCycle = []
    let cacheSnapshotIndex = 0
    let cacheLines = []
    for (let cycle = 0; cycle < totalCycles; cycle++) {
      while (cacheSnapshotIndex < (cacheState?.snapshots?.length ?? 0) &&
             cacheState.snapshots[cacheSnapshotIndex].cycle <= cycle) {
        cacheLines = cacheState.snapshots[cacheSnapshotIndex].lines
        cacheSnapshotIndex++
      }
      cacheStatesByCycle[cycle] = cacheLines
    }

    const resourceRows = [
      ...(timelineOptions.showPorts
        ? timeline.value.resourcePortIds.map(port => ({
            label: `P${port}`,
            cycles: timeline.value.resource_usage?.ports?.[port] ?? [],
            port,
            requests: []
          }))
        : []),
      ...(timelineOptions.showCache && cacheEnabled.value &&
          Array.isArray(timeline.value.resource_usage?.mm)
        ? [{
            label: 'MM',
            cycles: timeline.value.resource_usage.mm,
            port: null,
            requests: timeline.value.resource_usage.mm_requests ?? []
          }]
        : []),
      ...(timelineOptions.showCache && cacheEnabled.value && cacheState
        ? Array.from({ length: cacheState.line_count }, (_, cacheLineIndex) => ({
            label: `C${cacheLineIndex}`,
            cacheLineIndex,
            cycles: [],
            requests: []
          }))
        : []),
      ...(timelineOptions.showCache && cacheEnabled.value && fillBufferState
        ? Array.from({ length: fillBufferState.capacity }, (_, bufferIndex) => ({
            label: `F${bufferIndex}`,
            bufferType: 'fill',
            bufferIndex,
            cycles: fillBuffersByCycle.map(slots => Boolean(slots[bufferIndex]?.valid)),
            bufferStates: fillBuffersByCycle
          }))
        : []),
      ...(timelineOptions.showCache && cacheEnabled.value && writeBufferState
        ? Array.from({ length: writeBufferState.capacity }, (_, bufferIndex) => ({
            label: `W${bufferIndex}`,
            bufferType: 'write',
            bufferIndex,
            cycles: writeBuffersByCycle.map(slots => Boolean(slots[bufferIndex]?.valid)),
            bufferStates: writeBuffersByCycle
          }))
        : []),
      ...(timelineOptions.showCache && cacheEnabled.value && storeBufferState
        ? [{
            label: 'SB',
            storeBuffer: true,
            capacity: storeBufferState.capacity,
            cycles: storeBufferByCycle.map(snap => Boolean(snap && (snap.stores + snap.retired.length) > 0)),
            snapshots: storeBufferByCycle,
          }]
        : [])
    ]
    // Groups of resource rows: a summary row (folded), or the summary and its rows (unfolded)
    const GROUPS = [
      { key: 'ports', option: 'expandPorts', name: t('Ports'), test: r => r.port !== undefined && r.port !== null },
      { key: 'cache', option: 'expandCache', name: t('Cache'), test: r => r.cacheLineIndex !== undefined },
      { key: 'fill',  option: 'expandFill',  name: 'Fill',     test: r => r.bufferType === 'fill' },
      { key: 'write', option: 'expandWrite', name: 'Write',    test: r => r.bufferType === 'write' },
    ]
    const detailedRows = resourceRows.splice(0)
    const memoryOpen = !!timelineOptions.expandMemory
    for (const r of detailedRows) {
      if (r.port === null && r.label === 'MM') {         // the memory: folded, only the use of the MM bus
        Object.assign(r, memoryOpen ? { foldLabel: '▾ MM', foldOption: 'expandMemory', noLetters: false }
                                    : { foldLabel: `▸ ${t('Memory')}`, foldOption: 'expandMemory', noLetters: true })
        resourceRows.push(r)
        continue
      }
      if (!memoryOpen && (r.cacheLineIndex !== undefined || r.bufferType || r.storeBuffer)) continue
      const g = GROUPS.find(group => group.test(r))
      if (!g) { resourceRows.push(r); continue }
      let summary = resourceRows.find(x => x.summary === g.key)
      if (!summary) {
        summary = { summary: g.key, option: g.option, name: g.name, members: [], cycles: [], counts: [] }
        resourceRows.push(summary)
      }
      summary.members.push(r)
      if (timelineOptions[g.option]) resourceRows.push(r)
    }
    for (const summary of resourceRows.filter(r => r.summary)) {
      summary.capacity = summary.members.length
      for (let col = 0; col < totalCycles; col++) {
        const n = summary.members.filter(m => m.cacheLineIndex !== undefined
          ? !!cacheStatesByCycle[col]?.[m.cacheLineIndex]?.loading      // blocks arriving
          : !!m.cycles[col]).length
        summary.counts.push(n)
        summary.cycles.push(n > 0)
      }
    }
    resourceRowCount = resourceRows.length
    resourceLayout   = resourceRows
    cacheLinesByCycle = cacheStatesByCycle


    const graph = timeline.value.critical_path_graph
    let visibleCriticalCycles = timeline.value.computedCriticalCycles
    if (graph) {
      const visibleRetiredIndex = findLastRetiredInstructionIndex(
        instructions.slice(0, totalInstr),
        totalCycles
      )
      if (visibleRetiredIndex === null) {
        visibleCriticalCycles = instructions.map(() => [])
        visibleCriticalPath = { graph, target: null, cycles: visibleCriticalCycles }
      } else {
        if (visibleCriticalPath?.graph !== graph || visibleCriticalPath.target !== visibleRetiredIndex) {
          visibleCriticalPath = {
            graph,
            target: visibleRetiredIndex,
            cycles: computeCriticalCycles(graph, instructions, visibleRetiredIndex)
          }
        }
        visibleCriticalCycles = visibleCriticalPath.cycles
      }
    }
    const criticalPercentages = timelineOptions.critical
      ? computeInstructionCriticalPercentages(
          instructions,
          visibleCriticalCycles,
          totalCycles,
          totalInstr,
          simState.simulatedProcess.instruction_list.length + (simState.simulatedProcess.epilogue?.length ?? 0)
        )
      : null
    simState.timelineCriticalPathPercentages = criticalPercentages
    simState.timelineCriticalPathEnabled = criticalPercentages !== null

    // sizes in pixels, scaled with the text of the page (the A−/A+ control of the header)
    const g = timelineGeometry(), k = g.k
    cellW = g.cellW
    labelW = g.labelW
    cellH = g.cellH
    padX  = 10
    padY  = 10
    fontSize   = g.font
    fontXOffset = Math.round(2 * k)
    fontYOffset = Math.round(3 * k)
    hoverInfo.value = null
    focusedCell = null
    if (oldCycles === 0) scrollRow.value = 0

    // The whole timeline is drawn on hidden canvases (the "world"); the visible canvases show a
    // window of it (see present)
    void viewportWidth; void viewportHeight
    const canvasWidth  = Math.ceil(padX*2 + labelW + totalCycles*cellW)
    const canvasHeight = Math.ceil(padY*2 + (totalInstr+resourceRowCount+1)*cellH)
    for (const canvas of [worldCanvas, worldOverlay]) {
      canvas.width  = canvasWidth
      canvas.height = canvasHeight
    }

    const ctxOverlay = worldOverlay.getContext('2d')
    ctxOverlay.setTransform(1,0,0,1,0,0)
    ctxOverlay.clearRect(0, 0, worldOverlay.width, worldOverlay.height)

    const ctx = worldCanvas.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0, 0, worldCanvas.width, worldCanvas.height)

    ctx.font                  = `${fontSize}px monospace`;
    ctx.textBaseline          = 'top';
    ctx.imageSmoothingEnabled = false;

    interactiveCells.length = 0   // empty list

    // Cycle header
    let   x = padX
    const y = padY
    const initRowList = []
    const lengthRowList = []

    // First cell is empty (top-left corner)
    ctx.fillStyle   = "#ffffff"
    ctx.strokeStyle = "#bbb"
    ctx.lineWidth   = 1
    ctx.fillRect    (x, y, labelW, cellH)
    ctx.strokeRect  (x, y, labelW, cellH)

    ctx.fillStyle = "#000"
    ctx.fillText    (' ', x + fontXOffset, y + fontYOffset)
    x += labelW

    for (let i = 0; i < totalCycles; ) {
      let ch          = String(i % 10)
      ctx.fillStyle   = "#ffffff"
      ctx.strokeStyle = "#bbb"
      ctx.lineWidth   = 1
      ctx.fillRect    (x, y, cellW, cellH)
      ctx.strokeRect  (x, y, cellW, cellH)

      ctx.fillStyle = "#000"
      ctx.fillText    (ch, x + fontXOffset, y + fontYOffset)

      // calculate column init and column length for this cycle i
      let initRow   = 0
      while (initRow < totalInstr && (instructions[initRow][2] + instructions[initRow][4].length <= i))
        initRow++
      // no instruction in flight (e.g. cycles in which only the memory works): an empty ROB
      let lengthRow = initRow < totalInstr ? 1 : 0
      let ROBused = lengthRow
      if (lengthRow && instructions[initRow][2] + instructions[initRow][4].length === i+1) {
        ROBused = 0
      }
      while (initRow+lengthRow < totalInstr && instructions[initRow+lengthRow][2] <= i) {
        if (instructions[initRow+lengthRow][2] + instructions[initRow+lengthRow][4].length > i+1) {
          ROBused++
        }
        lengthRow++
      }

      interactiveCells.push({
        x, y, colIdx: i, rowIdx: -1,   /* indicates 1st row of cycles */
        initCol: i,
        lengthCol: 1,
        initRow, lengthRow,
        cellType: 'cycle-header',
        tooltip: `ROB usage: ${ROBused}`
      })

      initRowList.push(initRow)
      lengthRowList.push(lengthRow)

      i++
      x += cellW
    }

    // The first column of the rows of the resources (and the corner): a summary of the whole row
    // (title and brief statistics, for the status line) and what the row shows (panel of details)
    const C = totalCycles
    const pctOf = (n, d = C) => `${(d > 0 ? 100 * n / d : 0).toFixed(1)}%`
    const countCycles = (f) => { let n = 0; for (let c = 0; c < C; c++) if (f(c)) n++; return n }
    const blocksIn = (address) => {          // blocks that enter: a valid address that changes
      let n = 0, prev = null
      for (let c = 0; c < C; c++) { const a = address(c); if (a !== null && a !== prev) n++; prev = a }
      return n
    }
    const GROUP_EXPLAIN = {
      ports: t('The execution ports, folded: the bar of each cycle shows how many ports start to execute an instruction. Its name shows or hides one row per port.'),
      cache: t('The lines of the cache, folded: the bar of each cycle shows how many lines are receiving a block from MM. Its name shows or hides one row per line.'),
      fill:  t('The fill buffers, folded: the bar of each cycle shows how many are busy. Its name shows or hides one row per buffer.'),
      write: t('The write buffers, folded: the bar of each cycle shows how many are busy. Its name shows or hides one row per buffer.'),
    }
    function rowSummary(resource) {
      if (resource.summary) {
        const busy = resource.counts.slice(0, C).reduce((a, b) => a + b, 0)
        const all  = countCycles(c => resource.capacity > 0 && (resource.counts[c] ?? 0) >= resource.capacity)
        return { title: resource.name, explain: GROUP_EXPLAIN[resource.summary],
                 stats: [t('{a} of {m} busy on average ({p})', { a: (C ? busy / C : 0).toFixed(1), m: resource.capacity, p: pctOf(busy, C * resource.capacity) }),
                         t('all busy in {p} of the cycles', { p: pctOf(all) })] }
      }
      if (resource.port === null) {          // the main memory: the use of its bus
        const active = (c, write) => resource.requests.some(r => (r.operation === 'write') === write && c >= r.cycle && c < r.cycle + r.duration)
        const n = (write) => resource.requests.filter(r => (r.operation === 'write') === write && r.cycle < C).length
        const folded = !timelineOptions.expandMemory
        return { title: folded ? t('Memory') : 'MM',
                 explain: (folded ? t('All the rows of the memory, folded: only the use of the bus, a colour per block. Its name shows the rows of the memory (MM, cache lines, buffers and store buffer).') + ' ' : '') +
                          t('MM: the bus between the processor and the main memory. R: a block read from MM (a fill, after a miss); W: a dirty block written into MM (an update, after it is evicted). Each transfer keeps the bus busy during the memory issue time.'),
                 stats: [t('bus busy {p}', { p: pctOf(countCycles(c => !!resource.cycles[c])) }),
                         t('reads (fills) {p}, {n} blocks', { p: pctOf(countCycles(c => active(c, false))), n: n(false) }),
                         t('writes (dirty blocks) {p}, {n} blocks', { p: pctOf(countCycles(c => active(c, true))), n: n(true) })] }
      }
      if (resource.port !== undefined) {     // an execution port
        const used = countCycles(c => !!resource.cycles[c])
        return { title: resource.label,
                 explain: t('Execution port {p}: X marks the cycles in which an instruction starts to execute in it.', { p: resource.label }),
                 stats: [t('used in {u} of {n} cycles ({p})', { u: used, n: C, p: pctOf(used) })] }
      }
      if (resource.cacheLineIndex !== undefined) {
        const line = (c) => cacheStatesByCycle[c]?.[resource.cacheLineIndex]
        return { title: t('Cache line {i}', { i: resource.cacheLineIndex }),
                 explain: t('A line of the cache. C: a clean block; D: a dirty block (written by a STORE); r / w: a block arriving from MM, for a LOAD / a STORE. Each block has the same colour in all the rows.'),
                 stats: [t('holds a block {p}', { p: pctOf(countCycles(c => !!line(c)?.valid)) }),
                         t('dirty {p}', { p: pctOf(countCycles(c => !!(line(c)?.valid && line(c)?.dirty))) }),
                         t('{n} blocks', { n: blocksIn(c => (line(c)?.valid ? line(c).address : null)) })] }
      }
      if (resource.bufferType) {
        const entry = (c) => resource.bufferStates[c]?.[resource.bufferIndex]
        const fill = resource.bufferType === 'fill'
        return { title: `${fill ? 'Fill buffer' : 'Write buffer'} ${resource.bufferIndex}`,
                 explain: fill
                   ? t('A fill buffer holds a missing block from its request to MM until every instruction waiting for it has received its data. The misses to the same block share it.')
                   : t('A write buffer holds an evicted dirty block until it is written into MM.'),
                 stats: [t('busy {p}', { p: pctOf(countCycles(c => !!entry(c)?.valid)) }),
                         t(fill ? '{n} fills' : '{n} dirty blocks written', { n: blocksIn(c => (entry(c)?.valid ? entry(c).address : null)) })] }
      }
      if (resource.storeBuffer) {
        const used = (c) => { const s = resource.snapshots[c]; return s ? s.stores + s.retired.length : 0 }
        let sum = 0, max = 0
        for (let c = 0; c < C; c++) { sum += used(c); max = Math.max(max, used(c)) }
        return { title: 'SB',
                 explain: t('The store buffer ({n} entries): each STORE takes an entry when it is dispatched and frees it when its data is written into the cache, after it retires (in program order). The bar shows how full it is; F: full, and the dispatch waits.', { n: resource.capacity }),
                 stats: [t('{a} of {m} entries on average', { a: (C ? sum / C : 0).toFixed(1), m: resource.capacity }),
                         t('at most {n}', { n: max }),
                         t('full {p}', { p: pctOf(countCycles(c => used(c) >= resource.capacity)) })] }
      }
      return { title: resource.label ?? '', explain: '', stats: [] }
    }
    const summaryCell = (s) => ({ title: s.title, explain: s.explain, stats: s.stats,
                                  tooltip: [s.title, ...s.stats].join(' · ') })

    // The corner: statistics of the whole timeline
    {
      let retired = 0, lastRetire = -1
      for (let r = 0; r < totalInstr; r++) {
        const k = String(instructions[r][4] ?? '').indexOf('R')
        if (k >= 0 && instructions[r][2] + k < C) { retired++; lastRetire = Math.max(lastRetire, instructions[r][2] + k) }
      }
      const stats = [t('{c} cycles', { c: C }), t('{n} instructions retired', { n: retired }),
                     t('IPC {ipc}', { ipc: lastRetire >= 0 ? (retired / (lastRetire + 1)).toFixed(2) : '0.00' })]
      if (criticalPercentages) {
        const top = criticalPercentages.map((p, i) => ({ p, i })).filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 3)
        if (top.length)
          stats.push(t('critical: {list}', { list: top.map(x => `${x.i} ${instrAt(x.i)?.text ?? ''} ${x.p.toFixed(1)}%`).join(', ') }))
      }
      interactiveCells.push({
        x: padX, y: padY, width: labelW, colIdx: -1, rowIdx: -1, cellType: 'corner',
        ...summaryCell({ title: t('Timeline'), stats,
          explain: t('The whole timeline: the simulation of the first instructions of the program (at most 200 retired). IPC: instructions retired per cycle, up to the last one retired. The critical path ends at the last instruction retired; the percentages are the fraction of its cycles attributed to each instruction of the program (as in the Program panel).') }),
      })
    }

    const SUMMARY_COLORS = { ports: '#f0a35e', cache: '#9fb4d6', fill: '#c9a0dc', write: '#e79a9a' }
    for (const [resourceRowIndex, resource] of resourceRows.entries()) {
      const resourceY = padY + (resourceRowIndex + 1) * cellH
      if (resource.summary) {          // folded group: how many are busy in each cycle
        ctx.fillStyle = '#e3eaf4'
        ctx.strokeStyle = '#bbb'
        ctx.lineWidth = 1
        ctx.fillRect(padX, resourceY, labelW, cellH)
        ctx.strokeRect(padX, resourceY, labelW, cellH)
        ctx.fillStyle = '#0b2e5c'
        ctx.fillText(`${timelineOptions[resource.option] ? '▾' : '▸'} ${resource.name}`, padX + fontXOffset, resourceY + fontYOffset)
        interactiveCells.push({
          x: padX, y: resourceY, width: labelW, colIdx: -1, rowIdx: -2,
          cellType: 'resource-summary-label', resourceIndex: resourceRowIndex, option: resource.option,
          ...summaryCell(rowSummary(resource)),
        })
        for (let col = 0; col < totalCycles; col++) {
          const cx = padX + labelW + col * cellW
          ctx.fillStyle = '#fff'
          ctx.strokeStyle = '#bbb'
          ctx.fillRect(cx, resourceY, cellW, cellH)
          ctx.strokeRect(cx, resourceY, cellW, cellH)
          const n = resource.counts[col] ?? 0
          if (n > 0) {
            const h = Math.max(2, Math.round((cellH - 2) * Math.min(1, n / Math.max(1, resource.capacity))))
            ctx.fillStyle = SUMMARY_COLORS[resource.summary]
            ctx.fillRect(cx + 1, resourceY + cellH - 1 - h, cellW - 2, h)
          }
          interactiveCells.push({
            x: cx, y: resourceY, colIdx: col, rowIdx: -2, cellType: 'resource-cycle', resourceIndex: resourceRowIndex,
            // the folded ports: the ports busy in this cycle
            ports: resource.summary === 'ports'
              ? [...new Set((portUsageInstr?.[col] ?? []).map(r => instructions[r]?.[3]).filter(p => p !== undefined && p !== null).map(String))]
              : [],
            linkedInstructionRows: resource.summary === 'ports' ? (portUsageInstr?.[col] ?? [])
              : resource.summary === 'fill' ? [...new Set(resource.members.flatMap(m => m.bufferStates[col]?.[m.bufferIndex]?.instruction_indices ?? []))]
              : [],
            linkedResourceRows: [],
            tooltip: t('{name}: {n} of {m} busy in cycle {c}', { name: resource.name, n, m: resource.capacity, c: col }),
          })
        }
        continue
      }
      ctx.fillStyle = '#f1f3f5'
      ctx.strokeStyle = '#bbb'
      ctx.lineWidth = 1
      ctx.fillRect(padX, resourceY, labelW, cellH)
      ctx.strokeRect(padX, resourceY, labelW, cellH)
      ctx.fillStyle = '#000'

      const displayedLabel = resource.foldLabel ?? (resource.port === null ? 'MM' : resource.label)
      ctx.fillText(displayedLabel, padX + fontXOffset, resourceY + fontYOffset)
      interactiveCells.push({
        x: padX, y: resourceY, width: labelW, colIdx: -1, rowIdx: -2,
        cellType: resource.foldOption ? 'resource-summary-label' : 'resource-label',
        option: resource.foldOption,
        resourceIndex: resourceRowIndex,
        ...summaryCell(rowSummary(resource)),
      })

      for (let cycle = 0; cycle < totalCycles; cycle++) {
        const resourceX = padX + labelW + cycle * cellW
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#bbb'
        ctx.fillRect(resourceX, resourceY, cellW, cellH)
        ctx.strokeRect(resourceX, resourceY, cellW, cellH)
        const memoryRequests = resource.port === null
          ? resource.requests.filter(request =>
              cycle >= request.cycle && cycle < request.cycle + request.duration
            )
          : []
        const cacheLine = resource.cacheLineIndex !== undefined
          ? cacheStatesByCycle[cycle]?.[resource.cacheLineIndex]
          : null
        const bufferEntry = resource.bufferType
          ? resource.bufferStates[cycle]?.[resource.bufferIndex]
          : null
        const addressesInCell = resource.port === null
          ? [...new Set(memoryRequests
              .map(request => request.address)
              .filter(Number.isSafeInteger))]
          : cacheLine?.valid
            ? [cacheLine.address]
            : bufferEntry?.valid
              ? [bufferEntry.address]
              : []
        if (addressesInCell.length === 1) {
          ctx.fillStyle = memoryAddressColors.get(addressesInCell[0]) ?? '#fff'
          ctx.fillRect(resourceX + 1, resourceY + 1, cellW - 2, cellH - 2)
        } else if (addressesInCell.length > 1) {
          const stripWidth = (cellW - 2) / addressesInCell.length
          addressesInCell.forEach((address, index) => {
            ctx.fillStyle = memoryAddressColors.get(address) ?? '#fff'
            ctx.fillRect(
              resourceX + 1 + index * stripWidth,
              resourceY + 1,
              stripWidth,
              cellH - 2
            )
          })
        }
        let marker = ''
        const sbSnap = resource.storeBuffer ? resource.snapshots[cycle] : null
        const sbUsed = sbSnap ? sbSnap.stores + sbSnap.retired.length : 0
        if (sbUsed > 0) {           // occupancy of the store buffer: a bar from the bottom of the cell
          const h = Math.max(2, Math.round((cellH - 2) * Math.min(1, sbUsed / resource.capacity)))
          ctx.fillStyle = sbUsed >= resource.capacity ? '#e57373' : '#90b4e0'
          ctx.fillRect(resourceX + 1, resourceY + cellH - 1 - h, cellW - 2, h)
        }
        if (resource.storeBuffer) {
          if (sbUsed >= resource.capacity) marker = 'F'
        } else if (resource.bufferType === 'fill' && bufferEntry?.valid) {
          marker = 'R'
        } else if (resource.bufferType === 'write' && bufferEntry?.valid) {
          marker = 'W'
        } else if (resource.cacheLineIndex !== undefined && cacheLine?.valid) {
          marker = cacheLine.loading
            ? cacheLine.dirty ? 'w' : 'r'
            : cacheLine.dirty ? 'D' : 'C'
        } else if (resource.cycles[cycle]) {
          const transactionTypes = new Set(memoryRequests.map(request =>
            request.operation === 'write' ? 'W' : 'R'
          ))
          marker = resource.port === null
            ? [...transactionTypes].sort().join('/')
            : 'X'
        }
        if (resource.noLetters) marker = ''         // the folded memory: only its colours
        if (marker) {
          ctx.fillStyle = '#000'
          ctx.fillText(marker, resourceX + fontXOffset, resourceY + fontYOffset)
        }

        const linkedInstructionRows = resource.cacheLineIndex !== undefined ||
              resource.bufferType === 'write' ||
              resource.port === null
            ? []
            : resource.bufferType === 'fill' && bufferEntry?.valid
              ? bufferEntry.instruction_indices
            : resource.cycles[cycle]
            ? portUsageInstrByPort
              ? portUsageInstrByPort[String(resource.port)]?.[cycle] ?? []
              : (portUsageInstr[cycle] ?? []).filter(rowIndex =>
                  Number(instructions[rowIndex]?.[3]) === Number(resource.port))
            : []
        const linkedResourceRows = resource.port === null
          ? resourceRows.flatMap((bufferResource, resourceIndex) => {
              if (!bufferResource.bufferType) return []
              const matchingOperation = bufferResource.bufferType === 'write'
                ? 'write'
                : 'read'
              const bufferEntry = bufferResource.bufferStates[cycle]?.[bufferResource.bufferIndex]
              return bufferEntry?.valid &&
                  memoryRequests.some(request =>
                    (request.operation === 'write' ? 'write' : 'read') === matchingOperation &&
                    request.address === bufferEntry.address
                  )
                ? [resourceIndex]
                : []
            })
          : []
        interactiveCells.push({
          x: resourceX,
          y: resourceY,
          colIdx: cycle,
          rowIdx: -2,
          cellType: 'resource-cycle',
          resourceIndex: resourceRowIndex,
          ports: resource.port !== undefined && resource.port !== null ? [String(resource.port)] : [],
          linkedInstructionRows,
          linkedResourceRows,
          tooltip: resource.storeBuffer
            ? t('Store buffer: {u} of {n} entries ({s} stores in the ROB, {r} retired waiting to be written into the cache)',
                { u: sbUsed, n: resource.capacity, s: sbSnap?.stores ?? 0, r: sbSnap?.retired.length ?? 0 })
            : resource.bufferType && !bufferEntry?.valid
            ? t(resource.bufferType === 'fill' ? 'Fill buffer {i}: empty' : 'Write buffer {i}: empty', { i: resource.bufferIndex })
            : resource.bufferType === 'fill'
              ? t('Fill block at addr {a}', { a: bufferEntry.address }) + ` (${bufferEntry.state}` +
                `${bufferEntry.ready_cycle == null ? '' : '; ' + t('ready at cycle {c}', { c: bufferEntry.ready_cycle })}` +
                `; ${t('waiting instructions {list}', { list: bufferEntry.instruction_indices.map(index => index + 1).join(', ') })})`
            : resource.bufferType === 'write'
              ? t('Write dirty block at addr {a}', { a: bufferEntry.address }) + ` (${bufferEntry.state}` +
                `${bufferEntry.ready_cycle == null ? '' : '; ' + t('available at cycle {c}', { c: bufferEntry.ready_cycle })})`
            : resource.cacheLineIndex !== undefined
            ? !cacheLine?.valid
              ? t('Cache line {i}: empty', { i: resource.cacheLineIndex })
              : t('Block at addr {a}', { a: cacheLine.address }) + ` (${cacheLine.dirty ? t('dirty') : t('clean')}; ` +
              `${cacheLine.loading
                ? cacheLine.ready_cycle == null
                  ? t('loading')
                  : t('loading, ready at cycle {c}', { c: cacheLine.ready_cycle })
                : t('ready')}; ` +
                `${t('LRU rank {r}', { r: cacheLine.lru })})`
            : resource.port !== null && resource.port !== undefined
            ? linkedInstructionRows.length
              ? t('P{p}: used by {list}', { p: resource.port,
                  list: linkedInstructionRows.map(row => `[${instructions[row]?.[0]},${instructions[row]?.[1]}]`).join(', ') })
              : t('P{p}: free', { p: resource.port })
            : !memoryRequests.length
            ? t('MM: no transfer')
            : memoryRequests
                .map(({ operation, address }) => {
                  if (operation === 'read_for_write')
                    return t('Read block for writing at addr {a}', { a: address })
                  if (operation === 'write')
                    return t('Write dirty block at addr {a}', { a: address })
                  return t('Read block at addr {a}', { a: address })
                })
                .join('\n')
        })
      }
    }

    // ************************************************************************************
    //   for each inst. & for each cycle, write cell into canvas and push interactive cells
    // ************************************************************************************
    for (const [rowIdx, [iter, instrIdx, startCycle, port, states, pythonCriticalCycles, addr, flags]] of instructions.entries())
    {
      if (rowIdx >= totalInstr) return

      // Compute background color based on iteration number (wrong-path instructions in grey)
      const wrongPath = !!flags?.wrong
      const rowBg = wrongPath ? "#e4e4e4" : iter >= 0 ? `hsl(${(iter * 80) % 360}, 50%, 90%)` : "#ffffff";
      const criticalCycles = visibleCriticalCycles?.[rowIdx] ?? pythonCriticalCycles
      // a memory access, from the type of the instruction (its execution is shown with E)
      const instr = instrAt(instrIdx)
      const memoryOperation = /MEM/.test(instr?.type ?? '')
        ? (instr.oper === 'STORE' ? 'Store to' : instr.oper === 'LOAD' ? 'Load from' : null)
        : null

      //  Draw line starting on (x,y)
      let   x = padX;
      const y = padY + (rowIdx + resourceRowCount + 1) * cellH;

      let initCol   = startCycle
      let lengthCol = states.length

      // First cell is instruction number
      ctx.fillStyle   = flags?.mispredicted ? "#ffb870" : rowBg;   // mispredicted branch: orange label
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth   = 1;
      ctx.fillRect    (x, y, labelW, cellH);
      ctx.strokeRect  (x, y, labelW, cellH);
      ctx.fillStyle = wrongPath ? "#777" : "#000"
      ctx.fillText    (labelText(instrIdx, instr?.text), x + fontXOffset, y + fontYOffset)

      interactiveCells.push({
        x, y,
        width: labelW,
        colIdx: -1,
        rowIdx,
        initCol: startCycle,
        lengthCol: states.length,
        instrIdx,
        iter,
        port,
        addr,
        latency: instr?.latency,
        instructionText: instr?.text,
        rep: flags?.rep,
        memoryOperation,
        wrongPath,
        mispredicted: !!flags?.mispredicted,
        critical: criticalCycles.length > 0,
        criticalCycles: criticalCycles.length
      })

      // a new call of the loop (repetitions): a line above its first row
      if (rowIdx > 0 && Number.isFinite(flags?.rep) && flags.rep !== instructions[rowIdx - 1]?.[7]?.rep) {
        ctx.save()
        ctx.strokeStyle = '#3b6fb6'
        ctx.lineWidth   = 3
        ctx.beginPath()
        ctx.moveTo(padX, y - 1.5)   // above the cells of this row, which are drawn next
        ctx.lineTo(padX + labelW + totalCycles * cellW, y - 1.5)
        ctx.stroke()
        ctx.restore()
      }

      x += labelW

      for (let i = 0; i < totalCycles; ) {
        let ch        = ' '
        let currColor = wrongPath ? "#777" : "#000"

        // register interactive cell & check critical
        if (i >= startCycle && i < startCycle+lengthCol) {
          ch  = states[i-startCycle];
          const previousState = states[i-startCycle-1]
          const first_exec_stage =
            ch === 'E' && previousState !== 'E'
          let critical = criticalCycles.includes(i - startCycle)
          if (critical && timelineOptions.critical) currColor = "red"

          interactiveCells.push({
            x, y,
            colIdx: i,
            rowIdx,
            initCol, lengthCol,
            initRow: initRowList[i],
            lengthRow: lengthRowList[i],
            char: ch,
            first_exec_stage,
            critical,
            port: portByInstructionCycle.get(`${rowIdx}:${i}`) ?? port,
            instrIdx,
            addr,
            memoryOperation,
            waitDetail: waitDetails.get(`${rowIdx}:${i}`)
          })
        }

        ctx.fillStyle   = rowBg;
        ctx.strokeStyle = "#bbb";
        ctx.lineWidth   = 1;
        ctx.fillRect    (x, y, cellW, cellH);
        ctx.strokeRect  (x, y, cellW, cellH);
        ctx.fillStyle = currColor;
        ctx.fillText    (ch === '.' ? '·' : ch, x + fontXOffset, y + fontYOffset);

        i++;
        x += cellW;
      }
    }
    drawSelectedCell()
  }

  function drawSelectedCell() {
    const cell = selectedCell.value
    if (!cell) return
    const ctx = worldOverlay.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.fillStyle = 'rgba(255, 165, 0, 0.35)'
    ctx.strokeStyle = '#e67e00'
    ctx.lineWidth = 2
    const width = cell.width ?? cellW
    ctx.fillRect(cell.x, cell.y, width, cellH)
    ctx.strokeRect(cell.x, cell.y, width, cellH)
    ctx.restore()
  }

  function drawHoverOverlay(
    row,
    col,
    initRow,
    lengthRow,
    initCol,
    lengthCol,
    linkedInstructionRows = null,
    linkedCycle = null,
    linkedResourceRows = null
  ) {
    const ctx = worldOverlay.getContext('2d')
    ctx.clearRect(0, 0, worldOverlay.width, worldOverlay.height)

    drawSelectedCell()

    ctx.strokeStyle = 'red'
    ctx.lineWidth   = 1

    // Highlight the corresponding instruction cells when hovering a resource row.
    if (linkedInstructionRows) {
      for (const linkedRow of linkedInstructionRows) {
        if (linkedRow < 0 || linkedRow >= totalInstr) continue
        const x = padX + labelW + linkedCycle * cellW
        const y = padY + (linkedRow + resourceRowCount + 1) * cellH
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'
        ctx.fillRect(x, y, cellW, cellH)
        ctx.strokeRect(x, y, cellW, cellH)
      }
    }
    if (linkedResourceRows) {
      for (const linkedRow of linkedResourceRows) {
        const x = padX + labelW + linkedCycle * cellW
        const y = padY + (linkedRow + 1) * cellH
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'
        ctx.fillRect(x, y, cellW, cellH)
        ctx.strokeRect(x, y, cellW, cellH)
      }
    }

    // highlight column (cycle): only when the header of a cycle is pointed
    if (col !== null) {
      let length = Math.min(lengthRow, totalInstr-initRow)
      ctx.strokeRect(
        padX + labelW + col*cellW,
        padY + (initRow+resourceRowCount+1)*cellH,
        cellW,
        length*cellH
      )
    }

    // highlight row (instruction)
    if (row !== null) {
      let length = Math.min(lengthCol, totalCycles-initCol)
      ctx.strokeRect(
        padX + labelW + initCol*cellW,
        padY + (row+resourceRowCount+1)*cellH,
        length*cellW,
        cellH
      )
    }
  }

  // ---- Hover and click (detailed mode) ----
  // Hover: highlights in the timeline, the Program panel and the Processor panel, and a status line.
  // Click: the cell is pinned (its highlights stay while the mouse moves) and explained in the
  // panel of details. A second click on it, a click outside the cells or Esc release it.
  const pinned  = ref(null)          // details of the pinned cell
  let resourceLayout    = []         // resource rows of the last drawing (ports, MM, cache lines, buffers, SB)
  let cacheLinesByCycle = []         // lines of the cache in each cycle
  let focusedCell = null
  const COLORS = {
    self:     ['rgba(255, 213, 79, 0.55)', '#c79100'],   // the instruction of the cell
    producer: ['rgba(21, 101, 192, 0.22)', '#1565c0'],   // instructions it waits for (data)
    port:     ['rgba(245, 124, 0, 0.25)', '#e65100'],    // ports, and the instructions that use them
    blocker:  ['rgba(97, 97, 97, 0.25)', '#424242'],     // older instruction that has not finished
    consumer: ['rgba(46, 125, 50, 0.22)', '#2e7d32'],    // instructions that receive its result
    memory:   ['rgba(123, 31, 162, 0.22)', '#7b1fa2'],   // memory: block, fill buffer, MM, store buffer
  }

  // ---- Memory instructions: the block, hit or miss, and the resources it uses ----
  function memoryInfo(row) {
    const header = interactiveCells.find(c => c.rowIdx === row && c.colIdx === -1)
    if (!header?.memoryOperation || !cacheEnabled.value || !(header.addr >= 0)) return null
    const blk  = Number(simState.simulatedProcess?.blkSize) || 64
    const block = Math.floor(header.addr / blk) * blk
    const reads = (timeline.value?.resource_usage?.mm_requests ?? []).filter(q => q.operation !== 'write' && q.address === block)
    let result = 'hit'
    if (reads.some(q => q.instruction_index === row)) result = 'primary'
    else if (reads.some(q => (q.instruction_indices ?? []).includes(row))) result = 'secondary'
    else if (resourceLayout.some(res => res.bufferType === 'fill' &&
             res.bufferStates.some(slots => (slots?.[res.bufferIndex]?.instruction_indices ?? []).includes(row) &&
                                            slots[res.bufferIndex].address === block))) result = 'secondary'
    return { store: header.memoryOperation === 'Store to', addr: header.addr, block, result }
  }
  const memoryText = (m) => (m.store ? 'STORE' : 'LOAD') + ' ' +
    t('addr {a}, block {b}', { a: m.addr, b: m.block }) + ': ' +
    (m.result === 'hit' ? t('hit') : m.result === 'primary' ? t('primary miss (it requests the block)') : t('secondary miss (the block is already coming)'))
  // the resources of a memory instruction: the main memory transfers of its block, its fill
  // buffer, the line of the cache while it is in flight, and (a STORE) the store buffer
  function markMemory(ctx, row) {
    const m = memoryInfo(row)
    if (!m) return null
    const cells = rowCells(row)
    if (!cells.length) return m
    const first = Math.min(...cells.map(c => c.colIdx)), last = Math.max(...cells.map(c => c.colIdx))
    // a STORE uses its block until it is written from the store buffer
    const sbRow = m.store ? resourceLayout.find(res => res.storeBuffer) : null
    const sbLast = sbRow ? Math.max(last, ...sbRow.snapshots.map((snap, col) => (snap?.retired?.includes(row) ? col : -1))) : last
    const requests = (timeline.value?.resource_usage?.mm_requests ?? []).filter(q => q.address === m.block &&
      (q.operation === 'write' ? false : (q.instruction_indices ?? []).includes(row) || q.instruction_index === row))
    const busy = (res, col) => {
      if (res.cacheLineIndex !== undefined) {
        const line = cacheLinesByCycle[col]?.[res.cacheLineIndex]
        return col >= first && col <= sbLast && !!line?.valid && line.address === m.block
      }
      if (res.bufferType === 'fill') {
        const slot = res.bufferStates[col]?.[res.bufferIndex]
        return !!slot?.valid && slot.address === m.block && (slot.instruction_indices ?? []).includes(row)
      }
      return false
    }
    for (const [ri, res] of resourceLayout.entries()) {
      const y = padY + (ri + 1) * cellH
      for (let col = 0; col < totalCycles; col++) {
        let on = false
        if (res.summary === 'cache' || res.summary === 'fill')
          on = res.members.some(member => busy(member, col))
        else if (res.port === null && res.label === 'MM')
          on = requests.some(q => col >= q.cycle && col < q.cycle + q.duration)
        else if (res.cacheLineIndex !== undefined) {
          const line = cacheLinesByCycle[col]?.[res.cacheLineIndex]
          on = col >= first && col <= sbLast && !!line?.valid && line.address === m.block
        } else if (res.bufferType === 'fill') {
          const slot = res.bufferStates[col]?.[res.bufferIndex]
          on = !!slot?.valid && slot.address === m.block && (slot.instruction_indices ?? []).includes(row)
        } else if (res.storeBuffer && m.store) {
          const snap = res.snapshots[col]
          on = (col >= first && col <= last) || !!snap?.retired?.includes(row)
        }
        if (on) markRect(ctx, padX + labelW + col * cellW, y, cellW, 'memory')
      }
    }
    return m
  }

  // ---- Data dependences between rows (RVCAT: producers of each row) ----
  const producersOf = (row) => timeline.value?.producers?.[row] ?? []
  const consumersByRow = computed(() => {
    const map = new Map()
    for (const [row, list] of (timeline.value?.producers ?? []).entries())
      for (const p of list) map.set(p, [...(map.get(p) ?? []), row])
    return map
  })
  const consumersOf = (row) => consumersByRow.value.get(row) ?? []
  const rowCells = (row) => interactiveCells.filter(c => !c.cellType && c.rowIdx === row && c.colIdx >= 0)
  // the first cycle of execution of a row, and the cycle in which its result is ready (the cell
  // before W: the last cycle of execution, or the arrival of a block)
  const firstExec = (row) => rowCells(row).find(c => c.char === 'E') ?? null
  function resultCell(row) {
    const cells = rowCells(row).sort((a, b) => a.colIdx - b.colIdx)
    const w = cells.findIndex(c => c.char === 'W')
    return w > 0 ? cells[w - 1] : null
  }
  // an arrow from the result of a producer to the first execution of a consumer
  function drawArrow(ctx, from, to, kind) {
    if (!from || !to) return
    const color = COLORS[kind][1]
    const x1 = from.x + cellW, y1 = from.y + cellH / 2
    const x2 = to.x, y2 = to.y + cellH / 2
    const bend = Math.max(12, Math.abs(x2 - x1) / 2)
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - 7, y2 - 4)
    ctx.lineTo(x2 - 7, y2 + 4)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  // the instructions whose results a row reads: their result cells, their first column, the
  // variables, and arrows to its first execution
  function markProducers(ctx, row) {
    const target = firstExec(row)
    const names = []
    for (const p of producersOf(row)) {
      const out = resultCell(p)
      if (out) markRect(ctx, out.x, out.y, cellW, 'producer')
      markRowLabel(ctx, p, 'producer')
      const own = instrAt(interactiveCells.find(c => c.rowIdx === p && c.colIdx === -1)?.instrIdx)?.destin
      if (own) { markLabelVariables(ctx, p, [own], 'producer'); names.push(own) }
      drawArrow(ctx, out, target, 'producer')
    }
    markLabelVariables(ctx, row, names, 'producer')
    return names
  }
  // the instructions that receive the result of a row
  function markConsumers(ctx, row) {
    const out = resultCell(row)
    for (const c of consumersOf(row)) {
      const target = firstExec(c)
      if (target) markRect(ctx, target.x, target.y, cellW, 'consumer')
      markRowLabel(ctx, c, 'consumer')
      drawArrow(ctx, out, target, 'consumer')
    }
    const own = instrAt(interactiveCells.find(c => c.rowIdx === row && c.colIdx === -1)?.instrIdx)?.destin
    if (own) {
      markLabelVariables(ctx, row, [own], 'consumer')
      for (const c of consumersOf(row)) markLabelVariables(ctx, c, [own], 'consumer')
    }
  }
  // the instruction numbers (static) of some rows
  const instrIdxOfRows = (rows) => [...new Set(rows.map(r => interactiveCells.find(c => c.rowIdx === r && c.colIdx === -1)?.instrIdx)
                                                   .filter(i => i !== undefined))]

  function cellAtEvent(e) {
    const rect = timelineCanvas.value.getBoundingClientRect()
    if (e.clientX - rect.left > view.w) return null             // the minimap
    const { x: worldX, y: worldY } = toWorld(e.clientX - rect.left, e.clientY - rect.top)
    return interactiveCells.find(cell =>
      worldX >= cell.x && worldX <= cell.x + (cell.width ?? cellW) &&
      worldY >= cell.y && worldY <= cell.y + cellH) ?? null
  }

  function onMouseMove(e) {
    if (pinned.value) return
    const cell = cellAtEvent(e)
    if (cell === focusedCell) return
    focusedCell = cell
    if (cell) focusCell(cell)
    else clearFocus()
  }
  function onMouseLeave() {
    if (pinned.value) return
    focusedCell = null
    clearFocus()
  }

  function resetSharedHighlights() {
    simState.instrHighlightedIdx = -1
    simState.dependenceHighlight = null
    simState.highlightedPort     = -1
    simState.highlightedPorts    = []
    simState.highlightedStage    = null
    simState.programViewOverride = null
    simState.programHighlight    = null
  }
  function clearFocus() {
    hoverInfo.value = null
    resetSharedHighlights()
    drawHoverOverlay(null, null, null, null, null, null)
    present()
  }

  // the cell of an instruction row (row, cycle), and the header cell of a row
  const instrCell = (row, col) => interactiveCells.find(c => !c.cellType && c.rowIdx === row && c.colIdx === col)
  // ports that an instruction can use (mask of the instruction)
  const portsOf = (instrIdx) => {
    const mask = Number(instrAt(instrIdx)?.ports) || 0
    return [...Array(32).keys()].filter(p => (mask >> p) & 1)
  }

  function overlayContext() {
    const ctx = worldOverlay.getContext('2d')
    if (ctx) {
      ctx.font = `${fontSize}px monospace`
      ctx.textBaseline = 'top'           // as the texts of the timeline
    }
    return ctx
  }
  function markRect(ctx, x, y, w, kind) {
    const [fill, stroke] = COLORS[kind]
    ctx.save()
    ctx.fillStyle = fill
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.fillRect(x, y, w, cellH)
    ctx.strokeRect(x + 1, y + 1, w - 2, cellH - 2)
    ctx.restore()
  }
  // the first column (label) of an instruction row
  function markRowLabel(ctx, row, kind) {
    if (row < 0 || row >= totalInstr) return
    markRect(ctx, padX, padY + (row + resourceRowCount + 1) * cellH, labelW, kind)
  }
  // a cell of an instruction row
  function markCell(ctx, row, col, kind) {
    if (row < 0 || row >= totalInstr || col < 0 || col >= totalCycles) return
    markRect(ctx, padX + labelW + col * cellW, padY + (row + resourceRowCount + 1) * cellH, cellW, kind)
  }
  // the row of a port (Ports shown) in a cycle
  function markPortRow(ctx, port, col, kind) {
    if (!timelineOptions.showPorts) return
    let pr = resourceLayout.findIndex(r => r.port !== undefined && r.port !== null && String(r.port) === String(port))
    if (pr < 0) pr = resourceLayout.findIndex(r => r.summary === 'ports')
    if (pr < 0 || col < 0 || col >= totalCycles) return
    markRect(ctx, padX + labelW + col * cellW, padY + (pr + 1) * cellH, cellW, kind)
  }
  // variables inside the text of a row (option Text): underlined
  function markLabelVariables(ctx, row, names, kind) {
    const header = interactiveCells.find(c => c.rowIdx === row && c.colIdx === -1)
    if (!header || !names?.length || !timelineOptions.showText) return
    const text = labelText(header.instrIdx, header.instructionText)
    const re = new RegExp(`\\b(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g')
    ctx.save()
    ctx.fillStyle = COLORS[kind][1]
    for (const m of text.matchAll(re)) {
      if (m.index < 2) continue               // the number of the instruction
      const x = padX + fontXOffset + ctx.measureText(text.slice(0, m.index)).width
      const w = ctx.measureText(m[0]).width
      ctx.fillRect(x, header.y + cellH - 4, w, 2.5)
    }
    ctx.restore()
  }
  // the number of the cycle, complete, over the header of its column
  function markCycle(ctx, col) {
    if (col < 0 || col >= totalCycles) return
    const label = String(col)
    ctx.save()
    ctx.font = `bold ${fontSize}px monospace`
    const w = Math.max(cellW, ctx.measureText(label).width + 8)
    const x = padX + labelW + col * cellW + cellW / 2 - w / 2
    ctx.fillStyle = '#fff3c4'
    ctx.strokeStyle = '#c79100'
    ctx.lineWidth = 1.5
    ctx.fillRect(x, padY, w, cellH)
    ctx.strokeRect(x, padY, w, cellH)
    ctx.fillStyle = '#000'
    ctx.fillText(label, x + 4, padY + fontYOffset)
    ctx.restore()
  }

  // The older instruction that a finished instruction ('-') waits for to retire: the oldest
  // older one that has not finished in this cycle (none: they all have finished, and the retire
  // width limits how many leave per cycle)
  function retireBlocker(cell) {
    const older = interactiveCells.filter(c => !c.cellType && c.colIdx === cell.colIdx && c.rowIdx < cell.rowIdx &&
                                               !['-', 'R', 'x', ' '].includes(c.char))
    return older.length ? older.reduce((a, b) => (a.rowIdx < b.rowIdx ? a : b)) : null
  }

  // Everything that a cell shows: highlights and texts (status line, details)
  function focusCell(cell) {
    focusCellOn(cell)
    present()
  }
  function focusCellOn(cell) {
    resetSharedHighlights()
    const col = cell.colIdx, row = cell.rowIdx
    if (['resource-label', 'resource-summary-label', 'corner'].includes(cell.cellType)) {
      hoverInfo.value = { state: cell.tooltip }
      if (cell.cellType !== 'corner') {
        const ports = resourceLayout[cell.resourceIndex]?.summary === 'ports'
          ? (timeline.value?.resourcePortIds ?? []).map(String)
          : [resourceLayout[cell.resourceIndex]?.port].filter(p => p !== undefined && p !== null).map(String)
        if (ports.length) simState.highlightedPorts = ports        // its port(s) in the Processor panel
      }
      drawHoverOverlay(null, null, null, null, null, null)
      return
    }
    if (cell.cellType === 'resource-cycle') {
      hoverInfo.value = cell.tooltip ? { state: cell.tooltip, cycle: col } : null
      if (cell.ports?.length) simState.highlightedPorts = cell.ports      // its port(s) in the Processor panel
      drawHoverOverlay(null, null, null, null, null, null, cell.linkedInstructionRows, col, cell.linkedResourceRows)
      const ctx = overlayContext()
      if (ctx) markCycle(ctx, col)
      return
    }
    if (row === -1) {                      // the header: a cycle, and the instructions in it
      hoverInfo.value = { state: cell.tooltip, cycle: col }
      drawHoverOverlay(null, col, cell.initRow, cell.lengthRow, cell.initCol, cell.lengthCol)
      const ctx = overlayContext()
      if (ctx) markCycle(ctx, col)
      return
    }

    const rowHeader = col === -1
    simState.instrHighlightedIdx = cell.instrIdx
    if (cell.char === 'E') simState.highlightedPort = cell.port
    hoverInfo.value = {
      cell,
      cycle: rowHeader ? null : col,
      state: rowHeader ? instructionTooltipLines(cell).map(line => line.map(part => part.text).join('')).join(' · ') : cellStatus(cell),
    }
    drawHoverOverlay(row, null, rowHeader ? row : cell.initRow, rowHeader ? 1 : cell.lengthRow, cell.initCol, cell.lengthCol)
    showDataDependences(rowHeader ? null : cell)      // '.' and '*': producers / port conflict
    const ctx = overlayContext()
    if (!ctx) return
    markRowLabel(ctx, row, 'self')
    if (rowHeader) {                       // the instruction: where its data come from, and where its result goes
      markMemory(ctx, row)
      const names = markProducers(ctx, row)
      markConsumers(ctx, row)
      const first = firstExec(row)
      if (first) markPortRow(ctx, first.port, first.colIdx, 'port')
      simState.dependenceHighlight = { producers: instrIdxOfRows(producersOf(row)), vars: names,
                                       consumers: instrIdxOfRows(consumersOf(row)) }
      return
    }
    markCycle(ctx, col)

    const detail = cell.waitDetail
    if ((cell.char === 'E' && execCycleOf(cell) === 1) || ['!', '2', ':', '@', 'W'].includes(cell.char)) markMemory(ctx, row)
    if ((cell.char === '.' && detail?.reason === 'data') || (cell.char === '*' && detail?.reason === 'ports')) {
      // the instructions it waits for, the variables, and the ports it needs
      const dep = simState.dependenceHighlight
      if (cell.char === '.') {
        for (const r of new Set(detail.dependencies ?? [])) {
          markRowLabel(ctx, r, 'producer')
          const own = instrAt(interactiveCells.find(c => c.rowIdx === r && c.colIdx === -1)?.instrIdx)?.destin
          if (own) markLabelVariables(ctx, r, [own], 'producer')
        }
        markLabelVariables(ctx, row, dep?.vars ?? [], 'producer')
      } else {
        for (const { row: r } of portConflict(cell).conflicts) markRowLabel(ctx, r, 'port')
      }
      const ports = cell.char === '*' ? (detail.ports ?? []) : portsOf(cell.instrIdx)
      for (const p of ports) markPortRow(ctx, p, col, 'port')
      simState.highlightedPorts    = ports.map(String)
      simState.programViewOverride = 'perf'
      simState.programHighlight    = { rows: [cell.instrIdx], field: 'ports' }
    } else if (cell.char === 'E' && execCycleOf(cell) === 1) {
      // starts to execute: its port, the instructions that have just given it its operands, and
      // its latency and ports in the Program panel
      markPortRow(ctx, cell.port, col, 'port')
      for (const c of rowCells(row)) if (c.char === 'E') markRect(ctx, c.x, c.y, cellW, 'self')
      const names = markProducers(ctx, row)
      simState.dependenceHighlight = { producers: instrIdxOfRows(producersOf(row)), vars: names }
      simState.programViewOverride = 'perf'
      simState.programHighlight    = { rows: [cell.instrIdx], field: ['latency', 'ports'] }
    } else if (cell.char === 'E') {
      // executing: its latency in the Program panel
      for (const c of rowCells(row)) if (c.char === 'E') markRect(ctx, c.x, c.y, cellW, 'self')
      simState.programViewOverride = 'perf'
      simState.programHighlight    = { rows: [cell.instrIdx], field: 'latency' }
    } else if (cell.char === 'W') {
      // its result: the instructions that receive it
      markConsumers(ctx, row)
      simState.dependenceHighlight = { producers: [], vars: [], consumers: instrIdxOfRows(consumersOf(row)) }
    } else if (cell.char === 'D') {
      simState.highlightedStage = 'dispatch'
    } else if (cell.char === 'R') {
      simState.highlightedStage = 'retire'
    } else if (cell.char === '-') {
      const blocker = retireBlocker(cell)
      if (blocker) {
        markRowLabel(ctx, blocker.rowIdx, 'blocker')
        markCell(ctx, blocker.rowIdx, col, 'blocker')
      }
      simState.highlightedStage = 'retire'
    }
  }

  // ---- Texts: a line for the status bar, and the explanation of the panel of details ----
  const rowName = (row) => {
    const h = interactiveCells.find(c => c.rowIdx === row && c.colIdx === -1)
    return h ? `[${h.iter},${h.instrIdx}] ${h.instructionText ?? ''}`.trim() : `#${row}`
  }
  function execCycleOf(cell) {
    let k = 1
    for (let c = cell.colIdx - 1; instrCell(cell.rowIdx, c)?.char === 'E'; c--) k++
    return k
  }
  function cellStatus(cell) {
    const p = simState.simulatedProcess ?? {}
    switch (cell.char) {
      case 'D': return t('Dispatch (up to {n} per cycle)', { n: p.dispatch })
      case 'R': return t('Retire (up to {n} per cycle)', { n: p.retire })
      case 'W': return t('Writes its result')
      case 'E': {
        const lat = Number(instrAt(cell.instrIdx)?.latency) || null
        const k = execCycleOf(cell)
        const mem = k === 1 ? memoryInfo(cell.rowIdx) : null
        return k === 1
          ? t('Starts executing in P{p}', { p: cell.port }) + (lat ? ` · ${t('latency {l}', { l: lat })}` : '') +
            (mem ? ` · ${memoryText(mem)}` : '')
          : t('Executes: cycle {k} of {l}', { k, l: lat ?? '?' })
      }
      case '-': {
        const b = retireBlocker(cell)
        return b ? t('Waits to retire: {who} has not finished', { who: rowName(b.rowIdx) })
                 : t('Waits to retire: the older instructions retire first (retire width {n})', { n: p.retire })
      }
      default: return formatProcessingTooltip(cell)
    }
  }
  function cellExplanation(cell) {
    const p = simState.simulatedProcess ?? {}
    const d = cell.waitDetail
    switch (cell.char) {
      case 'D': return t('Dispatch: the instruction enters the ROB and the waiting buffer, in program order (up to {n} per cycle).', { n: p.dispatch })
      case 'E': return execCycleOf(cell) === 1
        ? t('It starts to execute in port P{p}: its operands are ready and the port is free. It takes {l} cycle(s) (latency).', { p: cell.port, l: instrAt(cell.instrIdx)?.latency ?? '?' })
        : t('It is executing: cycle {k} of {l} of its latency.', { k: execCycleOf(cell), l: instrAt(cell.instrIdx)?.latency ?? '?' })
      case 'W': return t('It writes its result into the ROB. The instructions that wait for it receive it by the bypass, and can execute in the next cycle.')
      case 'R': return t('Retire: the instruction leaves the ROB, in program order, and its result updates the registers (up to {n} per cycle).', { n: p.retire })
      case '-': return t('It has finished, but it waits to retire: the instructions retire in program order, so it waits for the older ones.')
      case '.': return t('It waits for the data of an older instruction (in blue). It can start to execute in the cycle after the last cycle of that instruction (bypass).')
      case '*': return d?.reason === 'issue-bandwidth'
        ? t('Its operands are ready, but the issue width is full in this cycle.')
        : t('Its operands are ready, but every port that can execute it is busy in this cycle: the older instructions have priority (in orange, the ones that use them).')
      default: return formatProcessingTooltip(cell)
    }
  }
  function buildDetails(cell) {
    if (cell.explain !== undefined) {        // the first column of the resources, and the corner
      return { title: cell.title, cycle: null, state: '', text: cell.explain,
               lines: (cell.stats ?? []).map(s => [{ text: s, kind: 'perf' }]), info: [] }
    }
    if (cell.cellType || cell.rowIdx === -1) {
      return { title: hoverInfo.value?.state ?? '', cycle: null, text: '', lines: [], info: [] }
    }
    const header = interactiveCells.find(c => c.rowIdx === cell.rowIdx && c.colIdx === -1) ?? cell
    const lines = []
    const d = cell.waitDetail
    if (cell.char === '.' && d?.reason === 'data')
      for (const r of new Set(d.dependencies ?? []))
        lines.push([{ text: t('waits for') + ' ', kind: 'perf', chip: 'producer' }, { text: rowName(r), kind: 'instr' }])
    const conflict = portConflictLines(cell)
    if (conflict) lines.push(...conflict)
    if ((cell.char === 'E' && execCycleOf(cell) === 1) || cell.colIdx < 0)
      for (const r of producersOf(cell.rowIdx))
        lines.push([{ text: t('receives data from') + ' ', kind: 'perf', chip: 'producer' }, { text: rowName(r), kind: 'instr' }])
    if (cell.char === 'W' || cell.colIdx < 0)
      for (const r of consumersOf(cell.rowIdx))
        lines.push([{ text: t('its result goes to') + ' ', kind: 'perf', chip: 'consumer' }, { text: rowName(r), kind: 'instr' }])
    if (cell.char === '-') {
      const b = retireBlocker(cell)
      lines.push(b ? [{ text: t('blocked by') + ' ', kind: 'perf', chip: 'blocker' }, { text: rowName(b.rowIdx), kind: 'instr' }]
                   : [{ text: t('retire width: {n} per cycle', { n: simState.simulatedProcess?.retire }), kind: 'perf' }])
    }
    const mem = memoryInfo(cell.rowIdx)
    if (mem) lines.push([{ text: memoryText(mem), kind: 'mem', chip: 'memory' }])
    if (cell.critical && timelineOptions.critical) lines.push([{ text: t('On the critical path'), kind: 'note' }])
    return {
      title: rowName(cell.rowIdx),
      cycle: cell.colIdx >= 0 ? cell.colIdx : null,
      state: cell.colIdx >= 0 ? cellStatus(cell) : '',
      text: cell.colIdx >= 0 ? cellExplanation(cell) : '',
      lines,
      info: instructionTooltipLines(header),
    }
  }

  // status line: what the pointer (or the pinned cell) shows
  const statusText = computed(() => {
    const h = hoverInfo.value
    if (!h) return ''
    const parts = []
    if (h.cycle !== null && h.cycle !== undefined) parts.push(t('Cycle {c}', { c: h.cycle }))
    if (h.cell && h.cell.colIdx >= 0) parts.push(rowName(h.cell.rowIdx))
    if (h.state) parts.push(h.state)
    return parts.join(' · ')
  })

  function pinCell(cell) {
    selectedCell.value = cell
    focusedCell = cell
    focusCell(cell)
    pinned.value = { cell, ...buildDetails(cell) }
    drawSelectedCell()
  }
  function releasePin() {
    pinned.value = null
    selectedCell.value = null
    focusedCell = null
    clearFocus()
  }
  // after the timeline is drawn again (other options, zoom): the pinned cell is found again
  function refocusPinned() {
    const old = pinned.value?.cell
    if (!old) return
    const cell = interactiveCells.find(c => c.rowIdx === old.rowIdx && c.colIdx === old.colIdx &&
                                            c.cellType === old.cellType && (c.resourceIndex ?? null) === (old.resourceIndex ?? null))
    if (cell) pinCell(cell)
    else releasePin()
  }
  // The panel of details is open until the user folds it (the pinned cell stays pinned); then it
  // stays folded, also in later sessions, until the user opens it again (»)
  function foldDetails() {
    detailsOpen.value = false
  }
  // A cell of the rows of the resources: the arrows move inside these rows (the border with the
  // rows of the instructions is not crossed). ← from the first cycle: its label (if it is not a
  // folded group); → from the label: the first cycle
  // The row of the cycles (ri = -1) belongs to this zone: ↓ from it goes to the resources, and ↑
  // from the first row of the resources goes to it
  function moveResourceSelection(cur, key) {
    const find = (ri, col) => ri < 0
      ? interactiveCells.find(c => c.cellType === (col < 0 ? 'corner' : 'cycle-header') && c.colIdx === col)
      : interactiveCells.find(c => c.rowIdx === -2 && c.resourceIndex === ri &&
          (col < 0 ? ['resource-label', 'resource-summary-label'].includes(c.cellType) : c.cellType === 'resource-cycle' && c.colIdx === col))
    const lastCol = totalCycles - 1
    let ri = ['cycle-header', 'corner'].includes(cur.cellType) ? -1 : cur.resourceIndex, col = cur.colIdx
    if (key === 'ArrowLeft') col = col > 0 ? col - 1 : (find(ri, -1) ? -1 : col)
    else if (key === 'ArrowRight') col = Math.min(lastCol, col + 1)
    else {
      ri += key === 'ArrowDown' ? 1 : -1
      if (ri < -1 || ri >= resourceRowCount) return true
    }
    const next = find(ri, col)
    if (next && next !== cur) { keepSelectionInView = true; pinCell(next); present() }
    return true
  }
  // The arrows move the pinned instruction or cell: ← → the previous / next cell of its row (from
  // the instruction: → its first cell, ← its last one; ← from the first cell: the instruction);
  // ↑ ↓ the row above / below (the same cycle, or the nearest cell of that row). The timeline
  // moves to show it. Without anything pinned (or a cycle or a resource pinned): false
  function moveSelection(key) {
    const cur = pinned.value?.cell
    if (cur && ['resource-cycle', 'resource-label', 'resource-summary-label', 'cycle-header', 'corner'].includes(cur.cellType)) return moveResourceSelection(cur, key)
    if (!cur || cur.cellType || cur.rowIdx < 0) return false
    const header = (r) => interactiveCells.find(c => !c.cellType && c.rowIdx === r && c.colIdx === -1)
    const cellsOf = (r) => rowCells(r).filter(c => c.char && c.char !== ' ').sort((a, b) => a.colIdx - b.colIdx)
    let next = null
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const cells = cellsOf(cur.rowIdx)
      if (!cells.length) return true
      if (cur.colIdx < 0) next = key === 'ArrowRight' ? cells[0] : cells[cells.length - 1]
      else {
        const i = cells.findIndex(c => c.colIdx === cur.colIdx)
        // → from the last cell (R) and ← from the first one: the instruction (its first column)
        next = key === 'ArrowRight' ? (cells[i + 1] ?? header(cur.rowIdx)) : (i > 0 ? cells[i - 1] : header(cur.rowIdx))
      }
    } else {
      const r = cur.rowIdx + (key === 'ArrowDown' ? 1 : -1)
      if (r < 0 || r >= totalInstr) return true
      if (cur.colIdx < 0) next = header(r)
      else {
        const cells = cellsOf(r)
        next = cells.find(c => c.colIdx === cur.colIdx) ??
               cells.reduce((a, b) => (!a || Math.abs(b.colIdx - cur.colIdx) < Math.abs(a.colIdx - cur.colIdx) ? b : a), null)
      }
    }
    if (!next) return true
    // the row in the window (the cycles follow the rows; present() keeps the cell in view)
    const visible = Math.max(1, visibleRowCount() - 1)
    if (next.rowIdx < scrollRow.value) scrollRow.value = next.rowIdx
    else if (next.rowIdx >= scrollRow.value + visible) scrollRow.value = Math.min(maxScrollRow(), next.rowIdx - visible + 1)
    keepSelectionInView = true
    pinCell(next)
    present()
    return true
  }
  function onKeyDown(e) {
    if (e.key === 'Escape' && pinned.value) return releasePin()
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
    if (!timeline.value || !timelineCanvas.value?.offsetParent) return
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && moveSelection(e.key)) {
      e.preventDefault()
      return
    }
    const moves = { ArrowDown: () => scrollTo(scrollRow.value + 1), ArrowUp: () => scrollTo(scrollRow.value - 1),
                    PageDown: () => iterationStep(1), PageUp: () => iterationStep(-1),
                    Home: () => scrollTo(0), End: () => scrollTo(maxScrollRow()) }
    if (moves[e.key]) { e.preventDefault(); moves[e.key]() }
  }

  // A cell where an instruction waits for data ('.'): the last execution cycle (E/L) of the
  // instructions it waits for is marked in the timeline (it executes in the next cycle, thanks to
  // the bypass), and the Program panel marks them and the variables (simState.dependenceHighlight)
  function showDataDependences(cell) {
    const detail = cell?.waitDetail
    if (cell?.char === '*' && detail?.reason === 'ports') { showPortConflict(cell); return }
    if (!cell || cell.char !== '.' || detail?.reason !== 'data') { simState.dependenceHighlight = null; return }
    const rows = [...new Set(detail.dependencies ?? [])]
    const marks = [], producers = new Set()
    for (const r of rows) {
      const header = interactiveCells.find(c => c.rowIdx === r && c.colIdx === -1)
      if (header) producers.add(header.instrIdx)
      const exec = interactiveCells.filter(c => c.rowIdx === r && c.colIdx >= 0 && c.char === 'E')
      if (exec.length) marks.push(exec.reduce((a, b) => (b.colIdx > a.colIdx ? b : a)))
    }
    const vars = [...producers].map(i => instrAt(i)?.destin).filter(Boolean)
    simState.dependenceHighlight = { producers: [...producers], vars }
    const ctx = worldOverlay.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.fillStyle   = 'rgba(21, 101, 192, 0.22)'
    ctx.strokeStyle = '#1565c0'
    ctx.lineWidth   = 2
    for (const c of marks) {
      ctx.fillRect(c.x, c.y, cellW, cellH)
      ctx.strokeRect(c.x + 1, c.y + 1, cellW - 2, cellH - 2)
    }
    ctx.restore()
  }

  function formatProcessingTooltip(cell) {
    const detail = cell.waitDetail
    if (cell.char === '!' && detail?.reason === 'cache')
      return t('Cache MISS: block addr {a}', { a: detail.block_address })
    if (cell.char === '2' && detail?.reason === 'cache')
      return t('2ary MISS: block addr {a}', { a: detail.block_address })
    if (cell.char === '@' && detail?.reason === 'cache-return')
      return t('Wait for cache return: block addr {a}', { a: detail.block_address })
    if (cell.char === '.' && detail?.reason === 'data') {
      const dependencies = [...new Set(detail.dependencies ?? [])]
        .filter(index => timeline.value.instructions[index])
        .map(index => rowName(index))
      if (dependencies.length)
        return t('Wait for data from {list}', { list: dependencies.join(', ') })
    }
    if (cell.char === '*' && detail?.reason === 'ports') {
      const ports = detail.ports.map(port => `P${port}`).join(', ')
      return ports ? t('Port conflict: {ports}', { ports }) : t('Port conflict')
    }
    if (cell.char === '*' && detail?.reason === 'issue-bandwidth') {
      return t('Wait: issue width full')
    }
    if (detail?.reason === 'cache') {
      if (detail.buffer_state === 'queued_fill')
        return t('Wait for fill-buffer slot for block at addr {a}', { a: detail.block_address })
      if (detail.buffer_state === 'queued_write')
        return t('Wait for write-buffer slot before filling block at addr {a}', { a: detail.block_address })
      if (detail.buffer_state === 'queued_line')
        return t('Wait for a cache line before filling block at addr {a}', { a: detail.block_address })
      if (detail.buffer_state === 'waiting_mm')
        return t('Wait for MM issue slot for block at addr {a}', { a: detail.block_address })
      if (detail.buffer_state === 'waiting_writeback')
        return t('Wait for dirty writeback before filling block at addr {a}', { a: detail.block_address })
      return t('Wait for block at addr {a}', { a: detail.block_address })
    }
    return charToProcessingState(
      cell.char,
      cell.first_exec_stage ? cell.port : null,
      cell.addr,
      cell.memoryOperation
    )
  }

  // Tooltip of an instruction (row):
  //   [iter,instr] text
  //   Port: Px; Lat: L c.
  //   LOAD/STORE MEMORY address: a        (only memory instructions)
  // ---- A cell where an instruction waits for a port ('*') ----
  // The ports it waits for and the instructions that use them in that cycle (the conflict)
  const rowHeaderCell = (row) => interactiveCells.find(c => c.rowIdx === row && c.colIdx === -1)
  function portConflict(cell) {
    const c = cell.colIdx
    const owners = (p) => timeline.value?.portUsageInstrByPort?.[String(p)]?.[c] ?? []
    const conflicts = (cell.waitDetail?.ports ?? []).flatMap(p => owners(p).map(row => ({ port: p, row })))
    return { c, conflicts }
  }
  const label = (row) => { const h = rowHeaderCell(row); return h ? `[${h.iter},${h.instrIdx}]` : `#${row}` }
  function portConflictLines(cell) {
    if (cell?.char !== '*' || cell.waitDetail?.reason !== 'ports') return null
    const { conflicts } = portConflict(cell)
    const ports = (cell.waitDetail.ports ?? []).map(p => `P${p}`).join(', ')
    const lines = [[{ text: t('Waits for a free port') + ' (' + ports + ')', kind: 'perf' }]]
    for (const { port, row } of conflicts) {
      const h = rowHeaderCell(row)
      lines.push([{ text: `P${port} ← `, kind: 'perf', chip: 'port' }, { text: label(row) + ' ', kind: 'id' },
                  { text: h?.instructionText ?? '', kind: 'instr' }])
    }
    return lines
  }
  // the instructions of the conflict are marked in the timeline (and their port, if its row is
  // shown) and in the Program panel (simState.dependenceHighlight with kind 'port')
  function showPortConflict(cell) {
    const { c, conflicts } = portConflict(cell)
    const instrs = new Set()
    const ctx = worldOverlay.getContext('2d')
    if (ctx) {
      ctx.save()
      ctx.fillStyle = 'rgba(245, 124, 0, 0.25)'
      ctx.strokeStyle = '#e65100'
      ctx.lineWidth = 2
      for (const { port, row } of conflicts) {
        const x = interactiveCells.find(k => k.rowIdx === row && k.colIdx === c)
        if (x) { ctx.fillRect(x.x, x.y, cellW, cellH); ctx.strokeRect(x.x + 1, x.y + 1, cellW - 2, cellH - 2) }
        markPortRow(ctx, port, c, 'port')
        const h = rowHeaderCell(row)
        if (h) instrs.add(h.instrIdx)
      }
      ctx.restore()
    }
    simState.dependenceHighlight = { producers: [...instrs], vars: [], kind: 'port' }
  }

  // (as lines of parts { text, kind }: each kind has its own colour, see .tt-* below)
  // The instruction of a row: of the loop body, or (index >= its length) of the block after each call
  function instrAt(i) {
    const p = simState.simulatedProcess
    const n = p?.instruction_list?.length ?? 0
    return i < n ? p?.instruction_list?.[i] : p?.epilogue?.[i - n]
  }

  function instructionTooltipLines(cell) {
    const port = cell.port !== null && cell.port !== undefined ? `P${cell.port}` : '–'
    const lat  = Number.isFinite(cell.latency) ? cell.latency : '–'
    const lines = [
      [{ text: `[${cell.iter},${cell.instrIdx}] `, kind: 'id' },
       { text: cell.instructionText || t('Instruction description unavailable'), kind: 'instr' },
       ...(Number.isFinite(cell.rep) && (simState.simulatedProcess?.rep ?? 1) > 1
         ? [{ text: ` · ${t('call {k}', { k: cell.rep + 1 })}`, kind: 'id' }] : [])],
      [{ text: `Port: ${port}; Lat: ${lat} c.`, kind: 'perf' }],
    ]
    if (cell.memoryOperation && Number.isFinite(cell.addr) && cell.addr >= 0)
      lines.push([{ text: `${cell.memoryOperation === 'Store to' ? 'STORE' : 'LOAD'} MEMORY address: ${cell.addr}`, kind: 'mem' }])
    if (cell.wrongPath || cell.mispredicted)
      lines.push([{ text: cell.wrongPath ? t('wrong path (squashed)') : t('mispredicted branch'), kind: 'note' }])
    return lines
  }

  let downX = 0, downY = 0
  function onClick(e) {
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return   // a drag
    const cell = cellAtEvent(e)
    if (cell?.cellType === 'resource-summary-label') {
      timelineOptions[cell.option] = !timelineOptions[cell.option]
      return
    }
    if (!cell) return releasePin()
    const same = (a, b) => a.rowIdx === b.rowIdx && a.colIdx === b.colIdx && a.cellType === b.cellType &&
                           (a.resourceIndex ?? null) === (b.resourceIndex ?? null)
    if (pinned.value && same(pinned.value.cell, cell)) return releasePin()
    pinCell(cell)
  }

/* ------------------------------------------------------------------
/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp1 = ref(false);
  const helpIcon1 = ref(null);
  const helpPosition = ref({ top: '0%', left: '0%' });

  function openHelp1()  { nextTick(() => { showHelp1.value = true }) }
  function closeHelp1() { showHelp1.value  = false }

</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" :title="t('Show help')">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">{{ t('Timeline: {program} on {processor}', { program: simState.simulatedProcess.name, processor: simState.processorName }) }}</span>
      </div>
    </div>

    <div v-if="timelineError" class="execution-validation-error" role="alert">
      {{ timelineError }}
    </div>
    <!-- What the pointer shows (or the pinned cell): one line -->
    <div class="timeline-status" id="timeline-status" :class="{ pinned: !!pinned }">
      <span v-if="statusText">{{ pinned ? '📌 ' : '' }}{{ statusText }}</span>
      <span v-else class="status-hint">{{ t('Point at a cell to see its relations; click it to pin it and see its explanation.') }}</span>
    </div>
    <div class="timeline-body">
      <div class="output-block-wrapper" id="canvas-container">
        <canvas ref="timelineCanvas"></canvas>
        <canvas ref="overlayCanvas" class="timeline-overlay"></canvas>
        <canvas ref="minimapCanvas" class="timeline-minimap" id="timeline-minimap"
                :title="t('The whole timeline: click or drag to move the window. Wheel: one row; Page Up / Page Down: one iteration')"
                @mousedown.stop="onMinimapDown" @mousemove.stop="onMinimapMove"></canvas>
      </div>
      <button v-if="!detailsOpen" class="details-strip" id="timeline-details-open" @click="detailsOpen = true"
              :title="t('Open the panel of details')">» <span>{{ t('Details') }}</span></button>
      <aside v-if="detailsOpen" class="timeline-details" id="timeline-details">
        <div class="details-head">
          <b>{{ t('Details') }}</b>
          <button class="details-close" @click="foldDetails" :title="t('Fold the panel of details')">«</button>
        </div>
        <template v-if="pinned">
          <div class="details-title">{{ pinned.title }}</div>
          <div v-if="pinned.cycle !== null" class="details-cycle">{{ t('Cycle {c}', { c: pinned.cycle }) }}<span v-if="pinned.state"> · {{ pinned.state }}</span></div>
          <p v-if="pinned.text" class="details-text">{{ pinned.text }}</p>
          <div v-if="pinned.lines.length" class="details-lines">
            <div v-for="(line, i) in pinned.lines" :key="i">
              <template v-for="(part, j) in line" :key="j"><span v-if="part.chip" :class="['sw', `sw-${part.chip}`]"></span><span :class="`tt-${part.kind}`">{{ part.text }}</span></template>
            </div>
          </div>
          <div v-if="pinned.info.length" class="details-info">
            <div v-for="(line, i) in pinned.info" :key="i">
              <span v-for="(part, j) in line" :key="j" :class="`tt-${part.kind}`">{{ part.text }}</span>
            </div>
          </div>
          <button class="details-release" @click="releasePin" :title="t('Release the pinned cell (also with Esc)')">{{ t('Release') }}</button>
        </template>
        <div v-else class="details-general">
          <p class="details-hint">{{ t('Point at a cell to see its relations; click it to pin it and read here what it means and what it depends on. A second click or Esc release it; the arrows select the neighbouring cell.') }}</p>
          <p class="details-hint">{{ t('Wheel: one row. Page Up / Page Down: one iteration. Minimap (right): the whole timeline. Click the name of a group of resources (Ports, Cache…) to show or hide its rows.') }}</p>
          <div class="details-legend">
            <div><b class="lt">D</b> {{ t('dispatch') }} · <b class="lt">E</b> {{ t('execute') }} · <b class="lt">W</b> {{ t('write the result') }} · <b class="lt">R</b> {{ t('retire') }}</div>
            <div>{{ t('waits:') }} <b class="lt">·</b> {{ t('for data') }} · <b class="lt">*</b> {{ t('for a port') }} · <b class="lt">-</b> {{ t('to retire in order') }}</div>
            <div v-if="cacheEnabled"><b class="lt">! 2 : @</b> {{ t('! cache miss · 2 miss to a block already loading · : waiting for a fill · @ waiting in the cache return queue') }}</div>
            <div class="critical-note"><b class="lt crit">E</b> {{ t('red letters: the critical path') }}</div>
          </div>
          <div class="details-legend">
            <div><span class="sw sw-self"></span>{{ t('the instruction') }}</div>
            <div><span class="sw sw-producer"></span>{{ t('instructions it waits for (data)') }}</div>
            <div><span class="sw sw-consumer"></span>{{ t('instructions that receive its result') }}</div>
            <div><span class="sw sw-port"></span>{{ t('ports, and instructions that use them') }}</div>
            <div><span class="sw sw-blocker"></span>{{ t('older instruction that has not finished') }}</div>
            <div v-if="cacheEnabled"><span class="sw sw-memory"></span>{{ t('memory: its block, fill buffer, MM transfer, store buffer') }}</div>
          </div>
        </div>
      </aside>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition" :title="t('Timeline')"
       :text="t('help.timeline')"
       @close="closeHelp1" />
  </Teleport>
</template>

<style scoped>
  .timeline-status {
    min-height:  1.6em;
    padding:     2px 8px;
    font-size:   0.9375rem;
    color:       #1f2a3a;
    background:  #f6f8fb;
    border-top:  1px solid #e3e8ef;
    border-bottom: 1px solid #e3e8ef;
    white-space: nowrap;
    overflow:    hidden;
    text-overflow: ellipsis;
  }
  .timeline-status.pinned { background: #fff3c4; }
  .status-hint { color: #777; }
  .timeline-body { display: flex; flex: 1 1 auto; min-height: 0; }
  .timeline-body > .output-block-wrapper { flex: 1 1 auto; min-width: 0; }
  .timeline-details {
    flex:        0 0 19rem;
    overflow-y:  auto;
    padding:     6px 10px;
    border-left: 1px solid #d6dbe3;
    background:  #fbfcfe;
    font-size:   0.9375rem;
  }
  .details-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; color: #0b2e5c; }
  .details-close, .details-release {
    border: 1px solid #9db7e3; background: white; color: #1a4fb3; border-radius: 5px; cursor: pointer;
    padding: 1px 8px; font-weight: 600;
  }
  .details-title { font-family: monospace; font-weight: 700; font-size: 1rem; }
  .details-cycle { color: #333; margin: 2px 0 6px; }
  .details-text  { margin: 4px 0 8px; line-height: 1.4; }
  .details-lines, .details-info { margin: 6px 0; font-family: monospace; font-size: 0.875rem; }
  .details-info { color: #444; border-top: 1px dashed #ccd; padding-top: 6px; }
  .details-hint { color: #555; line-height: 1.4; }
  .details-legend { margin-top: 12px; font-size: 0.875rem; color: #444; display: grid; gap: 4px; }
  .details-legend .lt { font-family: monospace; font-size: 1rem; color: #000; }
  .details-legend .lt.crit { color: red; }
  .details-lines .sw { width: 11px; height: 11px; margin-right: 5px; }
  .details-strip {
    flex: 0 0 26px; border: none; border-left: 1px solid #d6dbe3; background: #e8eef6; color: #1a4fb3;
    font-weight: 700; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 8px;
  }
  .details-strip span { writing-mode: vertical-rl; }
  .details-strip:hover { background: #d4dff0; }
  .sw { display: inline-block; width: 14px; height: 14px; margin-right: 6px; vertical-align: -2px; border: 2px solid; border-radius: 2px; }
  .sw-self     { background: rgba(255, 213, 79, 0.55); border-color: #c79100; }
  .sw-producer { background: rgba(21, 101, 192, 0.22); border-color: #1565c0; }
  .sw-port     { background: rgba(245, 124, 0, 0.25); border-color: #e65100; }
  .sw-blocker  { background: rgba(97, 97, 97, 0.25); border-color: #424242; }
  .sw-consumer { background: rgba(46, 125, 50, 0.22); border-color: #2e7d32; }
  .sw-memory   { background: rgba(123, 31, 162, 0.22); border-color: #7b1fa2; }
  .timeline-legend {
    display:     flex;
    flex-wrap:   wrap;
    gap:         2px 14px;
    padding:     2px 8px 4px;
    font-size:   0.875rem;
    color:       #333;
  }
  .timeline-legend b { font-family: monospace; font-size: 1rem; color: #000; }
  .timeline-legend .legend-wait { color: #666; margin-left: 6px; }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
  }
  .header {
    min-width: 0;
    gap: 4px;
  }
  .section-title-and-info {
    flex: 1;
    min-width: 0;
    flex-wrap: nowrap;
  }
  .header-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .show-label {
    white-space: nowrap;
  }
  .execution-validation-error {
    padding: 8px 10px;
    color: #a12622;
    font-weight: 600;
  }
</style>
<style scoped>
  .output-block-wrapper {
    overflow:        hidden;
    width:           100%;
    height:          auto;
    min-height:      0;
    flex:            1;
    position:        relative;
    cursor:          default;
    scrollbar-width: none;  /* Firefox */
    user-select:     none;
  }
  .output-block-wrapper::-webkit-scrollbar {
    display: none;  /* Chrome / Safari */
  }
  .timeline-minimap {
    position:   absolute !important;
    top:        0 !important;
    width:      58px !important;       /* (its left side: next to the window, see drawMinimap) */
    border-left: 1px solid #d6dbe3;
    cursor:     pointer;
  }

  #canvas-container {
    position: relative;
    width:    100%;
    height:   100%;
  }
  #canvas-container canvas {
    position: absolute;
    top: 0;
    left: 0;
    width:    100%;
    height:   100%;
    aspect-ratio: auto;
  }
  /* the overlay (highlights) lets the clicks go to the timeline below it */
  #canvas-container canvas.timeline-overlay {
    pointer-events: none;
  }

  .tooltip {
    position:   fixed;
    padding:    4px 8px;
    z-index:    10;
    font-size:  1rem;
    display:    inline-block;
    width:      max-content;
    max-width:  560px;       /* avoids tooltips too wide */
    text-align: center;
    white-space: pre-line;   /* interpret character \n */
    background:     #f9f9f9;
    border:         1px solid #ccc;
    border-radius:  4px;
    pointer-events: none;
  }

  .timeline-controls {
    display:     flex;
    align-items: center;
    gap:         4px;
    margin-left: auto;
    min-width:   0;
    flex-shrink: 0;
  }
  .timeline-controls .iters-group {
    gap: 2px;
    margin-left: 0;
    white-space: nowrap;
  }
  .timeline-controls .blue-button {
    padding: 2px 4px;
  }
  .iters-group input[type="number"] { width: 4ch; }

  .modal-header {
    display:     flex;
    align-items: center;
    justify-content: space-between;
  }

  .close-btn {
    background: none;
    border:     none;
    color:    white;
    font-size:  1.5rem;
    line-height: 1;
    cursor:      pointer;
    padding:     0 8px;
    opacity:     0.8;
  }
  .close-btn:hover {
    opacity: 1;
  }
  .critical {
    color: red;
  }
  /* tooltip of an instruction: soft colours for its identifier, text, performance and memory access */
  .tt-lines { text-align: left; }
  .tt-id    { color: #6b7a99; }
  .tt-instr { color: #222; font-weight: 600; }
  .tt-perf  { color: #2f7d4a; }
  .tt-mem   { color: #9a6a00; }
  .tt-note  { color: #888; font-style: italic; }
</style>
