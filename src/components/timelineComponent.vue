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
    validateProgram
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
    canvasScale:   1,
    canvasOffsetX: 0,
    canvasOffsetY: 0
  }

  const timelineOptions = reactive(defaultOptions)

  // Number of cycles that fit in the visible width of the timeline (cells are 14 px)
  function fitCycles() {
    const wrapper = document.getElementById('canvas-container')
    if (!wrapper || !wrapper.clientWidth) return
    const scale = timelineOptions.canvasScale || 1
    const fitting = Math.floor((wrapper.clientWidth / scale - 2 * 10 - 40) / 14)
    timelineOptions.canvasOffsetX = 0
    timelineOptions.cycles = Math.max(10, fitting)
  }
  function fitCyclesButton() {
    timelineOptions.autoFitCycles = true
    fitCycles()
  }
  function onCyclesTyped() { timelineOptions.autoFitCycles = false }
  function onResizeFit()   { if (timelineOptions.autoFitCycles) fitCycles() }

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
                                    rThru: rThru ?? 1,
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
    nextTick(() => {
      if (timelineOptions.autoFitCycles) fitCycles()
      unwatch = watch(
        () => [timelineOptions.instructions, timelineOptions.cycles, timelineOptions.critical,
               timelineOptions.showPorts, timelineOptions.showCache,
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
  function togglePorts()     { timelineOptions.showPorts = !timelineOptions.showPorts }
  function toggleCache()     { timelineOptions.showCache = !timelineOptions.showCache }

  function getPortUsage(timeline) {
    const inferredUsagePorts = {};
    const usageInstr = Array.from({ length: timeline.cycles }, () => []);
    const recordedPortOwners = timeline.resource_usage?.port_owners
    timeline.portUsageInstrByPort = recordedPortOwners

    for (const [rowIdx, [, , startCycle, port, states, , , flags]] of timeline.instructions.entries()) {
      const eIndex = states.indexOf("E");
      const lIndex = states.indexOf("L");
      const sIndex = states.indexOf("S");

      const Index = eIndex >= 0 ? eIndex : (lIndex >= 0 ? lIndex : sIndex);
      if (Index < 0 && flags?.wrong) continue      // wrong-path instruction squashed before executing
      if (Index < 0) alert(t('Timeline problem: all instructions must traverse an E/L/S state'));
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
    let   dragging  = false
    let   startX, startY

    const observer = new ResizeObserver(() => {
      toggleCritical()  // forces watcher to re-draw canvas
      toggleCritical()  // forces watcher to re-draw canvas
    })

    observer.observe(wrapper)

    const canvas = timelineCanvas.value

    canvas.addEventListener("click", onClick)

    wrapper.addEventListener("mousedown", (e) => {
      dragging = true
      startX   = e.clientX
      startY   = e.clientY
    })

    window.addEventListener("mouseup", () => {
      dragging = false
    })

    wrapper.addEventListener("mousemove", (e) => {

      if (!dragging) {
        onMouseMove(e)
        return
      }

      const dx = e.clientX - startX
      const dy = e.clientY - startY
      startX   = e.clientX
      startY   = e.clientY

      // fire drawTimeline reaction
      timelineOptions.canvasOffsetX += dx
      timelineOptions.canvasOffsetY += dy
    })

    wrapper.addEventListener("wheel", (e) => {

      e.preventDefault()
      const zoomFactor = 1.1

      // fire drawTimeline reaction
      if (e.deltaY < 0) {
        timelineOptions.canvasScale *= zoomFactor
      } else {
        timelineOptions.canvasScale /= zoomFactor
      }
    }, { passive:false })
  }

/* ------------------------------------------------------------------
 * CANVAS: DRAW timeline
 * ------------------------------------------------------------------ */
  const hoverInfo        = ref(null)
  const tooltipRef       = ref(null)
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
  let hoverRow    = null
  let hoverCol    = null
  let visibleCriticalPath = null

  // Tooltips of the cells are built when drawing: redrawn in the new language
  watch(locale, () => { if (timeline.value && timelineCanvas.value) scheduleDraw(timelineOptions.cycles, timelineOptions.cycles) })

  function scheduleDraw(cycles, oldCycles) {
    if (rafPending) return
    rafPending = true

    requestAnimationFrame(() => {
      drawTimeline(cycles, oldCycles)
      rafPending = false
    })
  }

  function drawTimeline(newCycles, oldCycles) {

    const wrapper = timelineCanvas.value.parentElement
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
    totalCycles = timelineOptions.cycles
    totalInstr  = timelineOptions.instructions
    const cacheState = timeline.value.resource_usage?.cache_state
    const fillBufferState = timeline.value.resource_usage?.fill_buffers
    const writeBufferState = timeline.value.resource_usage?.write_buffers
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
        : [])
    ]
    resourceRowCount = resourceRows.length

    if (newCycles != oldCycles && newCycles != 0 ) {
      if (newCycles > cycles) newCycles = cycles

      // change timeline size (cycles) and recompute totalInstr
      totalCycles = newCycles

      // Compute last instruction processed before newCycles
      let first_cycle = instructions[totalInstr-1][2]
      if (totalCycles > first_cycle) { // included & find more
        while (totalCycles > first_cycle && totalInstr < instructions.length) {
          totalInstr++
          first_cycle = instructions[totalInstr-1][2]
        }
        if (totalCycles <= first_cycle)
          totalInstr--
      } else { // not included & find less
        do {
          totalInstr--
          first_cycle = instructions[totalInstr-1][2]
        } while (totalCycles <= first_cycle && totalInstr > 0)
      }
      timelineOptions.instructions = totalInstr
      timelineOptions.cycles= newCycles
    }

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
          simState.simulatedProcess.instruction_list.length
        )
      : null
    simState.timelineCriticalPathPercentages = criticalPercentages
    simState.timelineCriticalPathEnabled = criticalPercentages !== null

    cellW = 14
    labelW = 40
    cellH = 20
    padX  = 10
    padY  = 10
    fontSize   = 14
    fontXOffset = 2
    fontYOffset = 3
    hoverRow = null
    hoverCol = null
    hoverInfo.value = null

    const canvasWidth = Math.max(
      viewportWidth,
      Math.ceil(padX*2 + labelW + totalCycles*cellW)
    )
    const canvasHeight = Math.max(
      viewportHeight,
      Math.ceil(padY*2 + (totalInstr+resourceRowCount+1)*cellH)
    )
    for (const canvas of [timelineCanvas.value, overlayCanvas.value]) {
      canvas.width = canvasWidth
      canvas.height = canvasHeight
      canvas.style.width = `${canvasWidth}px`
      canvas.style.height = `${canvasHeight}px`
    }

    const ctxOverlay = overlayCanvas.value.getContext('2d')
    ctxOverlay.setTransform(1,0,0,1,0,0)
    ctxOverlay.clearRect(0, 0, overlayCanvas.value.width, overlayCanvas.value.height)
    ctxOverlay.setTransform(
      timelineOptions.canvasScale, 0, 0, timelineOptions.canvasScale,
      timelineOptions.canvasOffsetX, timelineOptions.canvasOffsetY
    )

    const ctx = timelineCanvas.value.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,timelineCanvas.value.width,timelineCanvas.value.height)
    ctx.setTransform(
      timelineOptions.canvasScale, 0, 0, timelineOptions.canvasScale,
      timelineOptions.canvasOffsetX, timelineOptions.canvasOffsetY
    )

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
      let lengthRow = 1
      let ROBused = 1
      if (instructions[initRow][2] + instructions[initRow][4].length === i+1) {
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

    for (const [resourceRowIndex, resource] of resourceRows.entries()) {
      const resourceY = padY + (resourceRowIndex + 1) * cellH
      ctx.fillStyle = '#f1f3f5'
      ctx.strokeStyle = '#bbb'
      ctx.lineWidth = 1
      ctx.fillRect(padX, resourceY, labelW, cellH)
      ctx.strokeRect(padX, resourceY, labelW, cellH)
      ctx.fillStyle = '#000'

      const visibleCycleCount = Math.min(totalCycles, resource.cycles.length)
      const usedCycleCount = resource.cycles
        .slice(0, visibleCycleCount)
        .filter(Boolean)
        .length
      const usagePercent = visibleCycleCount > 0
        ? 100 * usedCycleCount / visibleCycleCount
        : 0
      const displayedLabel = resource.port === null ? 'MM' : resource.label
      ctx.fillText(displayedLabel, padX + fontXOffset, resourceY + fontYOffset)
      const visibleMmRequests = resource.port === null
        ? resource.requests.filter(request =>
            request.cycle >= 0 && request.cycle < visibleCycleCount
          )
        : []
      const mmReadTransfers = visibleMmRequests.filter(
        request => request.operation !== 'write'
      ).length
      const mmWriteTransfers = visibleMmRequests.length - mmReadTransfers
      interactiveCells.push({
        x: padX,
        y: resourceY,
        width: labelW,
        colIdx: -1,
        rowIdx: -2,
        cellType: 'resource-label',
        resourceIndex: resourceRowIndex,
        tooltip: resource.cacheLineIndex !== undefined
          ? t('Cache line {i}: C clean, D dirty, r/w loading; loading blocks also appear in a fill buffer', { i: resource.cacheLineIndex })
          : resource.bufferType === 'fill'
            ? t('Fill buffer {i}: holds one distinct block fill; misses to the same block share the entry', { i: resource.bufferIndex })
          : resource.bufferType === 'write'
            ? t('Write buffer {i}: holds an evicted dirty block until its MM write completes', { i: resource.bufferIndex })
          : resource.port === null
            ? t('MM: {r} reads, {w} writes ({p}% busy)', { r: mmReadTransfers, w: mmWriteTransfers, p: usagePercent.toFixed(1) })
          : t('{label}: {used}/{visible} cycles used ({p}%)', { label: resource.label, used: usedCycleCount, visible: visibleCycleCount, p: usagePercent })
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
        if (resource.bufferType === 'fill' && bufferEntry?.valid) {
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
          linkedInstructionRows,
          linkedResourceRows,
          tooltip: resource.bufferType && !bufferEntry?.valid
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
      const memoryOperation = states.includes('L')
        ? 'Load from'
        : states.includes('S') ? 'Store to' : null

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
      ctx.fillText    (String(instrIdx % 10), x + fontXOffset, y + fontYOffset)

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
        latency: simState.simulatedProcess.instruction_list[instrIdx]?.latency,
        instructionText: simState.simulatedProcess.instruction_list[instrIdx]?.text,
        memoryOperation,
        wrongPath,
        mispredicted: !!flags?.mispredicted,
        critical: criticalCycles.length > 0,
        criticalCycles: criticalCycles.length
      })

      x += labelW

      for (let i = 0; i < totalCycles; ) {
        let ch        = ' '
        let currColor = wrongPath ? "#777" : "#000"

        // register interactive cell & check critical
        if (i >= startCycle && i < startCycle+lengthCol) {
          ch  = states[i-startCycle];
          const previousState = states[i-startCycle-1]
          const first_exec_stage =
            (ch === 'E' && previousState !== 'E') ||
            (ch === 'L' && previousState !== 'L') ||
            (ch === 'S' && previousState !== 'S')
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
        ctx.fillText    (ch, x + fontXOffset, y + fontYOffset);

        i++;
        x += cellW;
      }
    }
    drawSelectedCell()
  }

  function drawSelectedCell() {
    const cell = selectedCell.value
    if (!cell) return
    const ctx = overlayCanvas.value?.getContext('2d')
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
    const ctx = overlayCanvas.value.getContext('2d')
    ctx.clearRect(0, 0,
                  Math.max(overlayCanvas.value.width, 1+padX+labelW+totalCycles*cellW),
                  Math.max(overlayCanvas.value.height, 1+padY+(totalInstr+resourceRowCount+1)*cellH))

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

    // highlight column (cycle)
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

  function onMouseMove(e) {
    const rect = timelineCanvas.value.getBoundingClientRect()

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const worldX = (mouseX - timelineOptions.canvasOffsetX) / timelineOptions.canvasScale
    const worldY = (mouseY - timelineOptions.canvasOffsetY) / timelineOptions.canvasScale

    let hitCell = null

    for (const cell of interactiveCells) {
      if (
        worldX >= cell.x &&
        worldX <= cell.x + (cell.width ?? cellW) &&
        worldY >= cell.y &&
        worldY <= cell.y + cellH
      ) {
        hitCell = cell
        break
      }
    }
    if (!hitCell) {
      hoverInfo.value = null
      simState.instrHighlightedIdx = -1
      simState.highlightedPort = -1

      if (hoverRow != null || hoverCol != null) {
        hoverRow = null
        hoverCol = null
        drawHoverOverlay(null, null, null, null, null, null)
      }
      return
    }

    const { rowIdx: row, colIdx: col, initCol, lengthCol, initRow, lengthRow,
            char, port, critical,
            instrIdx } = hitCell

    if (hitCell.cellType === 'resource-label') {
      simState.highlightedPort = -1
      simState.instrHighlightedIdx = -1
      hoverInfo.value = {
        x: e.clientX + 10,
        y: e.clientY + 10,
        state: hitCell.tooltip,
        critical: false
      }
      hoverRow = row
      hoverCol = col
      drawHoverOverlay(null, null, null, null, null, null)
      adjustTooltipPosition(e)
      return
    }

    if (hitCell.cellType === 'resource-cycle') {
      const resourceHoverRow = `resource-${hitCell.resourceIndex}`
      simState.highlightedPort = -1
      simState.instrHighlightedIdx = -1
      hoverInfo.value = hitCell.tooltip
        ? {
            x: e.clientX + 10,
            y: e.clientY + 10,
            state: hitCell.tooltip,
            critical: false
          }
        : null
      if (hoverInfo.value) adjustTooltipPosition(e)
      if (hoverRow !== resourceHoverRow || hoverCol !== col) {
        hoverRow = resourceHoverRow
        hoverCol = col
        drawHoverOverlay(
          null,
          null,
          null,
          null,
          null,
          null,
          hitCell.linkedInstructionRows,
          col,
          hitCell.linkedResourceRows
        )
      }
      return
    }

    if (row === -1) {
      simState.highlightedPort = -1
      simState.instrHighlightedIdx = -1
      hoverInfo.value = {
        x:        e.clientX + 10,
        y:        e.clientY + 10,
        state:    hitCell.tooltip,
        critical: false
      }
      hoverRow = null
      hoverCol = null
      drawHoverOverlay(null, col, initRow, lengthRow, initCol, lengthCol)
      adjustTooltipPosition(e)
      return
    }

    if (hoverRow !== row || hoverCol !== col) {

      if (simState.instrHighlightedIdx !== instrIdx)
        simState.instrHighlightedIdx = instrIdx
      if (char !== 'E' && char !== 'L' && char !== 'S')
        simState.highlightedPort = -1
      else if (simState.highlightedPort !== port)
        simState.highlightedPort = port

      const rowHeader = col === -1
      const stateTooltip = formatProcessingTooltip(hitCell)
      hoverInfo.value = {
        x:        e.clientX + 10,
        y:        e.clientY + 10,
        state:    rowHeader
          ? formatInstructionTooltip(hitCell)
          : stateTooltip,
        critical: rowHeader ? false : critical && timelineOptions.critical
      }
      adjustTooltipPosition(e)

      hoverRow = row
      hoverCol = col
      drawHoverOverlay(
        row,
        rowHeader ? null : col,
        rowHeader ? row : initRow,
        rowHeader ? 1 : lengthRow,
        initCol,
        lengthCol
      )
    }
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
        .map(index => timeline.value.instructions[index])
        .filter(Boolean)
        .map(([iteration, instruction]) => `instr ${instruction} (iter ${iteration})`)
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
  //   [iter,instr] Port: Px; Lat: L c. - text
  //   LOAD/STORE MEMORY address: a        (only memory instructions)
  function formatInstructionTooltip(cell) {
    const port = cell.port !== null && cell.port !== undefined ? `P${cell.port}` : '–'
    const lat  = Number.isFinite(cell.latency) ? cell.latency : '–'
    const lines = [`[${cell.iter},${cell.instrIdx}] Port: ${port}; Lat: ${lat} c. - ` +
                   (cell.instructionText || t('Instruction description unavailable'))]
    if (cell.memoryOperation && Number.isFinite(cell.addr) && cell.addr >= 0)
      lines.push(`${cell.memoryOperation === 'Store to' ? 'STORE' : 'LOAD'} MEMORY address: ${cell.addr}`)
    if (cell.wrongPath || cell.mispredicted)
      lines.push(cell.wrongPath ? t('wrong path (squashed)') : t('mispredicted branch'))
    return lines.join('\n')
  }

  function onClick(e) {
    const rect = timelineCanvas.value.getBoundingClientRect()

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const worldX = (mouseX - timelineOptions.canvasOffsetX) / timelineOptions.canvasScale
    const worldY = (mouseY - timelineOptions.canvasOffsetY) / timelineOptions.canvasScale

    for (const cell of interactiveCells) {
      if (
        worldX >= cell.x &&
        worldX <= cell.x + (cell.width ?? cellW) &&
        worldY >= cell.y &&
        worldY <= cell.y + cellH
      ) {
        handleCellClick(cell, e)
        break
      }
    }
  }

  function handleCellClick(cell, event) {
    selectedCell.value = cell
    drawHoverOverlay(null, null, null, null, null, null, null)
    hoverInfo.value = {
      x: event.clientX + 10,
      y: event.clientY + 10,
      state: 'ToDo',
      critical: false
    }
    adjustTooltipPosition(event)
  }

  function adjustTooltipPosition(e) {
    nextTick(() => {
      const tt = tooltipRef.value
      if (!tt) return

      const tr = tt.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      let x = e.clientX + 10
      let y = e.clientY + 10

      if (tr.right > vw) {
        x = e.clientX - tr.width - 10
      }

      if (tr.bottom > vh) {
        y = e.clientY - tr.height - 10
      }

      tt.style.left = `${x}px`
      tt.style.top  = `${y}px`
    })
  }

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
        <span class="header-title">{{ t('Execution Timeline - {program} on {processor}', { program: simState.simulatedProcess.name, processor: simState.processorName }) }}</span>
      </div>

      <div class="timeline-controls">
        <div class="iters-group">
          <span class="iters-label">{{ t('Cycles:') }}</span>
          <input type="number" min="1" v-model.lazy.number="timelineOptions.cycles"
            :title="t('Number of cycles shown (press Enter to apply)')"
            @change="onCyclesTyped"
            id="timeline-cycles" style="width: 4.5em">
          <button class="blue-button fit-cycles" @click="fitCyclesButton"
            id="timeline-fit-cycles"
            :title="t('Show as many cycles as fit in the panel width (and keep fitting when the window is resized)')">
            {{ t('Fit') }}
          </button>
        </div>

        <div class="iters-group">
          <span class="show-label">{{ t('Show:') }}</span>
          <button class="blue-button toggle-button" :class="{ active: timelineOptions.critical }" :aria-pressed="timelineOptions.critical"
            :title="t('Show the critical path ending at the last instruction retired in the visible cycles')"
            id="timeline-critical"
            @click="toggleCritical">
            <span v-if="timelineOptions.critical">✔ </span>
            {{ t('Critical') }}
          </button>
          <button class="blue-button toggle-button" :class="{ active: timelineOptions.showPorts }"
            :aria-pressed="timelineOptions.showPorts"
            :title="t('Show or hide execution-port usage rows')"
            id="timeline-ports"
            @click="togglePorts">
            <span v-if="timelineOptions.showPorts">✔ </span>
            {{ t('Ports') }}
          </button>
          <button class="blue-button toggle-button" :class="{ active: timelineOptions.showCache && cacheEnabled }"
            :aria-pressed="timelineOptions.showCache && cacheEnabled"
            :disabled="!cacheEnabled"
            :title="cacheEnabled
              ? t('Show or hide Main Memory transfers, cache lines, fill buffers, and write buffers')
              : t('Show Cache is unavailable because the selected processor has no cache')"
            id="timeline-cache"
            @click="toggleCache">
            <span v-if="timelineOptions.showCache">✔ </span>
            {{ t('Cache') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="timelineError" class="execution-validation-error" role="alert">
      {{ timelineError }}
    </div>
    <div class="output-block-wrapper" id="canvas-container">
      <canvas ref="timelineCanvas"></canvas>
      <canvas ref="overlayCanvas"></canvas>
      <div v-if="hoverInfo" ref="tooltipRef" class="tooltip"
           :style="{ top: hoverInfo.y + 'px', left: hoverInfo.x + 'px' }">
        <div v-if="hoverInfo.state" :class="{ critical: hoverInfo.critical }">
            {{ hoverInfo.state }}
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition" :title="t('Timeline')"
       :text="t('help.timeline')"
       @close="closeHelp1" />
  </Teleport>
</template>

<style scoped>
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
    overflow:        auto;
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
  .output-block-wrapper:active {
    cursor: grabbing;
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
  #canvas-container canvas:last-child {
    pointer-events: none; /* 👈 importante */
  }

  .tooltip {
    position:   fixed;
    padding:    4px 8px;
    z-index:    10;
    font-size:  medium;
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
    font-size:  24px;
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
</style>
