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
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const simulationOptions = reactive({ ...defaultOptions, ...savedOptions })

  let executionResults= {}
  let cleanupHandleResults = null
  
  // Save on changes
  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(simulationOptions))
    } catch (error) {
      console.error('❌ Failed to save:', error)
    }
  }
  
  // Load from localStorage
  onMounted(() => {
    cleanupHandleResults  = registerHandler('get_execution_results', handleResults);

    try {    // Load from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(simulationOptions, JSON.parse(saved))
      }
    } catch (error) {
      console.error('❌ Failed to load:', error)
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
      console.error('Failed to get execution results:', data);
      return;
    }
    try {
      console.log('✅ Execution Results received')
      executionResults = data
    } catch (error) {
      console.error('Failed to obtain execution results:', error)
    }
  }

  
 /* ------------------------------------------------------------------ 
  * Simulation options: UI actions 
  * ------------------------------------------------------------------ */

  function toggleCritical() { simulationOptions.showCritical = !simulationOptions.showCritical }

  // Watch ALL simulation options for changes
  watch(simulationOptions, () => {
    try {
      if (simulationOptions.iters > 5000) { 
        simulationOptions.iters = 5000
      }  else if (simulationOptions.iters < 1) { 
        simulationOptions.iters = 1
      }
      saveOptions()
      if (simState.RVCAT_imported && simState.ROBsize > 0 && simState.selectedProgram && simState.selectedProcessor) {
        getExecutionResults(simulationOptions.iters, simState.ROBsize) 
        console.log('✅ Request execution results')
      }
    } catch (error) {
      console.error('Failed to save dependence graph options:', error)
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

      if (simState.RVCAT_imported && newProgram && newProcessor) {
        getExecutionResults(simulationOptions.iters, simState.ROBsize) 
        console.log('✅ Request execution results')
      }
    },
  { immediate: false })

let fullGraphDotCode;

function createProcessorSimulationGraph(dispatch, execute, retire, usage=null) {
  fullGraphDotCode = construct_full_processor_dot(dispatch, execute, retire, usage);
  svg    = createGraphVizGraph(fullGraphDotCode);
  document.getElementById('simulation-graph').appendChild(svg)
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
  const showHelp1    = ref(false);
  const showHelp2    = ref(false);
  const showHelp3    = ref(false);
  const helpIcon1    = ref(null);
  const helpIcon2    = ref(null);
  const helpIcon3    = ref(null);
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
        <span class="header-title">Simulation of the Execution of the Program</span>
      </div>
      <div class="iters-run">
        <div class="iters-group">
          <span class="iters-label">Iterations:</span>
          <input type="number" min="1" max="5000" title="# loop iterations (1 to 5000)" v-model.number="simulationOptions.iters" >
        </div>
        <button id="run-simulation-button" class="blue-button" @click="getExecutionResults" title="Run Simulation">
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

    <!--    Processor Graph with visual usage  -->
    <div id="graph-section" class="graph-section" style="display: none;">
       <span ref="helpIcon3" class="info-icon" @click="openHelp3" title="Show help">
          <img src="/img/info.png" class="info-img">
       </span>
       <span class="dropdown-title">Processor Bottlenecks</span>
       <div class="simulation-img" id="simulation-graph"> </div>
    </div>

    <div class="scale-container">
      <div class="color-scale"></div>
      <div class="scale-labels">
        <span>Underutilized</span>
        <span></span>
        <span>Saturated</span>
      </div>
    </div>
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

  <Teleport to="body">
    <HelpComponent v-if="showHelp3" :position="helpPosition"
    text="Graphical view of processor utilization: hover over the <em>execution ports</em> 
      to inspect their individual <em>utilization</em>. <p><strong>Red</strong> indicates a potential performance bottleneck in execution.</p>"
    title="Processor Utilization"
    @close="closeHelp3"/>
  </Teleport>
</template>

<style scoped>
  .iters-run {
    display:     flex;
    align-items: center;
    gap:         12px;
  }

  .results-info {
    width:      100%;
  }
  .results-info .row {
    gap:     20px;
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }

  .simulation-inline-item {
    flex:    1;
    display: flex;
    padding: 2px 2px;
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

  .graph-section {
    display:         flex;
    justify-content: center;
    align-items:     center;
  }
  .simulation-img svg {
    width:      100%;
    max-height: 50%;
  }
  .simulation-graph {
    display: block;
    width:   70%;
    margin:  auto;
  }
  
  .scale-container {
    width:      50%;
    margin:     0 auto;
    margin-top: 2%;
    text-align: center;
    display:    block;
  }
  .scale-labels {
    width:      100%;
    display:    flex;
    margin-top: 10px;
    font-size:  2.75vh;
    justify-content: space-between;
  }
  .color-scale {
    width:   100%;
    height:  10px;
    border:  1px solid black;
    position: relative;
    background:    linear-gradient(to right, white, #6bff6b, #ffc400, #ce0000);
    border-radius: 5px;
  }
  
</style>
