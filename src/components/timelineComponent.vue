<script setup>
  import { ref, toRaw, onMounted, nextTick, onUnmounted, watch, inject, reactive} from 'vue'
  import HelpComponent                                 from '@/components/helpComponent.vue'
  import { downloadJSON, uploadJSON }                                        from '@/common'
  import { useRVCAT_Api }                                                  from '@/rvcatAPI'

  const { getTimeline }     = useRVCAT_Api()
  const { registerHandler } = inject('worker')
  const simState            = inject('simulationState')

  /* ------------------------------------------------------------------
   * Timeline options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'timelineOptions'
  const defaultOptions = {
    iters:     1,
    zoomLevel: 1,
    showPorts: false
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
      cycles:       10,
      instructions: [ [0, 0, 0, "0", "DEWR", [0,1]],
                      [0, 1, 1, "0", "DEWR", [1]],
                      [0, 2, 2, "1", "DEWR", [1]],
                      [1, 0, 3, "0", "DEWR", [1]],
                      [1, 1, 4, "0", "DEWR", [1]],
                      [1, 2, 5, "1", "DEWR", [1,2,3]]
                    ],
      portUsage:    { "0": [1,2,4,5], "1": [3,6] }
    };
  }

  const timeline       = reactive(createDefaultTimeline())  // DICT object from JSON
  const timelineText   = ref(null);                         // Text from RVCAT
  const timelineCanvas = ref(null);

// ============================================================================
// WATCHES: timelineOptions, simulatedProcess  HANDLERS: getTimeline
// ============================================================================
  let lastTimelineIters     = 1

  // Watch ALL graph options for changes
  watch(timelineOptions, () => {
    let canvasTimeout = null
    clearTimeout(canvasTimeout)
    try {
      timelineOptions.iters = Math.min(timelineOptions.iters, 9);
      timelineOptions.iters = Math.max(timelineOptions.iters, 1);
      saveOptions()

      if (lastTimelineIters !== timelineOptions.iters) {
        lastTimelineIters = timelineOptions.iters
        timelineText.value = null
      }

      // OLD way: use timeline Text
      canvasTimeout = setTimeout(() => {
        if (timelineText.value)
          drawTimelineText(timelineText.value);
        else
          getTimelineAndDraw()
      }, 75)
      console.log('📈✅ Modified timeline options')
    } catch (error) {
      console.error('📈❌Failed to save dependence graph options:', error)
    }
  },
  { deep: true, immediate: true })

  watch ([() => simState.simulatedProcess], () => { getTimelineAndDraw() },
  { deep: true, immediate: false })

  watch(timeline, () => {
    if (timelineCanvas.value && timeline)
      try {
        localStorage.setItem('timelineTemp', JSON.stringify(timeline));
        console.log('📈✅ Draw Timeline with dict')
        drawTimeline()
      } catch (error) {
        console.error('💻❌ Failed to handle changes on processor configuration:', error)
      }
  },
  { deep: true, immediate: true })

  // Handler for 'get_timeline' message (fired by RVCAT getTimeline function)
  const handleTimeline = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('📈❌Failed to get timeline:', data);
      return;
    }
    try {
      console.log('📈✅ Draw Timeline with text')
      timelineText.value = data
      drawTimelineText(data);
    } catch (error) {
      console.error('📈❌Failed to obtain execution results:', error)
    }
  }

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleTimeline = null

  // Load from localStorage
  onMounted(() => {
    cleanupHandleTimeline = registerHandler('get_timeline', handleTimeline);
    console.log('📈🎯 Timeline Component mounted')

    // load stored timeline
    const stored = localStorage.getItem('timelineTemp');
    if (stored) {
      try {
        const data = JSON.parse(stored)
        updateTimeline(data)
        return
      } catch (e) {
        console.error('📈❌ Failed to load timeline from localStorage:', e);
      }
    }

    try {    // generate timeline using RVCAT
      if (!timelineText.value && simState.state >= 3)  // on mount
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
  function zoomReduce()   { timelineOptions.zoomLevel = Math.min(timelineOptions.zoomLevel + 1, 6) }
  function zoomIncrease() { timelineOptions.zoomLevel = Math.max(timelineOptions.zoomLevel - 1, 1) }

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

  async function updateTimeline(timelineDict) {
     try {
      timelineDict.portUsage = getPortUsage(timelineDict);
      Object.assign(timeline, JSON.parse(JSON.stringify(timelineDict)))   // deep copy & fire draw-update
      console.log('📈🔄 timeline updated.', timeline)
    } catch(e) {
      timeline = createDefaultTimeline()
      console.error("📈❌ Failed to update timeline:", e);
    }
  }

  async function getTimelineAndDraw() {
    if (simState.state >= 3) {
      console.log('📈🔄 Request timeline from RVCAT')
      const { name, ROBsize, dispatch, retire, instruction_list } = simState.simulatedProcess
      await getTimeline(JSON.stringify( { name, ROBsize, dispatch, retire, instruction_list: toRaw(instruction_list)}, null, 2),
                        timelineOptions.iters) // Call Python RVCAT
    }
  }

// ============================================================================
// confirmDownload, uploadTimeline
// ============================================================================

  const showModalDownload = ref(false)
  const modalName         = ref("")
  const nameError         = ref("")

  async function confirmDownload() {
    const name   = modalName.value.trim();
    const stored = localStorage.getItem('timelineTemp');
    if (stored) {
      const data = JSON.parse(stored)
      data.name  = name
      await downloadJSON(data, name, 'timeline')
    }
    showModalDownload.value = false;
  }

  const uploadTimeline = async () => {
    try {
      const data = await uploadJSON(null, 'timeline');
      if (data) {
        data.portUsage = getPortUsage(data);
        Object.assign(timeline, JSON.parse(JSON.stringify(data)))   // deep copy & fire draw-update
        console.log('📈🔄 timeline updated.', timeline)
        return;
      }
    } catch (error) {
      console.error('📈❌ Failed on upload:', error)
    }
  };


/* ------------------------------------------------------------------
 * CANVAS: DRAW timeline (using RVCAT text)
 * ------------------------------------------------------------------ */
  const canvasWidth    = 1200;
  const canvasHeight   = 10000;
  const hoverInfo      = ref(null);
  const tooltipRef     = ref(null);

  // const infoIcon        = ref(null);
  const clickedCellInfo = ref(null);

  function drawTimeline() {
    const Zoom        = (1+timelineOptions.zoomLevel)/4;
    const canvas      = timelineCanvas.value;
    const ctx         = canvas.getContext('2d');
    const cellW       = 14 * Zoom;
    const cellH       = 20 * Zoom;
    const padX        = 20 * Zoom;
    const padY        = 10 * Zoom;
    const fontSize    = 14 * Zoom;
    const fontYOffset =  3 * Zoom;

    const { cycles, instructions, portUsage } = timeline.value

    canvas.width  = padX * 2 + cycles * cellW;
    canvas.height = padY * 2 + instructions.length * cellH;

    // Draw each row + build interactiveCells
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font                  = `${fontSize}px monospace`;
    ctx.textBaseline          = 'top';
    ctx.imageSmoothingEnabled = false;

    const interactiveCells = [];
    for (const [rowIdx, [iter, instrIdx, startCycle, port, states, critical_cycles]] of instructions.entries())
    {
      // Compute background color based on iteration number
      const rowBg = iter >= 0 ? `hsl(${(iter * 80) % 360}, 50%, 90%)` : "#ffffff";

      //  Draw line starting on (x,y)
      let   x    = padX;
      const y    = padY + rowIdx * cellH;

      for (let i = 0; i < cycles; ) {
        let ch        = ' '
        let currColor = "#000"

        // If belongs to state: register interactive cell & check critical
        if (i >= startCycle && i < startCycle+states.length) {

          ch  = states[i-startCycle];

          let kind='instr';

          interactiveCells.push({ kind, x, y,
            width:      cellW,
            height:     cellH,
            char:       ch,
            rowIdx,
            colIndexVis: i,
            port,
            state:       charToState(ch),
            instrIdx
          });
          // if critical currColor = ansiMatch[1] === "91" ? "red" : "#000";
        }

        ctx.fillStyle   = rowBg;
        ctx.strokeStyle = "#bbb";
        ctx.lineWidth   = 1;
        ctx.fillRect    (x, y, cellW, cellH);
        ctx.strokeRect  (x, y, cellW, cellH);

        ctx.fillStyle = currColor;
        ctx.fillText    (ch, x + 2, y + fontYOffset);

        i++;
        x += cellW;
      }
    }

    // Attach mousemove to show hover info
    attachHover(canvas, interactiveCells, 0);
  }

  function drawTimelineText(data) {
    const Zoom        = (1+timelineOptions.zoomLevel)/4;
    const canvas      = timelineCanvas.value;
    const ctx         = canvas.getContext('2d');
    const cellW       = 14 * Zoom;
    const cellH       = 20 * Zoom;
    const padX        = 20 * Zoom;
    const padY        = 10 * Zoom;
    const fontSize    = 14 * Zoom;
    const fontYOffset =  3 * Zoom;

    // Split raw lines and extract port info
    const rawLines = data.split('\n');
    const rowPorts = extractRowInfo(rawLines);

    // Parse header (to find headerStart, headerMask, cycleCount)
    const { headerStart, headerMask, cycleCount } = parseHeader(rawLines);
    if (headerStart === null) {
      console.error("drawTimeline: no header line found.");
      return;
    }
    const headerLen = headerMask.length;

    // Produce processed lines
    const processed = rawLines.map(line =>
      collapseLine(line, headerStart, headerLen, headerMask)
    );

    // Filter out port rows, compute visibleRows[]
    const visibleRows = filterVisibleRows(processed, rowPorts, timelineOptions.showPorts);

    // Measure & resize canvas based on visibleRows and zoomLevel and show/hide instructions
    const measured = measureLines(visibleRows);
    canvas.width  = padX * 2 + measured.maxCols * cellW;
    canvas.height = padY * 2 + visibleRows.length * cellH;

    // Draw each row + build interactiveCells
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = false;

    const interactiveCells = [];
    visibleRows.forEach(({ raw, instrID, portNumber, type }, rowIndex) => {
      drawOneRow({
        ctx,
        raw,
        port: portNumber,
        instrType: type,
        instrID,
        rowIndex,
        padX, padY, cellW, cellH,
        headerStart, cycleCount,
        fontYOffset,
        interactiveCells
      });
    });

    // Attach mousemove to show hover info
    attachHover(canvas, interactiveCells, headerStart);
  }

  // get the execution port of each instruction
  function extractRowInfo(rawLines) {
    const idToType = {};    // will map instrID → mnemonic string

    return rawLines.map(line => {
      // Get instruction number
      const idMatch = line.match(/^\s*\[\s*\d+\s*,\s*(\d+)\s*\]/);
      const instrID = idMatch ? idMatch[1] : null;

      // Get port and instruction type
      const m          = line.match(/\(P\.(\d+)\)(?:\s*([A-Za-z0-9_.]+))?/);
      let   portNumber = m ? m[1] : null;
      let   type       = (m && m[2]) ? m[2] : null;

      if(line.trim().startsWith("P")){
        const    m = line.match(/^P\.?(\d+)/);
        portNumber = parseInt(m[1]);
      }

      // Store type if instruction does have it
      if (instrID !== null && type !== null) {
        idToType[instrID] = type;
      }

      // Reuse type if not in first
      if (instrID !== null && type === null && idToType[instrID]) {
        type = idToType[instrID];
      }

      return { instrID, portNumber, type };
    });
  }

  // Parse header to get its beggining, end and deleted whitespaces
  function parseHeader(lines) {

    let headerStart = null;
    let headerMask  = null;
    let cycleCount  = 0;

    for (const line of lines) {
      const m = line.match(/^(\s*)([0-9 ]+)(\s*)$/);
      if (!m) continue;

      headerStart = m[1].length;
      const digitsSeq = m[2];
      headerMask = Array.from(digitsSeq, ch => /\d/.test(ch));
      cycleCount = headerMask.filter(b => b).length;
      break;
    }

    return {
      headerStart,
      headerMask: headerMask || [],
      cycleCount
    };
  }

  // Collapse lines to delete single whitespaces and align graph
  function collapseLine(origLine, headerStart, headerLen, headerMask) {
    let line = origLine;

    // Case A: Header line (remove spaces in between digits)
    const headerMatch = line.match(/^(\s*)([0-9 ]+)(\s*)$/);
    if (headerMatch) {
      const prefix = headerMatch[1];
      const middle = headerMatch[2].replace(/ /g, "");
      const suffix = headerMatch[3];
      return prefix + middle + suffix;
    }

    // Case B: Port‐usage line (remove spaces in same positions as header)
    if (line.trim().startsWith("P") || line.trim().startsWith("MM")) {
      let labelPart = line.slice(0, headerStart);
      let rest      = line.slice(headerStart);
      if (rest.length < headerLen) {
        rest += " ".repeat(headerLen - rest.length);
      }
      labelPart     = labelPart.replace(/\bP\.(\d)\b/, "P$1 ");
      let collapsed = "";
      for (let i = 0; i < headerLen; i++) {
        if (headerMask[i]) {
          collapsed += rest[i] || " ";
        }
      }
      if (rest.length > headerLen) {
        collapsed += rest.slice(headerLen);
      }
      return labelPart + collapsed;
    }

    // Case C: Instruction line (remove spaces in same positions as header(ignoring ANSI labels))
    const instrMatch = line.match(/^(\s*\[[^\]]+\]\s*)(.*)$/);
    if (instrMatch) {

      // Reposition [] labels to start of line
      const firstBracket = line.indexOf('[');
      if (firstBracket !== -1) {
        const closeBracket = line.indexOf(']', firstBracket);
        if (closeBracket !== -1) {
          const pre  = line.slice(0, firstBracket);
          const core = line.slice(firstBracket, closeBracket + 1);
          const post = line.slice(closeBracket + 1);
          line = core + pre + post;
        }
      }

      let labelPart = line.slice(0, headerStart);
      let rest      = line.slice(headerStart);
      if (rest.length < headerLen) {
        rest += " ".repeat(headerLen - rest.length);
      }

      // Find first “R” position (raw index)
      let retireIdx = rest.indexOf("R");
      if (retireIdx === -1) retireIdx = rest.length - 1;

      // Advance past any ANSI after the “R”
      let afterRetire = retireIdx + 1;
      if (rest.charAt(afterRetire) === "\x1b") {
        const ansiMatch = rest.slice(afterRetire).match(/^\x1b\[(\d+)m/);
        if (ansiMatch) afterRetire += ansiMatch[0].length;
      }

      const timelineRaw = rest.slice(0, afterRetire);
      let comment = rest.slice(afterRetire).replace(/^\s*/, " ");

      // Collect exactly headerLen visible chars, tracking red ANSI
      const chars   = [];
      const isRed   = [];
      let idx       = 0;
      let currColor = null;
      while (idx < timelineRaw.length && chars.length < headerLen) {
        if (timelineRaw[idx] === "\x1b") {
          const ansiMatch = timelineRaw.slice(idx).match(/^\x1b\[(\d+)m/);
          if (ansiMatch) {
            currColor = (ansiMatch[1] === "91") ? "red" : null;
            idx += ansiMatch[0].length;
            continue;
          }
          idx++;
          continue;
        }
        chars.push(timelineRaw[idx]);
        isRed.push(currColor === "red");
        idx++;
      }
      while (chars.length < headerLen) {
        chars.push(" ");
        isRed.push(false);
      }

      // Determine how many false‐columns to drop under headerMask=false
      const falseCount = headerMask.reduce((s, keep) => s + (keep ? 0 : 1), 0);
      const keepFlags  = new Array(headerLen).fill(true);
      let   toRemove   = falseCount;
      for (let i = 0; i < headerLen && toRemove > 0; i++) {
        if (!headerMask[i] && chars[i] === " ") {
          keepFlags[i] = false;
          toRemove--;
        }
      }
      if (toRemove > 0) {
        for (let i = 0; i < headerLen && toRemove > 0; i++) {
          if (!headerMask[i] && keepFlags[i] && chars[i] === " ") {
            keepFlags[i] = false;
            toRemove--;
          }
        }
      }

      // Rebuild collapsed timeline (with ANSI for red)
      let collapsed = "";
      for (let i = 0; i < headerLen; i++) {
        if (keepFlags[i]) {
          const ch = chars[i];
          collapsed += isRed[i] ? `\x1b[91m${ch}\x1b[0m` : ch;
        }
      }
      const idP = comment.indexOf("(");
      if (idP !== -1) {
        comment = comment.slice(0, idP).trimEnd();
      }

      if (comment.length > 1) {
        const firstChar = comment.charAt(0);
        const restChars = comment.slice(1).replace(/ /g, "");
        comment = firstChar + restChars;
      }

      const idxBracket = labelPart.indexOf('[');
      if (idxBracket !== -1 && labelPart[idxBracket + 1] === ' ') {
        // Remove only the single space immediately after “[”
        labelPart =
          labelPart.slice(0, idxBracket + 1) +
          labelPart.slice(idxBracket + 2);
      }
      return labelPart + collapsed + " " + comment;
    }

    // Case D: Anything else
    return line;
  }

  function filterVisibleRows(processedLines, rowInfo, showPorts) {
    const visible = [];
    for (let i = 0; i < processedLines.length; i++) {
      const line = processedLines[i];
      const { instrID, portNumber, type } = rowInfo[i];

      if (!showPorts) {
        const t = line.trim();
        if (t.startsWith("P") || t.startsWith("MM") || i === 0) {
          continue;
        }
      }
      visible.push({
        raw:  line,
        instrID,
        portNumber,
        type
      });
    }
    return visible;
  }

  // Remove instructions if necessary and compute canvas size
  function measureLines(visibleRows) {
    const cleaned = visibleRows.map(({ raw }) => {
      let line   = raw;
      const rIdx = line.indexOf("R");
      if (rIdx > -1) line = line.slice(0, rIdx + 1);
      return line.replace(/\x1b\[91m/g, "").replace(/\x1b\[0m/g, "");
    });
    const maxCols = cleaned.reduce((mx, l) => Math.max(mx, l.length), 0);
    return { maxCols, lines: cleaned };
  }

  // Draw row of timeline canvas element
  function drawOneRow({
    ctx, raw, port, instrType, instrID, rowIndex,
    padX, padY, cellW, cellH,
    headerStart, cycleCount,fontYOffset,
    interactiveCells
  }) {
    // Compute visible‐column indices of first “D” and first “R”
    const { dVisIdx, rVisIdx } = computeDandRIdxs(raw);

    // Compute background color based on iteration number
    let iteration = -1;
    const m = raw.match(/^\s*\[\s*(\d+),/);
    if (m) iteration = parseInt(m[1], 10);
    const rowBg = iteration >= 0 ? `hsl(${(iteration * 80) % 360}, 50%, 90%)` : "#ffffff";

    // Draw each character
    let visCol = 0;
    let x      = padX;
    const y    = padY + rowIndex * cellH;
    let currColor = "#000";

    for (let i = 0; i < raw.length; ) {
      // Handle ANSI sequences to change character color
      if (raw[i] === "\x1b") {
        const ansiMatch = raw.slice(i).match(/^\x1b\[(\d+)m/);
        if (ansiMatch) {
          currColor = ansiMatch[1] === "91" ? "red" : "#000";
          i += ansiMatch[0].length;
          continue;
        }
        i++;
        continue;
      }

      visCol++;
      const colIdxVis = visCol - 1;
      const ch        = raw[i];

      // Draw grid
      if (colIdxVis >= headerStart && colIdxVis < headerStart + cycleCount) {
        ctx.fillStyle   = rowBg;
        ctx.strokeStyle = "#bbb";
        ctx.lineWidth   = 1;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeRect(x, y, cellW, cellH);
        let kind;
        if(raw.trim().startsWith("P")){
          kind='port';
        } else if(raw.trim().startsWith("MM")){
          kind='mem';
        } else {
          kind='instr';
        }
        // Register interactive cell
        if ((colIdxVis >= dVisIdx && colIdxVis <= rVisIdx) || (kind==='port' && ch==="X") || (kind==='mem' && ch==="#")) {
          interactiveCells.push({
            kind,
            x, y,
            width:      cellW,
            height:     cellH,
            char:       ch,
            rowIndex,
            colIndexVis: colIdxVis,
            port,
            instrType,
            state:      charToState(ch),
            instrID
          });
        }
      }

      // Draw char
      ctx.fillStyle = currColor;
      ctx.fillText(ch, x + 2, y + fontYOffset);

      i++;
      x += cellW;
    }
  }

  // Get index of D and R
  function computeDandRIdxs(raw) {
    let dVisIdx = Infinity;
    let rVisIdx = -1;
    let tmpVis  = 0;
    let i       = 0;

    while (i < raw.length) {
      if (raw[i] === "\x1b") {
        const ansiMatch = raw.slice(i).match(/^\x1b\[(\d+)m/);
        if (ansiMatch) {
          i += ansiMatch[0].length;
          continue;
        }
        i++;
        continue;
      }
      const ch = raw[i];
      if (ch === "D" && dVisIdx === Infinity) {
        dVisIdx = tmpVis;
      }
      if (ch === "R" && rVisIdx === -1) {
        rVisIdx = tmpVis;
      }
      tmpVis++;
      i++;
    }
    return { dVisIdx, rVisIdx };
  }

  // Attach hover and click event to cells
  function attachHover(canvas, interactiveCells, headerStart) {
    canvas.onmousemove = e => {
      const rect   = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let hitCell = null;
      for (const cell of interactiveCells) {
        if (
          mouseX >= cell.x &&
          mouseX <= cell.x + cell.width &&
          mouseY >= cell.y &&
          mouseY <= cell.y + cell.height
        ) {
          hitCell = cell;
          break;
        }
      }

      if (!hitCell) {
        hoverInfo.value = null;
        return;
      }
      let instrID   = hitCell.instrID;
      // If it is a Port cell, find which instruction the X corresponds to
      if (hitCell.kind === 'port') {
        if (hitCell.char === 'X') {
          // find the instr cell in the same cycle & same port, with char 'E'
          const match = interactiveCells.find(c =>
            c.kind == 'instr' &&
            c.port == hitCell.port &&
            c.colIndexVis == hitCell.colIndexVis &&
            c.char == 'E' && isFirstE(interactiveCells, c)
          );
          if (match){
            instrID   = match.instrID;
          }
        }
      }

      // For instruction rows, only show port on first 'E'
      let displayPort = null;

      if (hitCell.char === 'E' && isFirstE(interactiveCells, hitCell)) {
        displayPort = hitCell.port;
      }

      hoverInfo.value = {
        x: e.clientX + 10,
        y: e.clientY + 10,
        cycle: hitCell.colIndexVis - headerStart,
        port:  displayPort != null ? displayPort : "N/A",
        state: hitCell.state ?? "N/A",
        instr: instrID ?? "N/A",
        kind:  hitCell.kind,
      };

      canvas.onclick = e => {
        const rect   = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        for (const cell of interactiveCells) {
          if (
            mouseX >= cell.x &&
            mouseX <= cell.x + cell.width &&
            mouseY >= cell.y &&
            mouseY <= cell.y + cell.height
          ) {
            handleCellClick(cell.instrID, cell.colIndexVis - headerStart);
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

  async function showCellInfo(instrID, cycle) {
  }

  async function handleCellClick(instrID, cycle) {
    //TO DO: Create Python function that returs additional info
    const text = 'To DO';
    clickedCellInfo.value = { instrID, cycle, text };
  }

  function isFirstE(interactiveCells, cell) {
    return interactiveCells
      .filter(c => c.rowIndex === cell.rowIndex && c.char === 'E')
      .every(other => other.colIndexVis >= cell.colIndexVis);
  }

  // Get state from char in cell
  function charToState(ch) {
    let msg="";
    switch (ch) {
      case "E": msg += "Execution";         break;
      case "R": msg += "Retire";            break;
      case "D": msg += "Dispatch";          break;
      case "-": msg += "Waiting to retire"; break;
      case "W": msg += "Write back";        break;
      case ".": msg += "Waiting due to dependencies";   break;
      case "*": msg += "Waiting due to port collision"; break;
      case "!": msg += "Cache miss";           break;
      case "2": msg += "Secondary cache miss"; break;
      default:  msg = "N/A";                   break;
    }
    return msg;
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
          <button class="blue-button" :class="{ active: timelineOptions.zoomLevel > 1 }" :disabled="timelineOptions.zoomLevel == 1"
              title="Zoom Out (6 levels)" id="timeline-zoom-out"
              @click="zoomIncrease">
              <img src="/img/zoom-out.png">
          </button>
          <button class="blue-button" :class="{ active: timelineOptions.zoomLevel < 6 }" :disabled="timelineOptions.zoomLevel == 6"
              title="Zoom In (6 levels)" id="timeline-zoom-in"
              @click="zoomReduce">
              <img src="/img/zoom-in.png">
          </button>
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

        <div class="iters-group">
          <button class="blue-button"
            id="timeline-download-button"
            title="Save timeline"
            @click="showModalDownload = true">
            Download
          </button>
          <button class="blue-button"
            id="timeline-upload-button"
            title="Upload timeline"
            @click="uploadTimeline()">
            Upload
          </button>

        </div>

      </div>
    </div>

    <div class="output-block-wrapper" id="simulation-output-container">
      <section class="simulation-results-controls" id="dependencies-controls"></section>
      <canvas ref="timelineCanvas" :width="canvasWidth" :height="canvasHeight"></canvas>

      <div v-if="hoverInfo" ref="tooltipRef" class="tooltip" :style="{ top: hoverInfo.y + 'px', left: hoverInfo.x + 'px' }">
        <div><strong>Cycle: </strong> {{ hoverInfo.cycle }}</div>
        <div v-if="hoverInfo.instr!='N/A'"><strong>Instruction:</strong> {{ hoverInfo.instr }}</div>
        <div v-if="hoverInfo.type!='N/A'"> <strong> Type:</strong> {{ hoverInfo.type }}</div>
        <div v-if="hoverInfo.state!='N/A'"><strong>State:</strong> {{ hoverInfo.state }}</div>
        <div v-if="hoverInfo.port!='N/A'"> <strong> Port:</strong> P{{ hoverInfo.port }}</div>
        <div v-if="hoverInfo.kind==='mem'">Block read from main memory</div>
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

  <div v-if="showModalDownload" class="modal-overlay">
    <div class="modal">
      <h4>Save Timeline As</h4>
      <label for="timeline-name">Name:</label>
      <input v-model="modalName" type="text" id="save-timeline-name"
           title="file name of timeline"
        />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Accept Download" @click="confirmDownload"> Yes </button>
        <button class="blue-button" title="Cancel Download"   @click="showModalDownload=false">  Cancel </button>
      </div>
    </div>
  </div>


</template>

<style scoped>
  .output-block-wrapper {
    overflow-x: auto;
    overflow-y: auto;   /* opcional */
    width:      100%;
    height:     100%;
    position:   relative;
  }
  .output-block-wrapper canvas {
    display:    inline-block;
    width:      auto;
    height:     auto;
    max-width:  none;
    max-height: none;
  }

  .grid-item {
    min-width: 0;
  }

  .results {
    min-width: 0;
    overflow-x: auto;
  }

  .tooltip {
    position: fixed;
    background: #f9f9f9;
    border: 1px solid #ccc;
    padding: 8px;
    border-radius: 4px;
    pointer-events: none;
    z-index: 10;
    font-size: 2vh;
    width: 10%;
  }

  .timeline-controls {
    display:     flex;
    align-items: center;
    gap:         8px;
    margin-left: auto;
    min-width:   0;
  }
  .iters-group input[type="number"] { width: 4ch; }

  .graph-toolbar {
    display:     flex;
    align-items: center;
    gap:         8px;
    width:       100%;
    box-sizing:  border-box;
    overflow:    hidden;
    min-width:   0;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .close-btn {
    align-self: flex-end;
    background: none;
    border:     none;
    font-size:  3vh;
    cursor:     pointer;
    margin-bottom: 8px;
  }
</style>
