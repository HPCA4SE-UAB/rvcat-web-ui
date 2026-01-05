<script setup>
  import { ref, onMounted, nextTick, onUnmounted, watch } from "vue";
  import TutorialComponent from '@/components/tutorialComponent.vue';

/* ------------------------------------------------------------------ 
 * UI state 
 * ------------------------------------------------------------------ */
  const showCriticalPath = ref(false);
  const tutorialPosition = ref({ top: '0%', left: '0%' });
  const showTutorial1    = ref(false);
  const infoIcon1        = ref(null);
  const showTutorial2    = ref(false);
  const infoIcon2        = ref(null);
  const showTutorial3    = ref(false);
  const infoIcon3        = ref(null);
  const iters            = ref(1)

/* ------------------------------------------------------------------ 
 * Tutorial 
 * ------------------------------------------------------------------ */
  function openTutorial1()  { nextTick(() => { showTutorial1.value = true }) }  
  function closeTutorial1() { showTutorial1.value  = false }
  function openTutorial2()  { nextTick(() => { showTutorial2.value = true }) }  
  function closeTutorial2() { showTutorial2.value  = false }
  function openTutorial3()  { nextTick(() => { showTutorial3.value = true }) }  
  function closeTutorial3() { showTutorial3.value  = false }

  function RunSimulation()  { getSchedulerAnalysis() }
  
/* ------------------------------------------------------------------ 
 * Critical Path Statistics 
 * ------------------------------------------------------------------ */
  function toggleCriticalPath() {
    showCriticalPath.value = !showCriticalPath.value;
  }
  
/* ------------------------------------------------------------------ 
 * Load / save options from localStorage 
 * ------------------------------------------------------------------ */
  onMounted(() => {
    const v = localStorage.getItem("ExecutionIterations");
    if (v !== null) iters.value = parseInt(v);
  });

  watch(iters, v => localStorage.setItem("ExecutionIterations", v));

 /* ------------------------------------------------------------------ 
  * UI actions 
  * ------------------------------------------------------------------ */
  onMounted(() => {
    nextTick(() => {
      if (typeof reloadRvcat === "function") {
        reloadRvcat();
      } else {
        console.error("simulation-graph element not found.");
      }
    });
  });
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="infoIcon1" class="info-icon" @click="openTutorial1" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Simulation of the Execution of the Program</span>
      </div>
      <div class="iters-run">
        <div class="iters-group">
          <span class="iters-label">Iterations:</span>
          <input type="number" id="num-iters" min="1" max="20000" @change="RunSimulation" 
             v-model.number="iters" title="# loop iterations">
        </div>
        <button id="run-simulation-button" class="blue-button" @click="RunSimulation" title="Run Simulation">
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
      <span ref="infoIcon2" class="info-icon" @click="openTutorial2" title="Show help">
         <img src="/img/info.png" class="info-img">
      </span>
      <button class="dropdown-header" @click="toggleCriticalPath" :aria-expanded="showCriticalPath" title="Show Critical % Info">
        <span class="arrow" aria-hidden="true">
          {{ showCriticalPath ? '▼' : '▶' }}
        </span>
        <span class="dropdown-title">Critical Execution Path</span>
      </button>
    </div>
      
    <Transition name="fold" appear>
      <prev v-show="showCriticalPath" id="critical-path"></prev>
    </Transition>

    <!--    Processor Graph with visual usage  -->
    <div id="graph-section" class="graph-section" style="display: none;">
       <span ref="infoIcon3" class="info-icon" @click="openTutorial3" title="Show help">
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
    <TutorialComponent v-if="showTutorial1" :position="tutorialPosition"
    text="<strong>Simulate</strong> the execution of a specified number of program 
      loop iterations and view aggregate performance metrics, including the total number of executed 
      <em>instructions</em>, total clock <em>cycles</em>, cycles <em>per loop iteration</em>,
      and <em>Instructions Per Cycle</em> (IPC). To obtain meaningful results, ensure that you simulate a representative 
      number of loop iterations. 
      <p>The sections below provide detailed statistics on the critical execution path and 
      the utilization of core processor resources.</p>"
    title="Overall Simulation Results"
    @close="closeTutorial1"/>
  </Teleport>
  
  <Teleport to="body">    
    <TutorialComponent v-if="showTutorial2" :position="tutorialPosition"
    text="Open this tab to visualize the <strong>time distribution of instructions</strong>,
      along with the <em>dispatch</em> and <em>retire</em> stages, on the <strong>critical execution path</strong>. 
      <p>You can also explore the critical execution path in a detailed timeline view for a limited number 
      of loop iterations in the <strong>Timeline</strong> tab.</p>"
    title="Critical execution path breakdown"
    @close="closeTutorial2"/>
  </Teleport>

  <Teleport to="body">
    <TutorialComponent v-if="showTutorial3" :position="tutorialPosition"
    text="Graphical view of processor utilization: hover over the <em>execution ports</em> 
      to inspect their individual <em>utilization</em>. <p><strong>Red</strong> indicates a potential performance bottleneck in execution.</p>"
    title="Processor Utilization"
    @close="closeTutorial3"/>
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
    margin-top: 10px;
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
    padding: 4px 10px;
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
    min-width:   60px;
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
