<script setup>
  import { ref, toRaw, onMounted, onUnmounted, nextTick, inject, watch, reactive } from "vue"
  import HelpComponent                                   from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                                    from '@/rvcatAPI'

  const { getExecutionResults } = useRVCAT_Api();
  const { registerHandler }     = inject('worker');
  const simState                = inject('simulationState');

 /* ------------------------------------------------------------------
   * Simulation Results options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'simulationOptions'

  const defaultOptions = {
    iters:  1,
    showPrevious: false
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

  let cleanupHandleResults  = null
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
      simState.executionResults = JSON.parse(data);
      if (simState.executionResults['data_type'] === 'error') {
          alert('Error running simulation');
          document.getElementById('run-simulation-spinner').style.display = 'none';
          document.getElementById('simulation-running').style.display     = 'none';
          document.getElementById('critical-path-section').style.display  = 'block';
          document.getElementById('run-simulation-button').disabled       = false;
          return;
      }
      document.getElementById('instructions-output').innerHTML         = simState.executionResults["total_instructions"]
      document.getElementById('cycles-output').innerHTML               = simState.executionResults["total_cycles"];
      document.getElementById('IPC-output').innerHTML                  = simState.executionResults["ipc"].toFixed(2);
      document.getElementById('cycles-per-iteration-output').innerHTML = simState.executionResults["cycles_per_iteration"].toFixed(2);

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

  function togglePrevious() { simulationOptions.showPrevious = !simulationOptions.showPrevious }

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

        const { ROBsize, dispatch, retire, sched, blksize, nBlocks, mPenalty, mIssueTime, instruction_list } = simState.simulatedProcess
        getExecutionResults(JSON.stringify( { ROBsize, dispatch, retire, sched, blksize, nBlocks, mPenalty, mIssueTime,
                                              instruction_list: toRaw(instruction_list)}, null, 2),
                            simulationOptions.iters) // Call Python RVCAT
        console.log('🕐✅ Reloading execution results')
       }, 200)
    } catch (error) {
      console.error('🕐❌Failed to request execution results:', error)
    }
  }

  watch( () => simulationOptions.iters, (newIters, oldIters) => {
      if (newIters === oldIters) return
      try {
        const clamped = Math.min(Math.max(newIters, 1), 2000)
        if (clamped !== newIters) {
          simulationOptions.iters = clamped
          return
        }
        saveOptions()
        if (simState.state >= 3) {
          reloadExecutionResults()
        }
        console.log('🕐✅ Modified simulation iters')
      } catch (error) {
        console.error('🕐❌Failed when modifying simulation options:', error)
      }
    }
  )

  watch( () => simState.simulatedProcess, () => {
      if (simState.state >= 3 && simState.simulatedProcess) {
        console.log('🕐🔄 Re-execute simulation');
        reloadExecutionResults()
      }
    },
    { deep: true, immediate: false }
  )

/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp1 = ref(false);  const showHelp2 = ref(false);
  const helpIcon1 = ref(null);   const helpIcon2 = ref(null);
  const helpPosition = ref({ top: '0%', left: '0%' });

  function openHelp1()  { nextTick(() => { showHelp1.value = true }) }
  function closeHelp1() { showHelp1.value  = false }
  function openHelp2()  { nextTick(() => { showHelp2.value = true }) }
  function closeHelp2() { showHelp2.value  = false }

</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Simulate Execution of <strong>{{ simState.programName }}</strong></span>
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

    <div class="dropdown-wrapper" id="previous-simulations-section">
      <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show help">
         <img src="/img/info.png" class="info-img">
      </span>
      <button class="dropdown-header" @click="togglePrevious" :aria-expanded="showPrevious"
        title="Show previous simulation results"
        id   ="show-previous-button">
        <span class="arrow" aria-hidden="true">
          {{ simulationOptions.showPrevious ? '▼' : '▶' }}
        </span>
        <span class="dropdown-title">Previous simulation results</span>
      </button>
    </div>

    <Transition name="fold" appear>
      <prev v-show="simulationOptions.showPrevious" id="previous-results"></prev>
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
    text="Open this tab to visualize the <strong>performance results</strong> from previous simulations,
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
    gap:             20px;
    display:         flex;
    justify-content: space-between;
    margin-bottom:   5px;
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
