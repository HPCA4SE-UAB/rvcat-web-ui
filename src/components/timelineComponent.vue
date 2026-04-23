<script setup>
  import { ref, toRaw, onMounted, nextTick, onUnmounted, onBeforeUnmount,
           watch, inject, reactive}                                  from 'vue'
  import HelpComponent                    from '@/components/helpComponent.vue'
  import { charToProcessingState  }                             from '@/common'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'

  const { getTimeline }     = useRVCAT_Api()
  const { registerHandler } = inject('worker')
  const simState            = inject('simulationState')

  /* ------------------------------------------------------------------
   * Timeline options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'timelineOptions'

  const defaultOptions = {
    instructions:  20,
    cycles:        40,
    full:          false,
    canvasScale:   1,
    canvasOffsetX: 0,
    canvasOffsetY: 0
  }

  const timelineOptions = reactive(defaultOptions)

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
  const timelineCanvas = ref(null)
  const overlayCanvas  = ref(null)

// ============================================================================
// WATCHES: timelineOptions, simulatedProcess, timeline  HANDLERS: getTimeline
// ============================================================================

  watch ([() => simState.simulatedProcess], () => { requestTimeline() },
    { deep: true, immediate: false })

  function requestTimeline() {
    if (simState.state >= 3) {
      console.log('📈🔄 Request timeline from RVCAT')
      const { name, ROBsize, dispatch, retire, sched, blksize, nBlocks, mPenalty, mIssueTime, instruction_list } = simState.simulatedProcess
      getTimeline(JSON.stringify( { name, ROBsize, dispatch, retire, sched, blksize, nBlocks, mPenalty, mIssueTime,
                                    instruction_list: toRaw(instruction_list)}, null, 2),
                  10) // Call Python RVCAT (obtain timeline with current process info, for 10 loop iterations)
    }
  }

  const handleTimeline = async (data, dataType) => {
    // Handler for 'get_timeline' message (fired by RVCAT getTimeline function)
    if (dataType === 'error') {
      console.error('📈❌Failed to get timeline:', data)
      return;
    }
    try {
      let timelineRVCAT       = JSON.parse(data)
      getPortUsage(timelineRVCAT);
      timeline.value = timelineRVCAT
      timelineOptions.canvasOffsetX = 0
      timelineOptions.canvasOffsetY = 0
      scheduleDraw()
    } catch (error) {
      console.error('📈❌Failed to process JSON timeline:', error)
    }
  }

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleTimeline = null
  let unwatch               = null
  let isComponentMounted    = false

  onMounted(() => {
    cleanupHandleTimeline = registerHandler('get_timeline', handleTimeline)
    loadOptions()
    addCanvasWrapper()
    requestTimeline()  // generate timeline using RVCAT (if previous components are mounted)
    nextTick(() => {
      isComponentMounted = true;
      unwatch = watch(
        () => [timelineOptions.instructions, timelineOptions.cycles, timelineOptions.full,
               timelineOptions.canvasScale, timelineOptions.canvasOffsetX, timelineOptions.canvasOffsetY ],
            ([newInstructions, newCycles], [oldInstructions, oldCycles]) => {
              if (!timelineCanvas.value || !timeline.value) return
              if (newCycles != oldCycles) {
                const clamped = Math.min(Math.max(newCycles, 1), 100)
                if (clamped !== newCycles) {
                  timelineOptions.cycles = clamped
                  return
                }
              } else if (newInstructions != oldInstructions) {
                const clamped = Math.min(Math.max(newInstructions, 1), 100)
                if (clamped !== newInstructions) {
                  timelineOptions.instructions = clamped
                  return
                }
              }
              saveOptions()
              scheduleDraw()
            }
          )
      console.log('📈🎯 Timeline Component mounted')
    })
  })

  onBeforeUnmount(() => {
    isComponentMounted = false;
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  })

  onUnmounted(() => {
    if (cleanupHandleTimeline) {
      cleanupHandleTimeline()
      cleanupHandleTimeline = null
    }
    console.log('📈👋 Timeline Component unMounted')
  })

/* ------------------------------------------------------------------
* UI actions
* ------------------------------------------------------------------ */

  function toggleFull()  { timelineOptions.full = !timelineOptions.full }

  function getPortUsage(timeline) {
    const usagePorts = {};
    const usageInstr = Array.from({ length: timeline.cycles }, () => []);

    for (const [rowIdx, [iter, instrIdx, startCycle, port, states]] of timeline.instructions.entries()) {
      const eIndex = states.indexOf("E");
      if (eIndex < 0) alert("Timeline problem: all instructions must traverse an E state");
      const cycle = startCycle + eIndex;

      // Verificar que cycle esté dentro del rango
      if (cycle >= 0 && cycle < timeline.cycles) {
        usageInstr[cycle].push(rowIdx);
        (usagePorts[port] ??= []).push(cycle);
      } else {
        console.warn(`Cycle ${cycle} fuera de rango (0-${timeline.cycles-1}) para instrucción ${rowIdx}`);
      }
    }
    for (const p in usagePorts) {
      usagePorts[p].sort((a,b)=>a-b);
    }
    timeline.portUsagePorts = usagePorts
    timeline.portUsageInstr = usageInstr
  }

  function buildPortTimelineMatrix(timeline) {

    const portUsage = timeline.portUsagePorts;

    // Determinar número de ciclos
    const maxCycle = Math.max(
      ...Object.values(portUsage).flat(),
      0
    );

    const cycles = maxCycle + 1;
    const ports = Object.keys(portUsage).sort((a,b)=>Number(a)-Number(b));
    const matrix = {};

    for (const p of ports) {
      matrix[p] = new Array(cycles).fill(0);
    }

    for (const [port, usedCycles] of Object.entries(portUsage)) {
      for (const c of usedCycles) {
        matrix[port][c]++;
      }
    }

    return { cycles, ports, matrix };
    // {  cycles: 4, ports: ["0","1"], matrix: { "0": [0,1,1,0], "1": [0,0,0,1] }
  }

  function renderPortUsageASCII(portMatrix) {
    //     0123
    // P0  .XX.
    // P1  ...X
    const { cycles, ports, matrix } = portMatrix;
    const lines = [];
    let header = "    ";
    for (let c = 0; c < cycles; c++) {
      header += (c % 10);
    }
    lines.push(header);

    for (const p of ports) {
      let row = `P${p}  `;
      for (let c = 0; c < cycles; c++) {
        row += matrix[p][c] > 0 ? "X" : ".";
      }
      lines.push(row);
    }
    return lines.join("\n");
  }

  function addCanvasWrapper () {
    const wrapper = document.getElementById("canvas-container")
    let   dragging  = false
    let   startX, startY

    const observer = new ResizeObserver(() => {
      toggleFull()  // forces watcher to re-draw canvas
      toggleFull()  // forces watcher to re-draw canvas
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
  const interactiveCells = []
  let totalCycles = 0
  let totalInstr  = 0
  let cellW       = 14
  let cellH       = 20
  let padX        = 10
  let padY        = 10
  let fontSize    = 14
  let fontXOffset = 2
  let fontYOffset = 3
  let rafPending  = false
  let hoverRow    = null
  let hoverCol    = null

  function scheduleDraw() {
    if (rafPending) return
    rafPending = true

    requestAnimationFrame(() => {
      drawTimeline()
      rafPending = false
    })
  }

  function drawTimeline() {

    const rect = timelineCanvas.value.getBoundingClientRect()

    timelineCanvas.value.width  = rect.width
    timelineCanvas.value.height = rect.height

    const ctxOld = overlayCanvas.value.getContext('2d')
    ctxOld.clearRect(0, 0, overlayCanvas.value.width, overlayCanvas.value.height)

    overlayCanvas.value.width  = rect.width
    overlayCanvas.value.height = rect.height

    const { cycles, instructions, portUsagePorts, portUsageInstr } = timeline.value

    totalCycles = Math.min(cycles, timelineOptions.cycles)
    totalInstr  = Math.min(instructions.length, timelineOptions.instructions)
    cellW = 14
    cellH = 20
    padX  = 10
    padY  = 10
    fontSize   = 14
    fontXOffset = 2
    fontYOffset = 3
    hoverRow = null
    hoverCol = null
    hoverInfo.value = null

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

    // First line: 0 1 2 3 ...   start on (0,0)
    let   x = padX
    const y = padY
    const initRowList = []
    const lengthRowList = []
    const portsUsedList = []

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
      while (initRow < totalInstr && (instructions[initRow][2] + instructions[initRow][4].length <= i)) initRow++
      let lengthRow = 1
      while (initRow+lengthRow < totalInstr && instructions[initRow+lengthRow][2] <= i) lengthRow++

      let sequenceOfPorts = Object.keys(portUsagePorts)
        .filter(p => {
          const usage = portUsagePorts[p]
          return Array.isArray(usage)
            ? usage.includes(i)
            : i in usage
        })
        .map(p => `P${p}`)
        .join(',')

      sequenceOfPorts = `Ports used: ${sequenceOfPorts || 'none'}\nROB usage: ${lengthRow}`

      const portsUsed = portUsageInstr[i]

      interactiveCells.push({
        x, y, colIdx: i, rowIdx: -1,   /* indicates 1st row of cycles */
        initCol: i,
        lengthCol: 1,
        initRow, lengthRow,
        sequenceOfPorts,
        portsUsed
      })

      initRowList.push(initRow)
      lengthRowList.push(lengthRow)
      portsUsedList.push(portsUsed)

      i++
      x += cellW
    }

    // ************************************************************************************
    //   for each inst. & for each cycle, write cell into canvas and push interactive cells
    // ************************************************************************************
    for (const [rowIdx, [iter, instrIdx, startCycle, port, states, critical_cycles]] of instructions.entries())
    {
      if (rowIdx >= totalInstr) return

      // Compute background color based on iteration number
      const rowBg = iter >= 0 ? `hsl(${(iter * 80) % 360}, 50%, 90%)` : "#ffffff";

      //  Draw line starting on (x,y)
      let   x = padX;
      const y = padY + (rowIdx+1) * cellH;

      let initCol   = startCycle
      let lengthCol = states.length

      for (let i = 0; i < totalCycles; ) {
        let ch        = ' '
        let currColor = "#000"

        // register interactive cell & check critical
        if (i >= startCycle && i < startCycle+lengthCol) {
          ch  = states[i-startCycle];
          let critical         = critical_cycles.includes(i - startCycle)
          let first_exec_stage = (ch == 'E' && states[i-startCycle-1] != 'E')

          if (critical) currColor = "red"

          interactiveCells.push({
            x, y,
            colIdx: i,
            rowIdx,
            initCol, lengthCol,
            initRow: initRowList[i],
            lengthRow: lengthRowList[i],
            char: ch,
            critical,
            first_exec_stage,
            port,
            instrIdx,
            portsUsed: portsUsedList[i]
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
  }

  function drawHoverOverlay(row, col, initRow, lengthRow, initCol, lengthCol, portsUsed) {
    const ctx = overlayCanvas.value.getContext('2d')
    ctx.clearRect(0, 0,
                  Math.max(overlayCanvas.value.width, 1+padX+totalCycles*cellW),
                  Math.max(overlayCanvas.value.height,1+padY+(totalInstr+1)*cellH))

    ctx.strokeStyle = 'red'
    ctx.lineWidth   = 1

    // highlight column (cycle)
    if (col !== null) {
      let length = Math.min(lengthRow, totalInstr-initRow)
      ctx.strokeRect( padX + col*cellW, padX + (initRow+1) * cellH,  cellW, length*cellH)

      // highlight specific positions (cells)
      if (portsUsed && portsUsed.length > 0) {
        portsUsed.forEach(pos => {
          let row = pos; // o pos - 1 si es 1-indexado
          if (row >= initRow && row < initRow + lengthRow) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
            ctx.fillRect(padX + col * cellW, padX + (row + 1) * cellH, cellW, cellH);
            ctx.restore();
          }
        });
      }
    }

    // highlight row (instruction)
    if (row !== null) {
      let length = Math.min(lengthCol, totalCycles-initCol)
      ctx.strokeRect( padY + initCol*cellW, padY + (row+1) * cellH, length*cellW, cellH )
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
        worldX <= cell.x + cellW &&
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
        drawHoverOverlay(null, null, null, null, null, null, null)
      }
      return
    }

    const { rowIdx: row, colIdx: col, initCol, lengthCol, initRow, lengthRow,
            char, port, first_exec_stage, critical, sequenceOfPorts, instrIdx, portsUsed } = hitCell

    if (row === -1) {
      simState.highlightedPort = -1
      simState.instrHighlightedIdx = -1
      hoverInfo.value = {
        x:        e.clientX + 10,
        y:        e.clientY + 10,
        state:    sequenceOfPorts,
        critical: false
      }
      hoverRow = null
      hoverCol = null
      drawHoverOverlay(null, col, initRow, lengthRow, initCol, lengthCol, portsUsed)
      adjustTooltipPosition(e)
      return
    }

    if (hoverRow !== row || hoverCol !== col) {

      if (simState.instrHighlightedIdx !== instrIdx)
        simState.instrHighlightedIdx = instrIdx
      if (char !== 'E')
        simState.highlightedPort = -1
      else if (simState.highlightedPort !== port)
        simState.highlightedPort = port

      hoverInfo.value = {
        x:        e.clientX + 10,
        y:        e.clientY + 10,
        state:    charToProcessingState(char, first_exec_stage ? port : null),
        critical: critical
      }
      adjustTooltipPosition(e)

      hoverRow = row
      hoverCol = col
      drawHoverOverlay(row, col, initRow, lengthRow, initCol, lengthCol, portsUsed)
    }
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
        worldX <= cell.x + cellW &&
        worldY >= cell.y &&
        worldY <= cell.y + cellH
      ) {
        handleCellClick(cell.rowIdx, cell.colIdx)
        break
      }
    }
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
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show help">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Execution Timeline - <strong>{{  simState.programName }}</strong></span>
      </div>

      <div class="timeline-controls">
        <div class="iters-group">
          <span class="iters-label">Instructions:</span>
          <input type="number" min="1" max="100"  v-model.number="timelineOptions.instructions"
            title="# instructions (1 to 100)"
            id="timeline-instructions">
        </div>
        <div class="iters-group">
          <span class="iters-label">Cycles:</span>
          <input type="number" min="1" max="100"  v-model.number="timelineOptions.cycles"
            title="# cycles (1 to 100)"
            id="timeline-cycles">
        </div>

        <div class="iters-group">
          <button class="blue-button" :class="{ active: timelineOptions.full }" :aria-pressed="timelineOptions.full"
            title="Toggle Full Timeline View"
            id="timeline-full"
            @click="toggleFull">
            <span v-if="timelineOptions.full">✔ </span>
            Full Timeline
          </button>
        </div>
      </div>
    </div>

    <div class="output-block-wrapper" id="canvas-container">
      <canvas ref="timelineCanvas"></canvas>
      <canvas ref="overlayCanvas"></canvas>
      <div v-if="hoverInfo" ref="tooltipRef" class="tooltip"
           :style="{ top: hoverInfo.y + 'px', left: hoverInfo.x + 'px' }">
        <div v-if="hoverInfo.state" :class="{ critical: hoverInfo.critical }">
            {{ hoverInfo.state }}
            <span v-if="hoverInfo.critical"> (in Critical Path)</span>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition" title="Timeline"
       text= "<p>The <strong>Timeline</strong> section shows the program execution over time.
                The dimension of the timeline, <em>instructions</em> × <em>cycles</em> can be modified, and you can choose to see the <strong>full timeline</strong></p>
              <p><strong>Grab</strong> the timeline and move the mouse left/right and up/down, and use the mouse wheel to zoom in/out.
                Hover over the grid to see specific info about the selected cell, the selected instruction (initial cell of a row),
                or the selected cycle (initial cell of a column).</p>"
       @close="closeHelp1" />
  </Teleport>
</template>

<style scoped>
  .output-block-wrapper {
    overflow:        auto;
    width:           100%;
    height:          100%;
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
    max-width:  250px;       /* avoids tooltips too wide */
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
    gap:         8px;
    margin-left: auto;
    min-width:   0;
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
