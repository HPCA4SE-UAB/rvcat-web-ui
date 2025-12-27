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
        <button id="run-simulation-button" class="blue-button" @click="getSchedulerAnalysis">Run</button>
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
        <span class="critical-title">Critical Execution Path</span>
      </button>
    </div>
      
    <Transition name="fold" appear>
      <prev v-show="showCriticalPath" id="critical-path"></prev>
    </Transition>

    <!--    Processor Graph with visual usage  -->
    <div id="graph-section" class="graph-section" style="display: none;">
       <span ref="infoIcon3" class="info-icon" @click="openTutorial3">
          <img src="/img/info.png" class="info-img">
       </span>
       <span class="critical-title">Processor Bottlenecks</span>
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
  text="<strong>Simulate</strong> the execution of a specified number of program 
    loop iterations and view aggregate performance metrics, including the total number of executed 
    <em>instructions</em>, total clock <em>cycles</em>, cycles <em>per loop iteration</em>,
    and <em>Instructions Per Cycle</em> (IPC). To obtain meaningful results, ensure that you simulate a representative 
    number of loop iterations. 
    <p>The sections below provide detailed statistics on the critical execution path and 
    the utilization of core processor resources.</p>"
  title="Overall Simulation Results"
  @close="closeTutorial1"/>
    
  <TutorialComponent v-if="showTutorial2" :position="tutorialPosition"
  text="Open this tab to visualize the <strong>time distribution of instructions</strong>,
    along with the <em>dispatch</em> and <em>retire</em> stages, on the <strong>critical execution path</strong>. 
    <p>You can also explore the critical execution path in a detailed timeline view for a limited number 
    of loop iterations in the <strong>Timeline</strong> tab.</p>"
  title="Critical execution path breakdown"
  @close="closeTutorial2"/>

  <TutorialComponent v-if="showTutorial3" :position="tutorialPosition"
  text="Graphical view of processor utilization: hover over the <em>execution ports</em> 
    to inspect their individual <em>utilization</em>. <p><strong>Red</strong> indicates a potential performance bottleneck in execution.</p>"
  title="Processor Utilization"
  @close="closeTutorial3"/>
  
</template>

<style scoped>
.iters-run {
  display: flex;
  align-items: center;
  gap: 12px; /* separación input / botón */
}
</style>
