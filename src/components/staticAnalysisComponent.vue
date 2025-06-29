<script setup>
  import { ref, onMounted, nextTick, onUnmounted } from "vue";
  import TutorialComponent from '@/components/tutorialComponent.vue';

  let processorsListHandler;
  let programsListHandler;
  const showAnnotations = ref(false);
  const showFullScreen = ref(false);
  const showTutorial = ref(false);
  const tutorialPosition = ref({ top: '50%', left: '50%' });
  const infoIcon = ref(null);

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

  function openFullScreen() {
    showFullScreen.value = true;
    // after DOM updates, clone the existing SVG into the popup
    nextTick(() => {
      const src = document.getElementById("simulation-output");
      const dst = document.getElementById("simulation-output-full");
      if (src && dst) {
        dst.innerHTML = "";
        dst.appendChild(src.querySelector("svg").cloneNode(true));
      }
    });
  }

  function closeFullScreen() {
    showFullScreen.value = false;
  }

  function toggleAnnotations() {
    showAnnotations.value = !showAnnotations.value;

    if (showAnnotations.value) {
      if (typeof programShowPerfAnnotations === "function") {
        nextTick(() => {
          programShowPerfAnnotations();
        });
      } else {
        console.error("programShowPerfAnnotations function not found.");
      }
    }
  }

  onMounted(() => {
    nextTick(() => {
      const processorsList = document.getElementById("processors-list");
      if (processorsList) {
        processorsListHandler = () => {
          setTimeout(() => {
            if (showAnnotations.value && typeof programShowPerfAnnotations === "function") {
              programShowPerfAnnotations();
            }
          }, 100);
        };
        processorsList.addEventListener("change", processorsListHandler);
      }
      const programsList = document.getElementById("programs-list");
      if (programsList) {
        programsListHandler = () => {
          setTimeout(() => {
            if (showAnnotations.value && typeof programShowPerfAnnotations === "function") {
              programShowPerfAnnotations();
            }
          }, 100);
        };
        programsList.addEventListener("change", programsListHandler);
      }

      if (typeof showCriticalPathsGraph === "function") {
        showCriticalPathsGraph();
      } else {
        console.error("simulation-output element not found.");
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
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="infoIcon" class="info-icon" @click="openTutorial" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <h3>Static Performance Analysis</h3>
      </div>
    </div>

    <div class="annotations-wrapper">
      <div class="annotations-header" @click="toggleAnnotations">
        <span class="arrow">{{ showAnnotations ? '▼' : '▶' }}</span>
        <span class="title"><b>Analysis of Performance limits: Throughput and Latency Bounds</b></span>
      </div>

      <Transition name="fold" appear>
        <pre v-show="showAnnotations" id="performance-annotations" class="annotations-box"></pre>
      </Transition>
    </div>
    <div class="output-block-wrapper" id="simulation-output-container">
      <div class="graph-header">
        <button class="blue-button" @click="openFullScreen">
          <img src="/img/fullscreen.png" class="fs-img">
        </button>
        <h4>Data Dependence Graph & Circular Dependence Paths (circular paths in red)</h4>
      </div>
      <div class="output-block" id="simulation-output"></div>
    </div>
  </div>
  <div v-if="showFullScreen" class="fullscreen-overlay">
    <div class="fullscreen-content">
      <div class="fullscreen-header">
        <h3>Data Dependence Graph & Circular Dependence Paths (circular paths in red)</h3>
        <button class="close-btn" @click="closeFullScreen">x</button>
      </div>
      <div class="output-block" id="simulation-output-full"></div>
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
  }
  .header {
    position: sticky;
    padding-top:2px;
    padding-bottom:5px;
    top: -5px;
    left:0;
    background: white;
    width: 100%;
  }
  h3 {
    margin: 0;
  }
  .annotations-wrapper {
    margin-top: 5px;
  }
  .annotations-header {
    cursor: pointer;
    background-color: #f0f0f0;
    padding: 4px 8px;
    border-radius: 5px 5px 0 0;
    display: flex;
    align-items: center;
    font-size: 14px;
  }
  .annotations-header .arrow {
    margin-right: 5px;
  }
  .annotations-box {
    white-space: pre-wrap;
    background: #f0f0f0;
    padding: 10px;
    border-radius: 0 0 5px 5px;
    margin-top: 0;
    font-size: 2.5vh;
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
    flex: 1;
    overflow: hidden;
  }

  .output-block svg {
    width: 100%;
    height: 100%;
  }

  .graph-header {
    display: inline-flex;
    align-items: center;
    gap: 0.5em; /* space between button and title */
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

  .title {
    font-size: 2.75vh;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5em;
    line-height: 1;
    cursor: pointer;
    padding: 4px;
  }

  .output-block-wrapper {
    display: flex;
    flex-direction: column;
    height: 90%;
  }

  .graph-header {
    flex: 0 0 auto;
  }

  .output-block {
    flex: 1 1 auto;
    position: relative;
    overflow: hidden;
  }

  .output-block svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100% !important;
    height: 100% !important;
  }



</style>
