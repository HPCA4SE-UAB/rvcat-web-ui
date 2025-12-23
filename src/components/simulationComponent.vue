<script setup>
  import { ref, onMounted, nextTick, onUnmounted, watch } from "vue";
  import TutorialComponent from '@/components/tutorialComponent.vue';

  /* Safe solution */
  const isMounted = ref(false)
  onMounted(() => {
    isMounted.value = true
  })

  /* ------------------------------------------------------------------ 
 * UI state 
 * ------------------------------------------------------------------ */
  let graphTimeout = null

  const showCriticalPath = ref(false);
  const tutorialPosition = ref({ top: '0%', left: '0%' });
  const showTutorial1    = ref(false);
  const infoIcon1        = ref(null);
  const showTutorial2    = ref(false);
  const infoIcon2        = ref(null);
  const iters            = ref(1)

/* ------------------------------------------------------------------ 
 * Tutorial 
 * ------------------------------------------------------------------ */
  function openTutorial1()  { nextTick(() => { showTutorial1.value = true }) }  
  function closeTutorial1() { showTutorial1.value  = false }
  function openTutorial2()  { nextTick(() => { showTutorial2.value = true }) }  
  function closeTutorial2() { showTutorial2.value  = false }

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
          <input type="number" id="num-iters" min="1" max="20000" v-model.number="iters">
        </div>
        <button id="run-simulation-button" class="blue-button" onclick="getSchedulerAnalysis();">Run</button>
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
      </div>
    </div>
    <div class="sim-running-msg">
      <div class="running-group">
        <div id="run-simulation-spinner" class="spinner" style="display: none;"></div>
        <div id="simulation-running"><p>Simulation on course...</p></div>
      </div>
    </div>

    <!--- Critical Path Breakdown (percentages) ---->
    <div class="critical-wrapper" id="critical-path-section">
      <span ref="infoIcon2" class="info-icon" @click="openTutorial2">
         <img src="/img/info.png" class="info-img">
      </span>
      <button class="critical-header" @click="toggleCriticalPath" :aria-expanded="showCriticalPath">
        <span class="arrow" aria-hidden="true">
          {{ showCriticalPath ? '▼' : '▶' }}
        </span>
        <span class="critical-title">
          Critical Execution Path
        </span>
      </button>
      <Transition name="fold" appear>
        <prev v-show="showCriticalPath" id="critical-path"></prev>
      </Transition>
    </div>

    <!--    Processor Graph with visual usage  -->
    <div id="graph-section" class="graph-section" style="display: none;">
        <span class="header-title">Processor Bottlenecks</span>
        <div id="simulation-graph" class="simulation-img"></div>
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
  
  <TutorialComponent v-if="showTutorial1" :position="tutorialPosition"
  text="Simulate a specified number of program loop iterations and display aggregate performance metrics.
   Hover over processor execution ports to inspect their utilization, or open the corresponding tab to visualize the time distribution of instructions along the critical path."
  title="Overall Simulation Results"
  @close="closeTutorial1"/>
    
  <TutorialComponent v-if="showTutorial2" :position="tutorialPosition"
  text="Percentage of time devoted by each instruction and dispatch/retire stages on critical execution path."
  title="Critical execution path breakdown"
  @close="closeTutorial2"/>
  
</template>

<style scoped>
  .main{
    height: 100%;
    width: 100%;
    background: white;
    overflow: auto;
    padding: 5px;
    border-radius: 10px;
    position: relative;
  }
  #run-button{
    display:block;
    cursor:pointer;
    left: 3px;
  }
  .header{
    position:sticky;
    padding-top:2px;
    padding-bottom:5px;
    top:-5px;
    left:0;
    background:white;
    width:100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .section-title-and-info button,
  .section-title-and-info input {
    height: 2em;
    line-height: 1;
    font-size: 0.95rem;
  }
  .section-title-and-info input[type="number"] {
    width: 3.5em;
    text-align: center;
    font-size: inherit;
  }
  .section-title-and-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;              /* uniform space */
    flex-wrap: wrap;          /* avoid overflow */
  }
  .header-title {
    font-size: 1.1rem;
    margin-right: 0.75rem;
  }
  .iters-group {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .iters-group input[type="number"] {
    width: 8ch;
    text-align: center;
  }
  .iters-label {
    margin-left: 0.5rem;
    font-weight: 500;
  }
  .blue-button {
    background: #e6f0ff;
    color: #1a4fb3;
    border: 1px solid #7aa2e3;
    transition: background 0.15s ease, color 0.15s ease;
    cursor: pointer;
  }
  /* estado activado */
  .blue-button.active {
    background: #1a4fb3;
    color: white;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
    border-color: #1a4fb3;
  }
  /* feedback al pulsar */
  .blue-button:active {
    transform: translateY(1px);
  }
  .info-icon {
    display:      inline-flex;
    align-items:  center;
    margin-right: 0.5rem;
    cursor:       pointer;
  }
  .info-img {
    height: 1em;
    width: 1em;
  }

  .graph-section{
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .sim-running-msg {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
  }
  .simulation-graph{
    display:block;
    width:70%;
    margin:auto;
  }
  .running-group{
    display:flex;
    gap:10px;
  }
  .spinner {
    border: 8px solid #f0f0f0;
    border-top: 8px solid #0085dd;
    border-radius: 50%;
    width: 15px;
    height: 15px;
    animation: spin 1s linear infinite;
    margin: auto;
    width: 5vh;
    height: 5vh;
  }

  @keyframes spin {
      0% {
          transform: rotate(0deg);
      }
      100% {
          transform: rotate(360deg);
      }
  }

  .scale-container {
    width: 50%;
    margin: 0 auto;
    margin-top: 2%;
    text-align: center;
    display:block;
  }
  .color-scale {
    width: 100%;
    height: 10px;
    background: linear-gradient(to right, white, #6bff6b, #ffc400, #ce0000);
    border-radius: 5px;
    border: 1px solid black;
    position: relative;
  }

/* Optional labels for the scale */
  .scale-labels {
    width:100%;
    display: flex;
    justify-content: space-between;
    margin-top: 10px;
    font-size: 2.75vh;
  }
  .results-info {
    width: 100%;
    margin-top: 10px;
  }
  .results-info .row {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 5px;
  }
  .simulation-inline-item {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 10px;
    background: #f0f0f0;
    border-radius: 6px;
  }
  .simulation-inline-item label {
    flex: 1;
    margin-right: 10px;
  }
  .simulation-inline-item span {
    text-align: right;
    flex-shrink: 0;
    min-width: 60px;
  }

  .critical-wrapper {
    display:       flex;
    align-items:   center;
    flex-wrap:     nowrap;
    gap:           0.5rem;
    margin-top:    5px;
    margin-bottom: 5px;
  }
  .critical-header {
    all:         unset;                    /* button reset */
    width:       auto;
    cursor:      pointer;
    background:  #f3f3f3;
    padding:     6px 10px;
    display:     inline-flex;
    align-items: center;
    gap:         0.4rem;
    font-size:   0.95rem;
  }
  .critical-header:hover {
    background: #eaeaea;
  }
  .critical-title {
    flex: 1;
  }
  .arrow {
    opacity: 0.8;
    font-size: 0.85em;
  }
  /* content box */
  .critical-box {
    overflow: hidden;
    padding: 10px;
    background:  #f0f0f0;
    border-radius: 0 0 6px 6px;
  }
</style>
