<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, watch, reactive } from "vue";
  import HelpComponent from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';
 
  const { getExecutionResults } = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

 /* ------------------------------------------------------------------ 
   * Simulation Results options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'simulationOptions'

  const defaultOptions = {
    iters:        1,
    showCritical: false
  }
  
  const savedOptions = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      console.log('🕐load options')
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const simulationOptions = reactive({ ...defaultOptions, ...savedOptions })

  let executionResults      = {}
  let cleanupHandleResults  = null
  let executionGraphDotCode = null
  let resultsTimeout        = null
  
  // Save on changes
  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(simulationOptions))
    } catch (error) {
      console.error('🕐❌ Failed to save:', error)
    }
  }
  
  // Load from localStorage
  onMounted(() => {
    cleanupHandleResults  = registerHandler('get_execution_results', handleResults);
    console.log('🕐🎯 SimulationComponent mounted')
  
    try {    // Load from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(simulationOptions, JSON.parse(saved))
      }
    } catch (error) {
      console.error('🕐❌ Failed to load:', error)
    }
  });

  // Clean up on unmount
  onUnmounted(() => {
     if (cleanupHandleResults) {
        cleanupHandleResults();
        cleanupHandleResults = null
     }
    })

 // Handler for 'get_execution_results' message (fired by RVCAT getPerformanceAnalysis function)
  const handleResults = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('🕐❌Failed to get execution results:', data);
      return;
    }
    try {
      console.log('🕐✅ Execution Results received')
      executionResults = data
      let d = JSON.parse(data);
      if (d['data_type'] === 'error') {
          alert('Error running simulation');
          document.getElementById('run-simulation-spinner').style.display = 'none';
          document.getElementById('simulation-running').style.display     = 'none';
          document.getElementById('critical-path-section').style.display  = 'block';
          document.getElementById('run-simulation-button').disabled       = false;
          return;
      }
      document.getElementById('instructions-output').innerHTML = d["total_instructions"];
      document.getElementById('cycles-output').innerHTML       = d["total_cycles"];
      document.getElementById('IPC-output').innerHTML          = d["ipc"].toFixed(2);
      document.getElementById('cycles-per-iteration-output').innerHTML = d["cycles_per_iteration"].toFixed(2);
      document.getElementById('critical-path').innerHTML       = createCriticalPathList(d['critical_path']);

      let dispatch= 2
      let retire  = 2
      let execute = 3
      let usage = {}
      usage['dispatch'] = (d["ipc"] / dispatch) * 100;
      usage['retire']   = (d["ipc"] / retire)   * 100;
      usage.ports       = {}
      let i = 0;
      // let keys = Object.keys(processorInfo.ports);
      let keys = ["P0", "P1", "P2"]
      for (let key of keys) {
          usage.ports[i] = d.ports[key];
          i++;
      }
      /* createProcessorSimulationGraph(
          processorInfo.stages.dispatch, 
          Object.keys(processorInfo.ports).length, 
          processorInfo.stages.retire, 
          usage);
       */
      
      // fullGraphDotCode = get_execution_processor_dot(dispatch, execute, retire, simState.ROBsize, usage);
      // svg    = createGraphVizGraph(fullGraphDotCode);
            
      document.getElementById('run-simulation-spinner').style.display = 'none';
      document.getElementById('simulation-running').style.display     = 'none';
      document.getElementById('critical-path-section').style.display  = 'block';
      document.getElementById('run-simulation-button').disabled       = false;
    } catch (error) {
      console.error('🕐❌Failed to obtain execution results:', error)
    }
  }

 /* ------------------------------------------------------------------ 
  * Simulation options: UI actions 
  * ------------------------------------------------------------------ */

  function toggleCritical() { simulationOptions.showCritical = !simulationOptions.showCritical }

  const reloadExecutionResults = async () => {
    clearTimeout(resultsTimeout)
    try {
      resultsTimeout = setTimeout(() => {
        document.getElementById('instructions-output').innerHTML         = '?';
        document.getElementById('cycles-output').innerHTML               = '?';
        document.getElementById('IPC-output').innerHTML                  = '?';
        document.getElementById('cycles-per-iteration-output').innerHTML = '?';

        document.getElementById('run-simulation-spinner').style.display = 'block';
        document.getElementById('simulation-running').style.display     = 'block';
        document.getElementById('critical-path-section').style.display  = 'none';
        document.getElementById('run-simulation-button').disabled       = true;

        getExecutionResults(simulationOptions.iters, simState.ROBsize) // Call Python RVCAT --> 'get_execution_results'
        console.log('🕐✅ Reloading execution results')
       }, 200)
    } catch (error) {
      console.error('🕐❌Failed to request execution results:', error)
    }
  }

/****************** 
   TODO:  do not change when only showCritical is changed, and there is no other change, and results are available
   ********************/
  
  // Watch ALL simulation options for changes
  watch(simulationOptions, () => {
    try {
      simulationOptions.iters = Math.min(simulationOptions.iters, 5000);
      simulationOptions.iters = Math.max(simulationOptions.iters, 1);
      saveOptions()
      if (simState.RVCAT_state == 3 && simState.ROBsize > 0 && simState.selectedProgram && simState.selectedProcessor) {
        reloadExecutionResults()
      }
    } catch (error) {
      console.error('🕐❌Failed when simulation options modified:', error)
    } 
  },
  { deep: true, immediate: true })


  // Watch multiple reactive sources
  watch (
    [() => simState.selectedProgram, 
     () => simState.selectedProcessor, 
     () => simState.ROBsize],
    ([newProgram, newProcessor, newValue], [oldProgram, oldProcessor, oldValue] ) => {
      // Check if any changed meaningfully
      const programChanged   =   newProgram      && newProgram   !== oldProgram
      const processorChanged =   newProcessor    && newProcessor !== oldProcessor
      const ROBsizeChanged   = (newValue !== 0 ) && newValue     !== oldValue
 
      if (!programChanged && !processorChanged && !ROBsizeChanged) return

      if (simState.RVCAT_state == 3 && newProgram && newProcessor) {
        reloadExecutionResults()
      }
    },
  { immediate: false })

  
function get_execution_processor_dot(dispatch_width, num_ports, retire_width, rob_size, usage = null) {
  let dot_code = `
  digraph "Usage of Processor Pipeline"{
    rankdir=TB;
    node [fontsize=14, fontname="Arial"];
  `;

  // Colorscale from white to red
  const color = [ "#ffffff", "#eaffea", "#d5ffd5", "#c0ffc0", "#aaffaa", "#95ff95", "#80ff80",
                  "#7ffb6e", "#86f55d", "#96ee4d", "#abe63d", "#bfde2d", "#d4d51e", "#e6ca11",
                  "#f2bb07", "#f8a800", "#f18c00", "#ea7000", "#e35400", "#dc3800", "#d51c00", "#ce0000"
  ];

  let dispatch_color = color[Math.floor(usage.dispatch/5)];
  // --- FETCH ---
  dot_code += `Fetch [
        shape=point
        width=0
        height=0
        fixedsize=true
        label=""
        margin=0
        style=invis
      ];`;

  dot_code += `
    Fetch -> "Waiting Buffer" [
      label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" BGCOLOR="${dispatch_color}"><TR><TD>Dispatch = ${dispatch_width} (${usage.dispatch.toFixed(1)}%)</TD></TR></TABLE>>,
      fontsize=14,
      fontname="Arial",
      tooltip="Usage: ${usage.dispatch.toFixed(1)}%"
    ];
  `;

  // --- WAITING BUFFER ---
  dot_code += `  "Waiting Buffer" [label="Waiting\\nBuffer", shape=box, height=1.2, width=1.2, tooltip="Instructions wait for input data and port availability", fixedsize=true];\n`;

  dot_code += `subgraph cluster_execute {
      rankdir="TB";
  `
  for (let i = num_ports-1; i >= 0; i--) {
    if (usage !== null && usage.ports[i]!==0.0) {
        let execute_color = color[Math.floor(usage.ports[i] / 5)];
        dot_code += `P${i} [shape=box3d,height=0.2,width=0.4, style=filled, fillcolor="${execute_color}", tooltip="Usage: ${usage.ports[i].toFixed(1)}%"];\n`
    } else {
        dot_code += `P${i} [shape=box3d,height=0.2,width=0.4, tooltip="Usage: 0.0%"];\n`
    }
    dot_code += `"Waiting Buffer" -> P${i};\n`;
  }

  dot_code += `label = "Execute";\n
  fontname="Arial";
  fontsize=12;
  }\n`

  dot_code += `  Registers [shape=box, height=1.2, width=1.2, fixedsize=true,tooltip="Architectural state: updated on instruction retirement"];\n`;

  // Align top row
  dot_code += `
    {
      rank=same;
      Fetch;
      "Waiting Buffer";
      ${[...Array(num_ports).keys()].map(i => `P${i}`).join("; ")};
      Registers;
    }
  `;

  // --- ROB ---
  dot_code += `
    ROB [label="ROB: ${rob_size} entries", tooltip="Reorder Buffer: maintains program order", shape=box, height=0.6, width=5, fixedsize=true];
    {
      rank=sink;
      ROB;
    }
  `;

  dot_code += `  Fetch -> ROB;\n`;
  for (let i = 0; i < num_ports; i++) {
    dot_code += `  P${i} -> ROB;\n`;
  }

  let retire_color = color[Math.floor(usage.retire/5)];
  dot_code += `
    ROB -> Registers [
      label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" BGCOLOR="${retire_color}"><TR><TD>Retire = ${retire_width} (${usage.retire.toFixed(1)}%)</TD></TR></TABLE>>,
      fontsize=14,
      fontname="Arial",
      tooltip="Usage: ${usage.retire.toFixed(1)}%"
    ];
  `;

  dot_code += `}`;
  return dot_code;
}

  
function createCriticalPathList(data) {
  const COLORS = [
    "#ffffff", "#fff3f3", "#ffe7e7", "#ffdbdb", "#ffcece", "#ffc2c2",
    "#ffb6b6", "#ffaaaa", "#ff9e9e", "#ff9292", "#ff8686", "#ff7979",
    "#ff6d6d", "#ff6161", "#ff5555", "#ff4949", "#ff3d3d", "#ff3131",
    "#ff2424", "#ff1818", "#ff0c0c", "#ff0000"
  ]

  const baseStyle = `
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         2px;
    border-top:      1px solid black;
    border-left:     1px solid black;
    border-right:    1px solid black;
    box-sizing:      border-box;
  `
  const getColor = (p) =>
    p && p !== 0 ? COLORS[Math.floor(p / 5)] : "white"

  const row = (label, percentage, isLast = false) => `
    <li style="background-color:${getColor(percentage)}; list-style:none; margin:0; padding:0">
      <div style="${baseStyle}${isLast ? "border-bottom:1px solid black;" : ""}">
         <div style="width:100%; text-align:center;">
            ${label}    &nbsp; <···············································>   &nbsp  <b>${percentage.toFixed(1)}%</b> 
        </div>
      </div>
    </li>
  `
  let out = "<list>"

  // DISPATCH
  out += row("DISPATCH", data.dispatch)

  // INSTRUCTIONS
  out += data.instructions
    .map(i => row(i.instruction, i.percentage))
    .join("")

  // RETIRE
  out += row("RETIRE", data.retire, true)

  out += "</list>"
  return out
}

  
/* ------------------------------------------------------------------ 
 * Help support 
 * ------------------------------------------------------------------ */
  const showHelp1 = ref(false);  const showHelp2 = ref(false); const showHelp3 = ref(false);
  const helpIcon1 = ref(null);   const helpIcon2 = ref(null);  const helpIcon3 = ref(null);
  const helpPosition = ref({ top: '0%', left: '0%' });

  function openHelp1()  { nextTick(() => { showHelp1.value = true }) }
  function closeHelp1() { showHelp1.value  = false }
  function openHelp2()  { nextTick(() => { showHelp2.value = true }) }
  function closeHelp2() { showHelp2.value  = false }
  function openHelp3()  { nextTick(() => { showHelp3.value = true }) }
  function closeHelp3() { showHelp3.value  = false }
  
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Simulate Execution of <strong>{{ simState.selectedProgram }}</strong></span>
      </div>
      <div class="iters-run">
        <div class="iters-group">
          <span class="iters-label">Iterations:</span>
          <input type="number" min="1" max="5000" v-model.number="simulationOptions.iters" 
                 title="# loop iterations (1 to 5000)" id="simulation-iterations" >
        </div>
        <button class="blue-button" @click="reloadExecutionResults" 
                title="Run Simulation"  id="run-simulation-button" >
           Run
        </button>
      </div>
    </div>

    <div id="simulation-results-info" class="results-info">
      <div class="row">
        <div class="simulation-inline-item">
          <label for="instructions">Instructions:</label>
          <span id="instructions-output">?</span>
        </div>
        <div class="simulation-inline-item">
          <label for="cycles">Cycles:</label>
          <span id="cycles-output">?</span>
        </div>
        <div class="simulation-inline-item">
          <label for="cycles-per-iteration">Cycles per iteration:</label>
          <span id="cycles-per-iteration-output">?</span>
        </div>
      </div>
      <div class="row">
        <div class="simulation-inline-item">
          <label for="IPC">IPC:</label>
          <span id="IPC-output">?</span>
        </div>
        <div class="simulation-inline-item">
          <label for="Loads">Loads:</label>
          <span id="Loads-output">?</span>
        </div>
      </div>
    </div>
    
    <div class="sim-running-msg">
      <div class="running-group">
        <div id="run-simulation-spinner" class="spinner" style="display: none;"></div>
        <div id="simulation-running"><p>Simulation on course...</p></div>
      </div>
    </div>

    <!--- Critical Path Breakdown (percentages) ---->
    <div class="dropdown-wrapper" id="critical-path-section">
      <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show help">
         <img src="/img/info.png" class="info-img">
      </span>
      <button class="dropdown-header" @click="toggleCritical" :aria-expanded="showCritical" title="Show Critical % Info">
        <span class="arrow" aria-hidden="true">
          {{ simulationOptions.showCritical ? '▼' : '▶' }}
        </span>
        <span class="dropdown-title">Critical Execution Path</span>
      </button>
    </div>
      
    <Transition name="fold" appear>
      <prev v-show="simulationOptions.showCritical" id="critical-path"></prev>
    </Transition>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition"
    text="<strong>Simulate</strong> the execution of a specified number of program 
      loop iterations and view aggregate performance metrics, including the total number of executed 
      <em>instructions</em>, total clock <em>cycles</em>, cycles <em>per loop iteration</em>,
      and <em>Instructions Per Cycle</em> (IPC). To obtain meaningful results, ensure that you simulate a representative 
      number of loop iterations. 
      <p>The sections below provide detailed statistics on the critical execution path and 
      the utilization of core processor resources.</p>"
    title="Overall Simulation Results"
    @close="closeHelp1"/>
  </Teleport>
  
  <Teleport to="body">    
    <HelpComponent v-if="showHelp2" :position="helpPosition"
    text="Open this tab to visualize the <strong>time distribution of instructions</strong>,
      along with the <em>dispatch</em> and <em>retire</em> stages, on the <strong>critical execution path</strong>. 
      <p>You can also explore the critical execution path in a detailed timeline view for a limited number 
      of loop iterations in the <strong>Timeline</strong> tab.</p>"
    title="Critical execution path breakdown"
    @close="closeHelp2"/>
  </Teleport>

</template>

<style scoped>
  .iters-run {
    display:     flex;
    align-items: center;
    gap:         12px;
  }

  .results-info {
    width: 100%;
  }
  .results-info .row {
    gap:     20px;
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }

  .simulation-inline-item {
    flex:            1;
    display:         flex;
    padding:         2px 2px;
    justify-content: space-between;
    align-items:     center;
    background:      #f0f0f0;
    border-radius:   6px;
  }
  .simulation-inline-item label {
    flex:         1;
    margin-right: 10px;
  }
  .simulation-inline-item span {
    text-align:  right;
    flex-shrink: 0;
  }

  .sim-running-msg {
    display: flex;
    width:   100%;
    align-items:     center;
    justify-content: center;
  }
  .running-group {
    display: flex;
    gap:     10px;
  }
  .spinner {
    width:  15px;
    height: 15px;
    width:  5vh;
    height: 5vh;
    margin: auto; 
    animation:  spin 1s linear infinite;
    border:     8px solid #f0f0f0;
    border-top: 8px solid #0085dd;
    border-radius: 50%;
  }
  @keyframes spin {
      0% {
          transform: rotate(0deg);
      }
      100% {
          transform: rotate(360deg);
      }
  }

</style>
