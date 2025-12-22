<script setup>
  import { ref, onMounted, nextTick, onUnmounted, watch, watchEffect } from "vue";
  import TutorialComponent from '@/components/tutorialComponent.vue';

/* Safe solution */
  const isMounted = ref(false)
  onMounted(() => {
    isMounted.value = true
  })
  
/* ------------------------------------------------------------------ 
 * UI state 
 * ------------------------------------------------------------------ */
  let processorsListHandler;
  let programsListHandler;
  let graphTimeout = null
  
  const showPerformance = ref(false);
  const showFullScreen  = ref(false);
  const showTutorial1   = ref(false);
  const showTutorial2   = ref(false);
  const showTutorial3   = ref(false);
  const infoIcon1       = ref(null);
  const infoIcon2       = ref(null);
  const infoIcon3       = ref(null);
  const tutorialPosition= ref({ top: '0%', left: '0%' });
  
/* ------------------------------------------------------------------ 
 * Graph options (persistent in localStorage)
 * ------------------------------------------------------------------ */
  const iters      = ref(1)
  const showIntern = ref(true)
  const showLaten  = ref(false)
  const showSmall  = ref(false)
  const showFull   = ref(false)

/* ------------------------------------------------------------------ 
 * Load / save options from localStorage 
 * ------------------------------------------------------------------ */
  onMounted(() => {
    const i = localStorage.getItem("showIntern");
    if (i !== null) showIntern.value = i === "1";

    const l = localStorage.getItem("showLaten");
    if (l !== null) showLaten.value = l === "1";

    const v = localStorage.getItem("showSmall");
    if (v !== null) showSmall.value = v === "1";

    const r = localStorage.getItem("showFull");
    if (r !== null) showFull.value = r === "1";
  });
  
  onMounted(() => {
    const v = localStorage.getItem("graphIterations");
    if (v !== null) iters.value = parseInt(v);
  });

  watch(iters, v => localStorage.setItem("graphIterations", v));
  watch(showIntern, v => localStorage.setItem("showIntern", v ? "1" : "0"));
  watch(showLaten,  v => localStorage.setItem("showLaten",  v ? "1" : "0"));
  watch(showSmall,  v => localStorage.setItem("showSmall",  v ? "1" : "0"));
  watch(showFull,   v => localStorage.setItem("showFull",   v ? "1" : "0"));
  
/* ------------------------------------------------------------------ 
* UI actions 
* ------------------------------------------------------------------ */
  function changeIters(delta) {
    let v = iters.value + delta
    if (v < 1) v = 1
    if (v > 10) v = 10
    iters.value = v
  }

  function toggleIntern() { showIntern.value = !showIntern.value }
  function toggleLaten()  { showLaten.value  = !showLaten.value  }
  function toggleSmall()  { showSmall.value  = !showSmall.value  }
  function toggleFull()   { showFull.value   = !showFull.value }

  watch(
    [iters, showIntern, showLaten, showSmall, showFull],
    ([i, c, r, n, l]) => {
      if (!isMounted.value) return

      clearTimeout(graphTimeout)
      graphTimeout = setTimeout(() => {
        showCriticalPathsGraph(i, c, r, n, l)
      }, 75)
    },
    { immediate: true }
  )

  function updateGraph() {
    showCriticalPathsGraph(
      iters.value,
      showIntern.value,
      showLaten.value,
      showSmall.value,
      showFull.value
    )
  }

/* ------------------------------------------------------------------ 
 * Fullscreen graph 
 * ------------------------------------------------------------------ */  
  function openFullScreen() {
    showFullScreen.value = true;
    nextTick(() => {
      const src = document.getElementById("dependence-graph");
      const dst = document.getElementById("dependence-graph-full");
      if (src && dst) {
        dst.innerHTML = "";
        dst.appendChild(src.querySelector("svg").cloneNode(true));
      }
    });
  }

  function closeFullScreen() {
    showFullScreen.value = false;
  }

/* ------------------------------------------------------------------ 
 * Performance annotations 
 * ------------------------------------------------------------------ */
  function toggleAnnotations() {
    showPerformance.value = !showPerformance.value;
    if (showPerformance.value) {
      nextTick(() => {
        programShowPerformanceLimits();
      });
    }
  }

/* ------------------------------------------------------------------ 
 * External selectors listeners 
* ------------------------------------------------------------------ */
  onMounted(() => {
    nextTick(() => {
      const processorsList = document.getElementById("processors-list");
      if (processorsList) {
        processorsListHandler = () => {
          setTimeout(() => {
            if (showPerformance.value) {
              programShowPerformanceLimits();
            }
            updateGraph()
          }, 100);
        };
        processorsList.addEventListener("change", processorsListHandler);
      }
      const programsList = document.getElementById("programs-list");
      if (programsList) {
        programsListHandler = () => {
          setTimeout(() => {
            if (showPerformance.value) {
              programShowPerformanceLimits();
            }
            updateGraph()
          }, 100);
        };
        programsList.addEventListener("change", programsListHandler);
      }
      updateGraph()
    });
  });

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

/* ------------------------------------------------------------------ 
 * Tutorial 
 * ------------------------------------------------------------------ */
  function openTutorial1() { nextTick(() => { showTutorial1.value = true }) }
  function openTutorial2() { nextTick(() => { showTutorial2.value = true }) }
  function openTutorial3() { nextTick(() => { showTutorial3.value = true }) }
  
  function closeTutorial1() { showTutorial1.value  = false }
  function closeTutorial2() { showTutorial2.value = false }
  function closeTutorial3() { showTutorial3.value = false }
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        
        <!-- Title -->
        <span ref="infoIcon1" class="info-icon" @click="openTutorial1">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Performance Analysis</span>
      </div>
    </div>

    <div class="annotations-wrapper">
      <span ref="infoIcon2" class="info-icon" @click="openTutorial2">
         <img src="/img/info.png" class="info-img">
      </span>
      <button class="annotations-header" @click="toggleAnnotations" :aria-expanded="showPerformance">
        <span class="arrow" aria-hidden="true">
          {{ showPerformance ? '▼' : '▶' }}
        </span>
        <span class="annotations-title">
          Analysis of Performance Limits
        </span>
      </button>
      <Transition name="fold" appear>
        <pre v-show="showPerformance" id="performance-limits" class="annotations-box"></pre>
      </Transition>
    </div>
    
    <div class="output-block-wrapper" id="simulation-output-container">
      <div class="graph-toolbar">
        <span ref="infoIcon3" class="info-icon" @click="openTutorial3">
          <img src="/img/info.png" class="info-img">
        </span>
        
        <h4 class="graph-title">
          Data Dependence Graph
        </h4>

        <!-- Iterations -->
        <div class="iters-group">
          <span class="iters-label">Iters:</span>
          <input type="number" min="1" max="7" v-model.number="iters">
        </div>
        
        <!-- Flags -->
        <div class="flags-group">
          <button class="blue-button" :class="{ active: showIntern }" :aria-pressed="showIntern" @click="toggleIntern"><span v-if="showIntern">✔ </span>Internal</button>
          <button class="blue-button" :class="{ active: showLaten  }" :aria-pressed="showLaten"  @click="toggleLaten"> <span v-if="showLaten">✔ </span>Latencies</button>
          <button class="blue-button" :class="{ active: showSmall  }" :aria-pressed="showConst"  @click="toggleSmall"> <span v-if="showSmall">✔ </span>Small</button>
          <button class="blue-button" :class="{ active: showFull   }" :aria-pressed="showRdOnly" @click="toggleFull">  <span v-if="showFull">✔ </span>Full</button>
        </div>

        <button class="icon-button" @click="openFullScreen" title="Open fullscreen">
          <img src="/img/fullscreen.png" class="fs-img">
        </button>
        
      </div>
      <div class="output-block" id="dependence-graph"></div>
    </div>
  </div>
  <div v-if="showFullScreen" class="fullscreen-overlay">
    <div class="fullscreen-content">
      <div class="fullscreen-header">
        <h3>Data Dependence Graph (circular paths in red)</h3>
        <button class="close-btn" @click="closeFullScreen">x</button>
      </div>
      <div class="output-block" id="dependence-graph-full"></div>
    </div>
  </div>
  <TutorialComponent v-if="showTutorial1" :position="tutorialPosition"
  text="Statically determined throughput and latency bottlenecks. The minimum execution time per loop iteration may be throughput-bound, 
    meaning it is limited by the processor’s instruction dispatch, execution, or retirement capacity for a given subset of instructions. 
    Alternatively, it may be latency-bound, meaning it is constrained by a loop-carried chain of data dependencies that forms a critical path across iterations"
  title="Static Performance Analysis"
  @close="closeTutorial1"/>
  <TutorialComponent v-if="showTutorial2" :position="tutorialPosition"
  text="Expand the Performance Analysis tab to view a detailed static performance breakdown. Performance may be limited by the maximum throughput of a hardware resource, 
    such as dispatch width or a set of execution ports required to execute a particular subset of instructions. 
    Alternatively, performance may be limited by the latency of a circular chain of data dependencies among instructions."
  title="Detailed Performance Analysis"
  @close="closeTutorial2"/>
  <TutorialComponent v-if="showTutorial3" :position="tutorialPosition"
  text="The data dependence graph highlights circular dependencies (shown in red) that determine latency-bound execution time. 
      You can show or hide internal dependencies, execution latencies, instruction details, and full input dependencies on constant and read-only values.
      Click the fullscreen button to enlarge the graph."
  title="Dependence Graph and Latency-bound execution time"
  @close="closeTutorial3"/>
</template>

<style scoped>
  .main {
    height: 100%;
    width: 100%;
    background: white;
    overflow: auto;
    padding: 5px;
    border-radius: 10px;
    font-size: 14px;
  }
  .header {
    position: sticky;
    top: -5px;
    left:0;
    background: white;
    width: 100%;
    box-shadow: 0 1px 0 rgba(0,0,0,0.08);
    padding: 6px 8px;
    z-index: 10;
  }
  .title {
    font-size: 2.5vh;
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
  .iters-group,
  .flags-group {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .iters-group input[type="number"] {
    width: 4ch;
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
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  .info-img {
    height: 1em;
    width: 1em;
  }
  .annotations-wrapper {
    margin-top: 5px;
  }
  .annotations-box {
    white-space: pre-wrap;
    background: #f0f0f0;
    padding: 10px;
    border-radius: 0 0 5px 5px;
    margin-top: 0;
    font-size: 0.9rem;
    line-height: 1.4;
    font-family: monospace;
  }
  .annotations-header {
    all: unset;                    /* button reset */
    width: 100%;
    cursor: pointer;
    background: #f3f3f3;
    padding: 6px 10px;
    border-radius: 6px 6px 0 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .annotations-header:hover {
    background: #eaeaea;
  }
  .annotations-title {
    flex: 1;
  }
  .arrow {
    font-size: 0.85em;
    opacity: 0.8;
  }
  .fs-img {
    height:2.5vh;
  }
  /* The full-screen overlay */
  .fullscreen-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .fullscreen-content {
    background: white;
    margin: 10px;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 8px;
    width: 90%;
    height: 90%;
    resize: both;
    overflow: auto;
    min-width: 300px;
    min-height: 200px;
    max-width:99%;
    max-height:99%;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  }
  .fullscreen-content .close-btn {
    align-self: flex-end;
    background: none;
    border: none;
    font-size: 3vh;
    cursor: pointer;
    margin-bottom: 8px;
  }
  .output-block {
    flex: 1 1 auto;
    position: relative;
    overflow: hidden;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
  }
  .output-block svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100% !important;
    height: 100% !important;
  }
  .output-block-wrapper {
    display: flex;
    flex-direction: column;
    height: 90%;
  }
.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
}
.graph-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}
.graph-subtitle {
  font-size: 0.85em;
  opacity: 0.7;
}
.icon-button {
  background: #b0b0b0;     /* default backgorund color */
  border: none;
  cursor: pointer;
  padding: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.2s;
}
.icon-button img,
.icon-button svg {
  width: 1.5em;
  height: 1.5em;
}
.icon-button:hover {
  background: #a0a0a0;      /* darker at hover */
}
.icon-button:active {
  background: #909090;      /* still darker */
}
.icon-button:focus {
  outline: 2px solid #1a4fb3;  /* keypad */
  outline-offset: 2px;
}

.fold-enter-active,
.fold-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease;
}
.fold-enter-from,
.fold-leave-to {
  max-height: 0;
  opacity: 0;
}
.fold-enter-to,
.fold-leave-from {
  max-height: 500px;
  opacity: 1;
}
  .fullscreen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .fullscreen-title {
    margin: 0;
  }
  .close-btn {
    background: none;
    border: none;
    font-size: 1.5em;
    line-height: 1;
    cursor: pointer;
    padding: 4px;
  }
</style>
