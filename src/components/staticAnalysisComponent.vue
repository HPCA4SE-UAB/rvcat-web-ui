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
        <span class="header-title">Static Performance Analysis</span>
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
          Throughput-bound Limits
        </span>
      </button>
    </div>
    <Transition name="fold" appear>
      <pre v-show="showPerformance" id="performance-limits" class="annotations-box"></pre>
    </Transition>
    
    <div class="output-block-wrapper" id="simulation-output-container">
      <div class="graph-toolbar">
        <span ref="infoIcon3" class="info-icon" @click="openTutorial3">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="annotations-title">Data Dependence Graph</span>
        <!-- Iterations -->
        <div class="iters-group">
          <span class="iters-label">Iterations:</span>
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
  text="<em>Statically</em> determined <strong>throughput</strong> and <strong>latency</strong> bottlenecks. <p>The minimum execution time per loop iteration may be <em>throughput-bound</em>, 
    meaning it is limited by the processor’s instruction <strong>dispatch</strong>, <strong>execution</strong>, or <strong>retirement</strong> capacity for a given subset of instructions.</p> 
    <p>Alternatively, it may be <em>latency-bound</em>, meaning it is constrained by a <strong>loop-carried chain of data dependencies</strong> that forms a critical path across iterations.</p>"
  title="Static Performance Analysis"
  @close="closeTutorial1"/>
  <TutorialComponent v-if="showTutorial2" :position="tutorialPosition"
  text="Performance may be limited by the <strong>maximum throughput</strong> of a hardware resource, 
       such as <em>dispatch width</em> or a set of <em>execution ports</em> required to execute a particular subset of instructions."
  title="Throughput-bound execution time"
  @close="closeTutorial2"/>
  <TutorialComponent v-if="showTutorial3" :position="tutorialPosition"
  text="The data dependence graph highlights <strong>circular</strong> dependencies (shown in red) that determine <em>latency-bound</em> execution time (cycles per loop iteration).
      <p>You can show or hide internal dependencies, execution latencies, instruction details, and full input dependencies on constant and read-only values.
      Click the <strong>fullscreen</strong> button to enlarge the graph.</p>"
  title="Latency-bound execution time"
  @close="closeTutorial3"/>
</template>

<style scoped>
  .iters-group input[type="number"] { width: 4ch; }
</style>
