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
  const showTutorial    = ref(false);
  const infoIcon        = ref(null);
  const tutorialPosition = ref({ top: '50%', left: '50%' });
  
/* ------------------------------------------------------------------ 
 * Graph options (grouped & persisted) 
 * ------------------------------------------------------------------ */
  const iters      = ref(1)
  const showConst  = ref(false)
  const showRdOnly = ref(false)
  const showIntern = ref(true)
  const showLaten  = ref(false)

/* ------------------------------------------------------------------ 
 * Load / save options from localStorage 
 * ------------------------------------------------------------------ */
  onMounted(() => {
    const v = localStorage.getItem("showConst");
    if (v !== null) showConst.value = v === "1";

    const r = localStorage.getItem("showRdOnly");
    if (r !== null) showRdOnly.value = r === "1";

    const i = localStorage.getItem("showIntern");
    if (i !== null) showIntern.value = i === "1";

    const l = localStorage.getItem("showLaten");
    if (l !== null) showLaten.value = l === "1";
  });
  
  onMounted(() => {
    const v = localStorage.getItem("graphIterations");
    if (v !== null) iters.value = parseInt(v);
  });

  watch(showConst,  v => localStorage.setItem("showConst",  v ? "1" : "0"));
  watch(showRdOnly, v => localStorage.setItem("showRdOnly", v ? "1" : "0"));
  watch(showIntern, v => localStorage.setItem("showIntern", v ? "1" : "0"));
  watch(showLaten,  v => localStorage.setItem("showLaten",  v ? "1" : "0"));
  watch(iters, v => localStorage.setItem("graphIterations", v));
  
/* ------------------------------------------------------------------ 
* UI actions 
* ------------------------------------------------------------------ */
  function changeIters(delta) {
    let v = iters.value + delta
    if (v < 1) v = 1
    if (v > 10) v = 10
    iters.value = v
  }

  function toggleConst()  { showConst.value  = !showConst.value  }
  function toggleRdOnly() { showRdOnly.value = !showRdOnly.value }
  function toggleIntern() { showIntern.value = !showIntern.value }
  function toggleLaten()  { showLaten.value  = !showLaten.value  }

  watch(
    [iters, showConst, showRdOnly, showIntern, showLaten],
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
      showConst.value,
      showRdOnly.value,
      showIntern.value,
      showLaten.value
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
  function openTutorial() {
    nextTick(() => {
      const el = infoIcon.value
      if (el) {
        const r = el.getBoundingClientRect()
        tutorialPosition.value = {
          top: `${r.bottom}px`,
          left: `${r.right}px`
        }
        showTutorial.value = true
      }
    })
  }

  function closeTutorial() {
    showTutorial.value = false
  }
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        
        <!-- Título -->
        <span ref="infoIcon" class="info-icon" @click="openTutorial">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Performance Analysis</span>
        
        <!-- Iteraciones -->
        <div class="iters-group">
          <span class="iters-label">Iters</span>
          <button class="gray-button" @click="changeIters(-1)">−</button>
          <input type="number" min="1" max="10" v-model.number="iters">
          <button class="gray-button" @click="changeIters(1)">+</button>
        </div>
        
        <!-- Flags -->
        <div class="flags-group">
          <button class="blue-button" :class="{ active: showConst }"  :aria-pressed="showConst"  @click="toggleConst"><span v-if="showConst">✔ </span>Const</button>
          <button class="blue-button" :class="{ active: showRdOnly }" :aria-pressed="showRdOnly" @click="toggleRdOnly"><span v-if="showRdOnly">✔ </span>ReadOnly</button>
          <button class="blue-button" :class="{ active: showIntern }" :aria-pressed="showIntern" @click="toggleIntern"><span v-if="showIntern">✔ </span>Internal</button>
          <button class="blue-button" :class="{ active: showLaten }"  :aria-pressed="showLaten"  @click="toggleLaten"><span v-if="showLaten">✔ </span>Latencies</button>
        </div>
      </div>
    </div>

    <div class="annotations-wrapper">
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
        <h4 class="graph-title">
          Data Dependence Graph
          <span class="graph-subtitle">
            (Circular paths in red)
          </span>
        </h4>
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
        <h3>Data Dependence Graph & Circular Dependence Paths (in red)</h3>
        <button class="close-btn" @click="closeFullScreen">x</button>
      </div>
      <div class="output-block" id="dependence-graph-full"></div>
    </div>
  </div>
  <TutorialComponent v-if="showTutorial" :position="tutorialPosition"
  text="The data dependency graph highlights circular dependencies (shown in red) that determine latency-bound execution time.
   Click the fullscreen button to enlarge the graph. Expand the performance analysis tab for a detailed breakdown of statically-determined throughput and latency bottlenecks."
  title="Static Performance Analysis"
  @close="closeTutorial"/>
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
    align-items: center;      /* alineación vertical */
    gap: 0.5rem;              /* espacio uniforme */
    flex-wrap: wrap;          /* evita desbordes */
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
  .iters-label {
    margin-left: 0.5rem;
    font-weight: 500;
  }
  .gray-button {
    font-size: inherit;
    height: 1.8em;
    padding: 0 0.6em;
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
    all: unset;                    /* reset de botón */
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
  background: #f0f0f0;     /* color de fondo por defecto */
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
  background: #e0e0e0;      /* más oscuro al hover */
}
.icon-button:active {
  background: #d0d0d0;      /* aún más oscuro al pulsar */
}
.icon-button:focus {
  outline: 2px solid #1a4fb3;  /* para teclado */
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
    margin-bottom: 12px;
  }
  .fullscreen-title {
    margin: 0;
    font-size: 1.2em;
    font-weight: 500;
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
