<script setup>
  import { onMounted, nextTick, ref, watch } from "vue";
  import TutorialComponent                   from '@/components/tutorialComponent.vue';

  const showCriticalPath = ref(false);
  const showTutorial     = ref(false);
  const tutorialPosition = ref({ top: '50%', left: '50%' });
  const infoIcon         = ref(null);

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

  function toggleCriticalPath() {
    showCriticalPath.value = !showCriticalPath.value;
  }

  function getCookie(name) {
    const re = new RegExp(
      "(?:^|; )" +
        name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") +
        "=([^;]*)"
    );
    const match = document.cookie.match(re);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days = 30) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(
      value
    )}; max-age=${maxAge}; path=/`;
  }

  const iterations = ref(parseInt(getCookie("simulationIterations")) || 1);
  watch(iterations, (v) => setCookie("simulationIterations", v));


  onMounted(() => {
    nextTick(() => {
      if (typeof reloadRvcat === "function") {
        reloadRvcat();
      } else {
        console.error("simulation-graph element not found.");
      }
    });
  });

  function changeIterations(delta) {
    const min = 1;
    const max = 2000;
    let v = iterations.value + delta;
    if (v < min) v = min;
    if (v > max) v = max;
    iterations.value = v;
  }
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="infoIcon" class="info-icon" @click="openTutorial" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <h3>Simulation</h3>
      </div>
      <div class="iters-run">
        <div class="iterations-group">
          Iterations:
          <button type="button" class="gray-button" @click="changeIterations(-1)">−</button>
          <input type="number" id="num-iters" class="iterations-input" name="iterations" min="1" max="20000" v-model.number="iterations">
          <button type="button" class="gray-button" @click="changeIterations(1)">+</button>
        </div>
        <button id="run-simulation-button" class="blue-button" onclick="getSchedulerAnalysis();">Run</button>
      </div>
    </div>

    <div id="simulation-results-info" class="results-info">
      <div class="row">
        <div class="simulation-inline-item">
          <label for="instructions"><b>Instructions:</b></label>
          <span id="instructions-output">?</span>
        </div>
        <div class="simulation-inline-item">
          <label for="cycles"><b>Cycles:</b></label>
          <span id="cycles-output">?</span>
        </div>
      </div>
      <div class="row">
        <div class="simulation-inline-item">
          <label for="cycles-per-iteration"><b>Cycles per iteration:</b></label>
          <span id="cycles-per-iteration-output">?</span>
        </div>
        <div class="simulation-inline-item">
          <label for="IPC"><b>IPC:</b></label>
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
    <div class="critical-wrapper" id="critical-path-section" style="display: none;">
      <div class="critical-header" @click="toggleCriticalPath">
        <span class="arrow">{{ showCriticalPath ? '▼' : '▶' }}</span>
        <span class="title"><b>Critical Execution Path</b></span>
      </div>

      <Transition name="fold" appear>
        <div v-show="showCriticalPath" id="critical-path" class="critical-box">
        </div>
      </Transition>
    </div>

    <div id="graph-section" class="graph-section" style="display: none;">
        <h4>Processor Bottlenecks</h4>
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
  <TutorialComponent v-if="showTutorial" :position="tutorialPosition"
  text="Simulate a specified number of program loop iterations and display aggregate performance metrics.
   Hover over processor execution ports to inspect their utilization, or open the corresponding tab to visualize the time distribution of instructions along the critical path."
  title="Overall Simulation Results"
  @close="closeTutorial"
  />
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
  h3 {
    margin: 0;
  }
  h4 {
    text-align: center;
    width: 100%;
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
  .iters-run{
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap:5px;
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

  .iterations-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .iterations-input {
    width: 8vh;
    padding: 2px;
    text-align: center;
    -moz-appearance: textfield;
  }
  .iterations-input::-webkit-outer-spin-button,
  .iterations-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
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
    border-radius: 6px;
    margin-top: 5px;
  }
  .critical-header {
    display: flex;
    align-items: center;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 6px 6px 0 0;
    background: #f0f0f0;
  }
  .critical-header .arrow {
    margin-right: 8px;
    font-size: 0.9em;
  }
  .critical-header .title {
    font-size: 1em;
  }

  /* content box */
  .critical-box {
    overflow: hidden;
    padding: 10px;
    background:  #f0f0f0;
    border-radius: 0 0 6px 6px;
  }
</style>
