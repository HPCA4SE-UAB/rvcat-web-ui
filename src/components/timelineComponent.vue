<script setup>
  import { ref, toRaw, onMounted, nextTick, onUnmounted, watch, inject, reactive} from 'vue'
  import HelpComponent                                 from '@/components/helpComponent.vue'
  import { charToProcessingState  }                                          from '@/common'
  import { useRVCAT_Api }                                                  from '@/rvcatAPI'

  const { getTimeline }     = useRVCAT_Api()
  const { registerHandler } = inject('worker')
  const simState            = inject('simulationState')

  /* ------------------------------------------------------------------
   * Timeline options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'timelineOptions'

  const defaultOptions = {
    iters:         1,
    showPorts:     false,
    canvasScale:   1,
    canvasOffsetX: 0,
    canvasOffsetY: 0,
    hoverPosX:     null,
    hoverPosY:     null
  }

  const savedOptions = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      console.log('📈load options')
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const timelineOptions = reactive({ ...defaultOptions, ...savedOptions })

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timelineOptions))
    } catch (error) {
      console.error('📈❌ Failed to save:', error)
    }
  }

  function createDefaultTimeline() {
    return {
      cycles:       4,
      instructions: [ [0, 0, 0, "0", "DEWR", [0,1,2,3]]],
      portUsage:    { "0": [1], "1": [] }
    };
  }

  const timeline       = reactive(createDefaultTimeline())
  const timelineCanvas = ref(null)

// ============================================================================
// WATCHES: timelineOptions, simulatedProcess, timeline  HANDLERS: getTimeline
// ============================================================================
  watch(() => [timelineOptions.iters, timelineOptions.showPorts], () => {
    try {
      timelineOptions.iters = Math.min(timelineOptions.iters, 9)
      timelineOptions.iters = Math.max(timelineOptions.iters, 1)

      // re-position
      timelineOptions.canvasScale  = 1
      timelineOptions.canvasOffsetX= 0
      timelineOptions.canvasOffsetY= 0

      requestAnimationFrame(() => {
        getTimelineAndDraw()
      })
      console.log('📈✅ Modified timeline options (iters or showPorts)')
      saveOptions()
    } catch (error) {
      console.error('📈❌Failed to save timeline options:', error)
    }
  },
  { immediate: true })

  watch(() => [timelineOptions.hoverPosX, timelineOptions.hoverPosY], ([newX, newY],oldValue) => {

    if (newX == null || newY == null) return
    const oldX = oldValue?.[0]
    const oldY = oldValue?.[1]
    if (oldX == null || oldY == null) return

    try {
      requestAnimationFrame(() => {
        drawHoverOverlay(oldX, oldY)
      })
      //console.log(`📈🔄 Hover overlay: X:${newX} Y: ${newY}`)
      saveOptions()
    } catch (error) {
      console.error('📈❌Failed to draw hover overlay:', error)
    }
  },
  { immediate: true })

  watch(() => [timeline, timelineOptions.canvasScale, timelineOptions.canvasOffsetX, timelineOptions.canvasOffsetY], () => {
    if (timelineCanvas.value && timeline) {
      try {
        requestAnimationFrame(() => {
          drawTimeline()
        })
        saveOptions()
      } catch (error) {
        console.error('📈❌Failed to draw timeline', error)
      }
    }
  },
  { deep: true, immediate: true })

  watch ([() => simState.instrHighlightedIdx], () => {console.log('📈 Intr timeline') },
    { deep: true, immediate: false })

  watch ([() => simState.simulatedProcess], () => { getTimelineAndDraw() },
  { deep: true, immediate: false })

  // Handler for 'get_timeline' message (fired by RVCAT getTimeline function)
  const handleTimeline = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('📈❌Failed to get timeline:', data)
      return;
    }
    try {
      let timelineRVCAT       = JSON.parse(data)
      timelineRVCAT.portUsage = getPortUsage(timelineRVCAT);
      Object.assign(timeline, JSON.parse(JSON.stringify(timelineRVCAT))) // deep copy & fire draw-update
    } catch (error) {
      console.error('📈❌Failed to process JSON timeline:', error)
    }
  }

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleTimeline = null

  // Load from localStorage
  onMounted(() => {
    cleanupHandleTimeline = registerHandler('get_timeline', handleTimeline)
    addCanvasWrapper()
    console.log('📈🎯 Timeline Component mounted')
    try {    // generate timeline using RVCAT (if previous components are mounted)
      getTimelineAndDraw()
    } catch (error) {
      console.error('📈❌ Failed on timeline:', error)
    }
  });

  // Clean up on unmount
  onUnmounted(() => {
    if (cleanupHandleTimeline) {
      cleanupHandleTimeline()
      cleanupHandleTimeline = null
    }
  })

/* ------------------------------------------------------------------
* UI actions
* ------------------------------------------------------------------ */
  function togglePorts()  { timelineOptions.showPorts = !timelineOptions.showPorts }

  function getPortUsage(timeline) {
    const usage = {};
    for (const [iter, instrIdx, startCycle, port, states] of timeline.instructions) {
      const eIndex = states.indexOf("E");
      if (eIndex < 0) continue;
      const cycle = startCycle + eIndex;
      (usage[port] ??= []).push(cycle);
    }
    for (const p in usage) {
      usage[p].sort((a,b)=>a-b);
    }
    return usage;
  }

  function buildPortTimelineMatrix(timeline) {

    const portUsage = timeline.portUsage || getPortUsage(timeline);

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

  async function getTimelineAndDraw() {
    if (simState.state >= 3) {
      console.log('📈🔄 Request timeline from RVCAT')
      const { name, ROBsize, dispatch, retire, instruction_list } = simState.simulatedProcess
      await getTimeline(JSON.stringify( { name, ROBsize, dispatch, retire, instruction_list: toRaw(instruction_list)}, null, 2),
                        timelineOptions.iters) // Call Python RVCAT
    }
  }

  function addCanvasWrapper () {
    const wrapper = document.getElementById("canvas-container")
    let dragging  = false
    let startX, startY

    const observer = new ResizeObserver(() => {
      timelineOptions.iters = 0  // forces watcher to re-draw canvas with 1 iteration
    })

    observer.observe(wrapper)

    wrapper.addEventListener("mousedown", (e) => {
      dragging = true
      startX = e.clientX
      startY = e.clientY
    })

    window.addEventListener("mouseup", () => {
      dragging = false
    })

    wrapper.addEventListener("mousemove", (e) => {

      if (!dragging) return

      const dx = e.clientX - startX
      const dy = e.clientY - startY

      startX = e.clientX
      startY = e.clientY

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
  const clickedCellInfo  = ref(null)
  const interactiveCells = []
  let cellW       = 14
  let cellH       = 20
  let padX        = 10
  let padY        = 10
  let fontSize    = 14
  let fontXOffset = 2
  let fontYOffset = 3

  function drawTimeline() {

    const rect = timelineCanvas.value.getBoundingClientRect()
    timelineCanvas.value.width  = rect.width
    timelineCanvas.value.height = rect.height

    const { cycles, instructions, portUsage } = timeline

    let totalWidth =  padX + cellW * cycles
    let totalHeight = padY + cellH * (instructions.length+1)

    while (rect.width >= 2*totalWidth && rect.height >= 2*totalHeight) {
      cellW *=2; cellH *= 2; fontSize *= 2;
      fontXOffset *=2; fontYOffset *=2;
      totalWidth  =  padX + cellW * cycles
      totalHeight = padY + cellH * (instructions.length+1)
    }

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

    // First line: 0 1 2 3 ...   start on (0,0)
    let   x = padX
    const y = padY
    for (let i = 0; i < cycles; ) {
      let ch          = String(i % 10)
      ctx.fillStyle   = "#ffffff"
      ctx.strokeStyle = "#bbb"
      ctx.lineWidth   = 1
      ctx.fillRect    (x, y, cellW, cellH)
      ctx.strokeRect  (x, y, cellW, cellH)

      ctx.fillStyle = "#000"
      ctx.fillText    (ch, x + fontXOffset, y + fontYOffset)
      i++
      x += cellW
    }

    interactiveCells.length = 0   // empty list

    // ***************************************************************************************************
    //   for each instruction, then for each cycle, then write cell into canvas and push interactive cells
    // ***************************************************************************************************
    for (const [rowIdx, [iter, instrIdx, startCycle, port, states, critical_cycles]] of instructions.entries())
    {
      // Compute background color based on iteration number
      const rowBg = iter >= 0 ? `hsl(${(iter * 80) % 360}, 50%, 90%)` : "#ffffff";

      //  Draw line starting on (x,y)
      let   x = padX;
      const y = padY + (rowIdx+1) * cellH;

      for (let i = 0; i < cycles; ) {
        let ch        = ' '
        let currColor = "#000"

        // register interactive cell & check critical
        if (i >= startCycle && i < startCycle+states.length) {
          ch  = states[i-startCycle];
          let kind = 'instr'
          let critical         = critical_cycles.includes(i - startCycle)
          let first_exec_stage = (ch == 'E' && states[i-startCycle-1] != 'E')

          if (critical) currColor = "red"

          interactiveCells.push({
            kind, x, y,
            colIndexVis: i,
            char:        ch,
            critical,
            first_exec_stage,
            rowIdx,
            port,
            instrIdx
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

    // Attach mousemove to show hover info
    attachHover();
  }

  function drawHoverOverlay(oldX, oldY) {

    const { cycles, instructions, portUsage } = timeline

    let totalRows = instructions.length+1
    let totalCols = cycles

    const ctx = timelineCanvas.value.getContext('2d')
    ctx.save()

    // recover previous grid
    ctx.strokeStyle = "#bbb"
    ctx.lineWidth   = 1
    ctx.strokeRect( oldX, padY, cellW, totalRows * cellH )
    ctx.strokeRect( padX, oldY, totalCols * cellW, cellH )

    ctx.strokeStyle = "red"
    ctx.lineWidth   = 1
    ctx.strokeRect( timelineOptions.hoverPosX, padY, cellW, totalRows * cellH )
    ctx.strokeRect( padX, timelineOptions.hoverPosY, totalCols * cellW, cellH )
    ctx.restore()
  }

  function attachHover() {
    timelineCanvas.value.onmousemove = e => {
      const rect   = timelineCanvas.value.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const worldX = (mouseX - timelineOptions.canvasOffsetX) / timelineOptions.canvasScale
      const worldY = (mouseY - timelineOptions.canvasOffsetY) / timelineOptions.canvasScale

      let hitCell = null;
      for (const cell of interactiveCells) {
        if (
          worldX >= cell.x &&
          worldX <= cell.x + cellW &&
          worldY >= cell.y &&
          worldY <= cell.y + cellH
        ) {
          hitCell = cell;
          break;
        }
      }

      if (!hitCell) {
        hoverInfo.value = null;
        return;
      }

      let instrID = hitCell.instrID;
      if (simState.instrHighlightedIdx !== instrID) {
        simState.instrHighlightedIdx = instrID
      }

      // cycle is hitCell.colIndexVis


      let displayPort = null;
      if (hitCell.first_exec_stage) {
        displayPort = hitCell.port;
      }

      timelineOptions.hoverPosX = hitCell.x
      timelineOptions.hoverPosY = hitCell.y

      hoverInfo.value = {
        x:        e.clientX + 10,
        y:        e.clientY + 10,
        state:    charToProcessingState(hitCell.char, displayPort),
        critical: hitCell.critical
      };

      timelineCanvas.value.onclick = e => {
        const rect   = timelineCanvas.value.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = (mouseX - timelineOptions.canvasOffsetX) / timelineOptions.canvasScale
        const worldY = (mouseY - timelineOptions.canvasOffsetY) / timelineOptions.canvasScale

        for (const cell of interactiveCells) {
          if (
            worldX >= cell.x &&
            worldX <= cell.x + cellW &&
            worldY >= cell.y &&
            worldY <= cell.y + cellH
          ) {
            handleCellClick(cell.instrID, cell.colIndexVis);
            break;
          }
        }
      };

      // Flip tooltip if it overflows screen
      nextTick(() => {
        const tt = tooltipRef.value;
        if (!tt) return;
        const tr = tt.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let newX = hoverInfo.value.x;
        let newY = hoverInfo.value.y;

        if (tr.right > vw) {
          newX = e.clientX - tr.width - 10;
        }
        if (tr.bottom > vh) {
          newY = e.clientY - tr.height - 10;
        }
        if (newX !== hoverInfo.value.x || newY !== hoverInfo.value.y) {
          hoverInfo.value = { ...hoverInfo.value, x: newX, y: newY };
        }
      });
    };
  }

  async function handleCellClick(instrID, cycle) {
    const text = 'To DO';
    clickedCellInfo.value = { instrID, cycle, text };
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
          <span class="iters-label">Iterations:</span>
          <input type="number" min="1" max="9"  v-model.number="timelineOptions.iters"
            title="# loop iterations (1 to 9)"
            id="timeline-iterations">
        </div>

        <div class="iters-group">
          <button class="blue-button" :class="{ active: timelineOptions.showPorts }" :aria-pressed="timelineOptions.showPorts"
            title="Show/Hide Resource Usage"
            id="timeline-show-ports"
            @click="togglePorts">
            <span v-if="timelineOptions.showPorts">✔ </span>
            Port Usage
          </button>
        </div>
      </div>
    </div>

    <div class="output-block-wrapper" id="canvas-container">
      <canvas ref="timelineCanvas"></canvas>
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
                The number of <em>loop iterations</em> can be modified, and the timeline can be <strong>zoomed in/out</strong>.</p>
             <p><strong>Click</strong> on the timeline to activate it, then use the <strong>arrow keys</strong> to move left/right and up/down. Hover over the grid to see basic info about the selected cell, and <em>click</em> to obtain more detailed information.</p>"
       @close="closeHelp1" />
  </Teleport>

  <div v-if="clickedCellInfo" class="modal-overlay" @click.self="clickedCellInfo = null">
    <div class="modal">
      <div class="modal-header">
        Cell Info
        <button class="close-btn" @click="clickedCellInfo = null">x</button>
      </div>
      <p><strong>Instruction:</strong> {{ clickedCellInfo.instrID }}</p>
      <p><strong>Cycle:</strong>       {{ clickedCellInfo.cycle }}</p>
      <p>{{ clickedCellInfo.text }}</p>
    </div>
  </div>

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
    overflow: auto;
  }
  #canvas-container canvas {
    position: absolute;
    inset:    0;       /* top:0 left:0 right:0 bottom:0 */
    width:    100%;
    height:   100%;
    aspect-ratio: auto;
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
