<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, watch, reactive } from 'vue'
  import HelpComponent    from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';
 
  const { getDependenceGraph, getPerformanceAnalysis } = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  /* ------------------------------------------------------------------ 
   * Dependence Graph options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const dependenceGraphOptions = reactive({
    iters:      1,
    showIntern: false,
    showLaten:  false,
    showSmall:  false,
    showFull:   false
  })
  
  const dependenceGraphSvg     = ref('')
  const fullDependenceGraphSvg = ref('')
  let graphTimeout          = null
  let cleanupHandleGraph    = null;
  let cleanupHandleAnalysis = null

  const showPerformance    = ref(false);
  const showFullScreen     = ref(false);
    
  // Load / save options from localStorage
  const STORAGE_KEY = 'dependentGraphOptions'

  // Save on changes
  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dependenceGraphOptions))
    } catch (error) {
      console.error('❌ Failed to save:', error)
    }
  }
  
  // Load from localStorage
  onMounted(() => {
    cleanupHandleGraph    = registerHandler('get_dependence_graph',     handleGraph);
    cleanupHandleAnalysis = registerHandler('get_performance_analysis', handleAnalysis);

    try {    // Load from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(dependenceGraphOptions, JSON.parse(saved))
      }
    } catch (error) {
      console.error('❌ Failed to load:', error)
    }
  });

  // Clean up on unmount
  onUnmounted(() => {
    if (cleanupHandleGraph) {
        cleanupHandleGraph();
        cleanupHandleAnalysis();
        cleanupHandleGraph    = null;
        cleanupHandleAnalysis = null
    }
  })

 /* ------------------------------------------------------------------ 
  * Dependence Graph options: UI actions 
  * ------------------------------------------------------------------ */
  function toggleIntern() { dependenceGraphOptions.showIntern = !dependenceGraphOptions.showIntern }
  function toggleLaten()  { dependenceGraphOptions.showLaten  = !dependenceGraphOptions.showLaten  }
  function toggleSmall()  { dependenceGraphOptions.showSmall  = !dependenceGraphOptions.showSmall  }
  function toggleFull()   { dependenceGraphOptions.showFull   = !dependenceGraphOptions.showFull }

  // Watch ALL graph options for changes
  watch(dependenceGraphOptions, () => {
    clearTimeout(graphTimeout)
    try {
      if (dependenceGraphOptions.iters > 7) { 
        dependenceGraphOptions.iters = 7
      }  else if (dependenceGraphOptions.iters < 1) { 
        dependenceGraphOptions.iters = 1
      }
      saveOptions()
      graphTimeout = setTimeout(() => {
        getDependenceGraph(
          dependenceGraphOptions.iters,
          dependenceGraphOptions.showIntern,
          dependenceGraphOptions.showLaten,
          dependenceGraphOptions.showSmall,
          dependenceGraphOptions.showFull
        )
      }, 75)
      console.log('✅ Saved graph options:', dependenceGraphOptions)
    } catch (error) {
      console.error('Failed to save dependence graph options:', error)
    } 
  },
  { deep: true, immediate: true })

// Watch multiple reactive sources
watch (
  [() => simState.selectedProgram, () => simState.selectedProcessor],
  ([newProgram, newProcessor], [oldProgram, oldProcessor]) => {
    // Check if either changed meaningfully
    const programChanged   = newProgram   && newProgram   !== oldProgram
    const processorChanged = newProcessor && newProcessor !== oldProcessor
    
    if (!programChanged && !processorChanged) return

    if (programChanged && showPerformance.value) {
      getPerformanceAnalysis();
    }
    
    clearTimeout(graphTimeout)
    graphTimeout = setTimeout(() => {
      getDependenceGraph(
        dependenceGraphOptions.iters,
        dependenceGraphOptions.showIntern,
        dependenceGraphOptions.showLaten,
        dependenceGraphOptions.showSmall,
        dependenceGraphOptions.showFull
      )
    }, 75)
    
    console.log('✅ Graph updated:', { 
      program: newProgram, 
      processor: newProcessor,
      reason: programChanged ? 'program' : 'processor'
    })
  },
  { immediate: false })
  
  // Handler for 'get_dependence_graph' message (fired by RVCAT getDependenceGraph function)
  const handleGraph = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to get dependence graph:', data);
      return;
    }
    try {
       const svg = await createGraphVizGraph(data);  
       dependenceGraphSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('Failed to generate SVG for graphviz Dependence Graph:', error)
      dependenceGraphSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  // Handler for 'get_performance_analysis' message (fired by RVCAT getPerformanceAnalysis function)
  const handleAnalysis = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to get performance analysis:', data);
      return;
    }
    try {
      console.log('✅ Performance Analysis:', data)
    } catch (error) {
      console.error('Failed to generate SVG for graphviz Dependence Graph:', error)
      dependenceGraphSvg.value = `<div class="error">Failed to render graph</div>`;
    }
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
        getPerformanceAnalysis();
      });
    }
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
        
        <!-- Title -->
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Static Performance Analysis</span>
      </div>
    </div>

    <div class="dropdown-wrapper">
      <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show Help" >
         <img src="/img/info.png" class="info-img">
      </span>
      <button class="dropdown-header" @click="toggleAnnotations" title="Show Throughput limits" :aria-expanded="showPerformance">
        <span class="arrow" aria-hidden="true">
          {{ showPerformance ? '▼' : '▶' }}
        </span>
        <span class="dropdown-title">
          Throughput-bound Limits
        </span>
      </button>
    </div>
    <Transition name="fold" appear>
      <pre v-show="showPerformance" id="performance-limits" class="annotations-box"></pre>
    </Transition>
    
    <div class="output-block-wrapper" id="simulation-output-container">
      <div class="graph-toolbar">
        <span ref="helpIcon3" class="info-icon" @click="openHelp3" title="Show Help">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="dropdown-title">Data Dependence Graph</span>

        <div class="controls">
          <div class="iters-group">
            <span class="iters-label">Iterations:</span>
            <input type="number" min="1" max="7" title="# loop iterations (1 to 7)" v-model.number="dependenceGraphOptions.iters">
          </div>
          <div class="iters-group">
            <button class="blue-button" :class="{ active: dependenceGraphOptions.showIntern }"  
                    title="Show/Hide Nodes with only internal data dependencies" @click="toggleIntern"> 
              <span v-if="dependenceGraphOptions.showIntern">✔ </span>Internal</button>
            <button class="blue-button" :class="{ active: dependenceGraphOptions.showLaten  }"   
                    title="Show/Hide Execution Latencies" @click="toggleLaten"> 
              <span v-if="dependenceGraphOptions.showLaten">✔ </span>Latencies</button>
            <button class="blue-button" :class="{ active: dependenceGraphOptions.showSmall  }"   
                    title="Show/Hide Instruction Text" @click="toggleSmall"> 
              <span v-if="dependenceGraphOptions.showSmall">✔ </span>Small</button>
            <button class="blue-button" :class="{ active: dependenceGraphOptions.showFull   }" 
                    title="Show/Hide constant and read-only input data dependencies" @click="toggleFull">  
              <span v-if="dependenceGraphOptions.showFull">✔ </span>Full</button>
          </div>
          <button class="icon-button" @click="openFullScreen" title="Open fullscreen">
             <img src="/img/fullscreen.png" class="bt-img">
          </button>
        </div>
      </div>
   
      <div class="output-block">
        <div v-html="dependenceGraphSvg" v-if="dependenceGraphSvg"></div>
      </div>
    </div>
  </div>
  
  <div v-if="showFullScreen" class="fullscreen-overlay">
    <div class="fullscreen-content">
      <div class="fullscreen-header">
        Data Dependence Graph (circular paths in red)
        <button class="close-btn" @click="closeFullScreen">x</button>
      </div>
      <div class="output-block">
        <div v-html="dependenceGraphSvg" v-if="dependenceGraphSvg"></div>
      </div>
    </div>
  </div>
  
  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition"
    text="<em>Statically</em> determined <strong>throughput</strong> and <strong>latency</strong> bottlenecks. <p>The minimum execution time per loop iteration may be <em>throughput-bound</em>, 
      meaning it is limited by the processor’s instruction <strong>dispatch</strong>, <strong>execution</strong>, or <strong>retirement</strong> capacity for a given subset of instructions.</p> 
      <p>Alternatively, it may be <em>latency-bound</em>, meaning it is constrained by a <strong>loop-carried chain of data dependencies</strong> that forms a critical path across iterations.</p>"
    title="Static Performance Analysis"
    @close="closeHelp1"/>
  </Teleport>
  
  <Teleport to="body">
    <HelpComponent v-if="showHelp2" :position="helpPosition"
    text="Performance may be limited by the <strong>maximum throughput</strong> of a hardware resource, 
         such as <em>dispatch width</em> or a set of <em>execution ports</em> required to execute a particular subset of instructions."
    title="Throughput-bound execution time"
    @close="closeHelp2"/>
  </Teleport>
  
  <Teleport to="body">  
    <HelpComponent v-if="showHelp3" :position="helpPosition"
    text="The data dependence graph highlights <strong>circular</strong> dependencies (shown in red) that determine <em>latency-bound</em> execution time (cycles per loop iteration).
      <p>You can show or hide internal dependencies, execution latencies, instruction details, and full input dependencies on constant and read-only values.
      Click the <strong>fullscreen</strong> button to enlarge the graph.</p>"
    title="Latency-bound execution time"
    @close="closeHelp3"/>
    </Teleport>
</template>

<style scoped>
  .iters-group input[type="number"] { width: 4ch; }

  .graph-toolbar {
    display:     flex;
    align-items: center;
    gap:         8px;
    width:       100%;
    box-sizing:  border-box;
    overflow:    hidden;
    min-width:   0;
  }
  .controls {
    display:     flex;
    align-items: center;
    gap:         8px;
    margin-left: auto;
    min-width:   0;
  }
  .output-block-wrapper {
    display:        flex;
    flex-direction: column;
    overflow:       hidden;
    width:          100%;
    min-width:      0;
  }
  .output-block {
    position:   relative;
    flex:       1;
    width:      100%;
    min-width:  0;
    overflow:   hidden;
    border:     1px solid #e0e0e0;
    border-radius: 6px;
  } 
  .output-block svg {
    position: absolute;
    inset:    0;
    width:    100%;
    height:   auto;
    max-width:  100%;
    display:    block;
  }

  .icon-button {
    border:    none;
    cursor:    pointer;
    padding:   6px;
    display:   inline-flex;
    align-items: center;
    background:  #b0b0b0;
    transition:  background 0.2s;
    justify-content: center;
    border-radius:   6px;
    margin-left:     auto;
  }
  .icon-button img,
  .icon-button svg {
    width:  1.2em;
    height: 1.2em;
  }
  .icon-button:hover {
    background: #a0a0a0;      /* darker at hover */  
  }
  .icon-button:active {
    background: #909090;      /* still darker */
  }
  .icon-button:focus {
    outline:        2px solid #1a4fb3;  /* keypad */
    outline-offset: 2px;
  }
  .close-btn {
    background:  none;
    border:      none;
    font-size:   1.5em;
    line-height: 1;
    cursor:      pointer;
    padding:     4px;
  }
  .btn-img {
    height:2.5vh;
  }

 .fullscreen-overlay {
    position: fixed;
    top:      0; 
    left:     0;
    width:    100vw; height: 100vh;
    display:  flex;
    z-index:  1000;
    align-items: center;
    background:  rgba(0,0,0,0.4);
    justify-content: center;
  }
  .fullscreen-content {
    background: white;
    margin:     10px;
    padding:    10px;
    border:     1px solid #ccc;
    width:      95%;
    height:     95%;
    resize:     both;
    overflow:   auto;
    min-width:  300px;
    min-height: 200px;
    max-width:  99%;
    max-height: 99%;
    display:    flex;
    border-radius:  8px;
    flex-direction: column;
    box-shadow:     0 4px 12px rgba(0,0,0,0.25);
  }
  .fullscreen-content .close-btn {
    align-self: flex-end;
    background: none;
    border:     none;
    font-size:  3vh;
    cursor:     pointer;
    margin-bottom: 8px;
  }
  .fullscreen-header {
    display:         flex;
    justify-content: space-between;
    align-items:     center;
    margin-bottom:   10px;
  }
  .fullscreen-title {
    font-size:   1.5rem;
    font-weight: 600;
    margin:      0;
  }
  
  .annotations-box {
    white-space: pre-wrap;
    background:  #f3f3f3;
    padding:     10px;
    margin-top:  0;
    font-size:   0.8rem;
    line-height: 1.2;
    border-radius: 0 0 5px 5px;
  }
  
</style>
