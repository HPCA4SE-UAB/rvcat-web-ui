<script setup>
  import { ref, onMounted, nextTick, onUnmounted, watch} from 'vue';
  import TutorialComponent                               from '@/components/tutorialComponent.vue';

  let processorsListHandler;
  let programsListHandler;
  const canvasWidth    = 1200;
  const canvasHeight   = 10000;
  const hoverInfo      = ref(null);
  const timelineCanvas = ref(null);
  const tooltipRef     = ref(null);
  let timelineData     = ref(null);
  const showTutorial   = ref(false);
  const tutorialPosition = ref({ top: '50%', left: '50%' });
  const infoIcon        = ref(null);
  const clickedCellInfo = ref(null);

  function openTutorial() {
    nextTick(() => {
      const el = infoIcon.value
      if (el) {
        const r = el.getBoundingClientRect()
        tutorialPosition.value = {
          top:  `${r.bottom}px`,
          left: `${r.right}px`
        }
        showTutorial.value = true
      }
    })
  }

  function closeTutorial() {
    showTutorial.value = false
  }

  function getCookie(name) {
    const re = new RegExp(
      "(?:^|; )" +
        name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") +
        "=([^;]*)"
    );
    const match = document.cookie.match(re);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days = 30) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(
      value
    )}; max-age=${maxAge}; path=/`;
  }

  function useBooleanCookie(key, defaultValue = false) {
    const val = ref(defaultValue);

    onMounted(() => {
      const c = getCookie(key);
      if (c !== null) {
        val.value = c === '1';
      }
    });

    watch(val, (v) => {
      setCookie(key, v ? '1' : '0');
    });

    return val;
  }

  const iterations = ref(parseInt(getCookie("timelineIterations")) || 1);
  watch(iterations, (v) => setCookie("timelineIterations", v));

  const zoomLevel = ref(parseInt(getCookie("timelineZoom")) || 1);
  watch(zoomLevel, (v) => {
    if (timelineData.value) {
      drawTimeline(timelineData.value);
    }
    setCookie("timelineZoom", v);
  });

  const showPorts        = useBooleanCookie('showPorts', true);
  const showInstructions = useBooleanCookie('showInstructions', true);

  onMounted(() => {
    nextTick(async () => {
      const processorsList = document.getElementById("processors-list");
      if (processorsList) {
        processorsListHandler = () => {
          setTimeout(async () => {
            getTimelineAndDraw()
          }, 100);
        };
        processorsList.addEventListener("change", processorsListHandler);
      }
      const programsList = document.getElementById("programs-list");
      if (programsList) {
        programsListHandler = () => {
          setTimeout(async () => {
            getTimelineAndDraw()
          }, 100);
        };
        programsList.addEventListener("change", programsListHandler);
      }
      getTimelineAndDraw()
    });
  });

   function changeIterations(delta) {
    const input  = document.getElementById("dependencies-num-iters");
    const newVal = Math.min(Math.max(iterations.value + delta, 1), 50);
    iterations.value = newVal;
    input.value      = newVal;

    getTimelineAndDraw();
  }

  function toggleInstructions() {
    showInstructions.value = !showInstructions.value;
    if (timelineData.value) {
      drawTimeline(timelineData.value);
    }
  }

  function togglePorts() {
    showPorts.value = !showPorts.value;
    if (timelineData.value) {
      drawTimeline(timelineData.value);
    }
  }

  function drawTimeline(data) {
    const canvas  = timelineCanvas.value;
    const ctx     = canvas.getContext('2d');
    const cellW   = 14 * zoomLevel.value;
    const cellH   = 20 * zoomLevel.value;
    const padX    = 20 * zoomLevel.value;
    const padY    = 10 * zoomLevel.value;
    const fontSize = 14 * zoomLevel.value;
    const fontYOffset = 3 * zoomLevel.value;

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
    const visibleRows = filterVisibleRows(processed, rowPorts, showPorts.value);

    // Measure & resize canvas based on visibleRows and zoomLevel and show/hide instructions
    const measured = measureLines(visibleRows, showInstructions.value);
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
      showInstructions: showInstructions.value,
      interactiveCells
    });
  });

    // Attach mousemove to show hover info
    attachHover(canvas, interactiveCells, headerStart);
  }

  // get the esecution port of each instruction
  function extractRowInfo(rawLines) {
    const idToType = {};    // will map instrID → mnemonic string

    return rawLines.map(line => {
      // Get instruction number
      const idMatch = line.match(/^\s*\[\s*\d+\s*,\s*(\d+)\s*\]/);
      const instrID = idMatch ? idMatch[1] : null;

      // Get port and instruction type
      const m = line.match(/\(P\.(\d+)\)(?:\s*([A-Za-z0-9_.]+))?/);
      let portNumber = m ? m[1] : null;
      let type = (m && m[2]) ? m[2] : null;

      if(line.trim().startsWith("P")){
        const m = line.match(/^P\.?(\d+)/);
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
      let rest = line.slice(headerStart);
      if (rest.length < headerLen) {
        rest += " ".repeat(headerLen - rest.length);
      }
      labelPart = labelPart.replace(/\bP\.(\d)\b/, "P$1 ");
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
          const pre = line.slice(0, firstBracket);
          const core = line.slice(firstBracket, closeBracket + 1);
          const post = line.slice(closeBracket + 1);
          line = core + pre + post;
        }
      }

      let labelPart = line.slice(0, headerStart);
      let rest = line.slice(headerStart);
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
      const chars = [];
      const isRed = [];
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
      const keepFlags = new Array(headerLen).fill(true);
      let toRemove = falseCount;
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
  function measureLines(visibleRows, showInstructions) {
    const cleaned = visibleRows.map(({ raw }) => {
      let line    = raw;
      if (!showInstructions) {
        const rIdx = line.indexOf("R");
        if (rIdx > -1) line = line.slice(0, rIdx + 1);
      }
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
      let instrType = hitCell.instrType;
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
            instrType = match.instrType;
            instrID   = match.instrID;
          }
        }
      }

      // For instruction rows, only show port on first 'E'
      let displayPort = null;

      if (hitCell.kind === 'port') {
        displayPort = hitCell.port;
      } else if (
        hitCell.kind === 'instr' &&
        hitCell.char === 'E' &&
        isFirstE(interactiveCells, hitCell)
      ) {
        displayPort = hitCell.port;
      }

      hoverInfo.value = {
        x: e.clientX + 10,
        y: e.clientY + 10,
        cycle: hitCell.colIndexVis - headerStart,
        port:  displayPort != null ? displayPort : "N/A",
        state: hitCell.state ?? "N/A",
        type:  instrType ?? "N/A",
        instr: instrID ?? "N/A",
        kind: hitCell.kind,
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

  async function handleCellClick(instrID, cycle) {
    const text = await showCellInfo(instrID, cycle);
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
      case "E": msg += "Execution";    break;
      case "R": msg += "Retire";       break;
      case "D": msg += "Dispatch";     break;
      case "-": msg += "Waiting to retire"; break;
      case "W": msg += "Write back";   break;
      case ".": msg += "Waiting to execute due to dependencies"; break;
      case "*": msg += "Waiting to execute due to occupied ports"; break;
      case "!": msg += "Cache miss";   break;
      case "2": msg += "Secondary cache miss"; break;
      default:  msg = "N/A";                   break;
    }
    return msg;
  }

  async function getTimelineAndDraw() {
    if (typeof getTimeline === "function") {
      timelineData.value = await getTimeline();
      drawTimeline(timelineData.value);
    }
  }

  onUnmounted(() => {
    const processorsList = document.getElementById("processors-list");
    if (processorsList && processorsListHandler) {
      processorsList.removeEventListener("change", processorsListHandler);
    }

    const programsList = document.getElementById("programs-list");
    if (programsList && programsListHandler) {
      programsList.removeEventListener("change", programsListHandler);
    }
  });

</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="infoIcon" class="info-icon" @click="openTutorial" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <h3>Timeline</h3>
      </div>
      <div class="timeline-controls">
        <div class="simulation-results-controls-item">
          <label for="dependencies-num-iters" style="margin-right: 2px;">
            Iterations:
          </label>
          <div class="iterations-group">
            <button type="button" class="gray-button" @click="changeIterations(-1)">-</button>
            <input class="input-simulation-result iterations-input" type="number" id="dependencies-num-iters" name="dependencies-num-iters" min="1" max="50" @change="getTimelineAndDraw" v-model.number="iterations"/>
            <button type="button" class="gray-button" @click="changeIterations(1)">+</button>
          </div>
        </div>
        <button class="blue-button" @click="zoomLevel = Math.max(0.25, zoomLevel - 0.25)" :disabled="zoomLevel==0.25"><img src="/img/zoom-out.png"></button>
        <button class="blue-button" @click="zoomLevel = Math.min(2, zoomLevel + 0.25)" :disabled="zoomLevel==2"><img src="/img/zoom-in.png"></button>
        <button @click="toggleInstructions" class="blue-button">{{ showInstructions ? 'Hide' : 'Show' }} Instructions</button>
        <button @click="togglePorts" class="blue-button">{{ showPorts ? 'Hide' : 'Show' }} Ports</button>
      </div>

    </div>
    <div class="output-block-wrapper" id="simulation-output-container">
      <section class="simulation-results-controls" id="dependencies-controls">
      </section>
      <canvas ref="timelineCanvas" :width="canvasWidth" :height="canvasHeight"></canvas>
      <div v-if="hoverInfo" ref="tooltipRef" class="tooltip" :style="{ top: hoverInfo.y + 'px', left: hoverInfo.x + 'px' }">
        <div><strong>Cycle: </strong> {{ hoverInfo.cycle }}</div>
        <div v-if="hoverInfo.instr!='N/A'"><strong>Instruction:</strong> {{ hoverInfo.instr }}</div>
        <div v-if="hoverInfo.type!='N/A'"><strong>Type:</strong> {{ hoverInfo.type }}</div>
        <div v-if="hoverInfo.state!='N/A'"><strong>State:</strong> {{ hoverInfo.state }}</div>
        <div v-if="hoverInfo.port!='N/A'"><strong>Port:</strong> P{{ hoverInfo.port }}</div>
        <div v-if="hoverInfo.kind==='mem'">Block read from main memory</div>
      </div>
    </div>
  </div>
  <TutorialComponent 
     v-if="showTutorial" 
     :position="tutorialPosition"
     title="Timeline"

    text= "<p>The <strong>Timeline</strong> section shows the program execution over time. 
              The number of <em>loop iterations</em> can be modified, and the timeline can be <strong>zoomed in/out</strong>.</p>
           <p>Hover over the grid to see basic info about the selected cell, and <em>click</em> to obtain more detailed information.</p>"
     @close="closeTutorial"
  />
  
  <div v-if="clickedCellInfo" class="modal-overlay" @click.self="clickedCellInfo = null">
    <div class="modal">
      <div class="modal-header">
        <h3>Cell Info</h3>
        <button class="close-btn" @click="clickedCellInfo = null">x</button>
      </div>
      <p><strong>Instruction:</strong> {{ clickedCellInfo.instrID }}</p>
      <p><strong>Cycle:</strong> {{ clickedCellInfo.cycle }}</p>
      <p>{{ clickedCellInfo.text }}</p>
    </div>
  </div>
</template>

<style scoped>
  .main{
    height:100%;
    width:100%;
    background: white;
    overflow:auto;
    padding:5px;
    border-radius: 10px;
  }
  .header{
    position:sticky;
    padding-top:2px;
    top:-5px;
    background:white;
    width:100%;
    left:0;
    padding-bottom:5px;
  }
  h3 {
  margin: 0;
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

  .header{
    position:sticky;
    top:-5px;
    background:white;
    width:100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .timeline-controls {
    display:flex;
    gap:5px;
  }

  .iterations-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-right:5px;
  }

  .iterations-input {
    width: 5vh;
    padding: 2px;
    text-align: center;
    -moz-appearance: textfield;
  }
  .iterations-input::-webkit-outer-spin-button,
  .iterations-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .close-btn {
    align-self: flex-end;
    background: none;
    border: none;
    font-size: 3vh;
    cursor: pointer;
    margin-bottom: 8px;
  }
</style>
