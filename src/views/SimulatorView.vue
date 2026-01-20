<script setup>
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick, watch, computed } from 'vue';

import processorComponent      from '@/components/processorComponent.vue';
import programComponent        from '@/components/programComponent.vue';
  
import timelineComponent       from '@/components/timelineComponent.vue';
import aboutComponent          from '@/components/aboutComponent.vue';
import staticAnalysisComponent from '@/components/staticAnalysisComponent.vue';
import simulationComponent     from '@/components/simulationComponent.vue';
  
import { useRVCAT_Api }        from '@/rvcatAPI';

const simState                      = inject('simulationState');
const { isReady, registerHandler }  = inject('worker');
const { importRVCAT }               = useRVCAT_Api();

/* ------------------------------------------------------------------ 
 * Main Simulator Panel UI
 * ------------------------------------------------------------------ */
  
// Modal & navigation state, Current view key & component
const showLeaveModal    = ref(false);
const pendingKey        = ref(null);
const showOverlay       = ref(true);
const loadingMessage    = ref('Initializing');

// full screen mode
const isFullscreen = ref(false);
const isProcessor  = ref(false);
const fullProcessorButtonText  = computed(() => 
  (isFullscreen.value && isProcessor.value)? '📍Edit Processor' : '📌Edit Processor'
);
const fullProgramButtonText  = computed(() => 
  (isFullscreen.value && !isProcessor.value)? '📍Edit Program' : '📌Edit Program'
);

const containerClasses = computed(() => ({
  'processor-fullscreen': isFullscreen.value && isProcessor.value,
  'program-fullscreen':   isFullscreen.value && !isProcessor.value,
  // Puedes añadir más clases condicionales aquí
}));

// Map of component keys -> component definitions
const components = {
  timelineComponent,
  staticAnalysisComponent,
  aboutComponent,
  simulationComponent
};

const currentKey        = ref('simulationComponent')
const currentComponent  = shallowRef(components[currentKey.value])
let   cleanupRVCAT      = null
  
// Handle requests from header  <-------------------------------- TODO
function onRequestSwitch(key) {
  const nextComp = components[key];
  currentKey.value       = key;
  currentComponent.value = nextComp;
}

// Confirm or cancel navigation
function confirmLeave() {
  showLeaveModal.value = false;
  if (pendingKey.value) {
    currentKey.value       = pendingKey.value;
    currentComponent.value = components[pendingKey.value];
    pendingKey.value       = null;
  }
}
  
function cancelLeave() {
  showLeaveModal.value = false;
  pendingKey.value     = null;
}

function closeLoadingOverlay() { showOverlay.value = false }

// Handler for 'import_rvcat' message
const handleRVCAT = async (data, dataType) => {
  if (dataType === 'error') {
    console.error('Failed to import RVCAT:', data);
    return;
  }
  loadingMessage.value = 'Loading complete!';
  setTimeout(() => closeLoadingOverlay(), 1000)
  simState.RVCAT_state = 1;  // fires processor & program components to set processor/program
};
 
onMounted(() => {
  nextTick(() => {
      loadingMessage.value = 'Loading RVCAT';
      showOverlay.value    = true
  });
  cleanupRVCAT = registerHandler('import_rvcat', handleRVCAT);
});

onUnmounted(() => {
  if (cleanupRVCAT) {
     cleanupRVCAT()
     cleanupRVCAT = null
  }
});
  
watch(isReady, (ready) => {
  if (ready) {
      loadingMessage.value = 'Loading complete!';
      importRVCAT();  // from RVCAT API
  }
})

function toggleProcessorFullscreen() {
  if (!isFullscreen.value) {
    isFullscreen.value= true
    isProcessor.value = true
    document.querySelector('.grid-item.processor').scrollIntoView({ behavior: 'smooth' });
  }
  else  if (isProcessor.value)
    isFullscreen.value= false
}
  
function toggleProgramFullscreen() {
  if (!isFullscreen.value) {
    isFullscreen.value= true
    isProcessor.value = false
    document.querySelector('.grid-item.program').scrollIntoView({ behavior: 'smooth' });
  }
  else if (!isProcessor.value)
    isFullscreen.value= false
}

</script>

<template>
  <body>
    <header>
     <div id="top" class="header-title"> 
       <img src="/img/favicon.png" class="title-img"> 
       <h1>RVCAT-WEB</h1>
       <nav>
        <ul>
          <li>
            <button class="blue-button" title="Open full window for processor configuration (pinned/unpinned)" 
              :class="{ 'active': isFullscreen && isProcessor }" 
              @click="toggleProcessorFullscreen" >
                {{ fullProcessorButtonText }}
            </button>
          </li>
          <li>
            <button class="blue-button" title="Open full window for program edition (pinned/unpinned)" 
              :class="{ 'active': isFullscreen && !isProcessor}" 
              @click="toggleProgramFullscreen" >
                {{ fullProgramButtonText }}
            </button>
          </li>
          <li>
            <button class="blue-button" title="Simulate Program's execution"
              :class="{ active: currentKey === 'simulationComponent' }"
              @click="onRequestSwitch('simulationComponent')" > 
                Simulation
            </button>
          </li>
          <li>
            <button class="blue-button" title="Static Performance Analysis"
              :class="{ active: currentKey === 'staticAnalysisComponent' }"
              @click="onRequestSwitch('staticAnalysisComponent')" >
                Static Analysis
            </button>
          </li>
          <li>
            <button class="blue-button" title="Detailed Timeline of Program's execution"
              :class="{ active: currentKey === 'timelineComponent' }"
              @click="onRequestSwitch('timelineComponent')" >
                Timeline
            </button>
          </li>
          <li>
            <button class="blue-button" title="Information about this tool"
            :class="{ active: currentKey === 'aboutComponent' }"
            @click="onRequestSwitch('aboutComponent')" >
              About
            </button>
          </li>
        </ul>
       </nav>
     </div>
    </header>

    <div class="blur-overlay" :style="{ display: showOverlay ? 'block' : 'none' }"></div>
    <div class="overlay"      :style="{ display: showOverlay ? 'block' : 'none' }">
      <div class="spinner"></div>
      <p>{{ loadingMessage }}</p>
      <p>Please wait. Loading can take several seconds</p>
    </div>
    
    <main class="container" :class="containerClasses">
      
      <div v-show="!isFullscreen || isProcessor" class="grid-item processor" :class="{ 'fullscreen': isFullscreen && isProcessor }">
        <processorComponent :is-fullscreen="isFullscreen && isProcessor" />
      </div>
      
      <div v-show="!isFullscreen || !isProcessor" class="grid-item program" :class="{ 'fullscreen': isFullscreen && !isProcessor }">
        <programComponent />
      </div>
      
      <div v-show="!isFullscreen" class="grid-item results">
        <component :is="currentComponent" v-if="currentComponent" ref="settingsCompInst" />
        <div v-else>Component not found</div>
      </div>

      <div v-if="showLeaveModal" class="modal-overlay">
        <div class="modal">
          <p>You should apply (save) the changes on the processor settings before leaving this page.</p>
          <p><b>Do you want to continue?</b></p>
          <div class="modal-actions">
            <button @click="confirmLeave" title="Leave"  class="blue-button">OK</button>
            <button @click="cancelLeave"  title="Cancel" class="blue-button">Cancel</button>
          </div>
        </div>
      </div>
    </main>
  </body>
</template>

<style scoped>
#top {
  max-height: 5vh;
  width:      100vw;
  padding:    0.6%;
  display:    flex;
  color:      white;
  padding:    20px 10px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
  box-sizing: border-box;
  align-items:     center;
  justify-content: space-between;
  background-color: #007acc;
}

h1 {
  margin:    0;
  font-size: 4vh;
}
nav ul {
  list-style: none;
  padding:    0;
  margin:     0;
  display:    flex;
}
nav ul li {
  margin: 0 5px;
}
  
.title-img {
  height:     4vh;
  margin-top: 0.25vh;
}
  
.header-title {
  display:flex;
  gap:    5px;
}

.container {
  position:              relative;
  display:               grid;
  grid-template-columns: 34% 65.5%;
  grid-auto-rows:        48% 52%;
  gap:          0.5vh;
  width:        100vw;
  height:        98vh;
  margin-top:   0.5vh;
  margin-right: 0.5vh;
  background:   #e3e3e3;
  overflow:     hidden;
  box-sizing:   border-box;
  transition:   all 0.3s ease;
}
  
.processor { grid-column: 1; grid-row: 1; }
.program   { grid-column: 1; grid-row: 2; }
.results   { grid-column: 2; grid-row: 1 / 3; min-width: 0;}

.container.processor-fullscreen {
  grid-template-columns: 1fr;
  grid-template-rows:    1fr;
  position: fixed; /* Contenedor fijo */
  top:    40px;    /* Debajo del header */
  left:   0;
  right:  0;
  bottom: 0;
  background: white;
  z-index: 999;
  padding: 0;    /* Sin padding en fullscreen */
}

.container.program-fullscreen {
  grid-template-columns: 1fr;
  grid-template-rows:    1fr;
  position: fixed; /* Contenedor fijo */
  top:    40px;    /* Debajo del header */
  left:   0;
  right:  0;
  bottom: 0;
  background: white;
  z-index: 999;
  padding: 0;    /* Sin padding en fullscreen */
}

.grid-item {
  position:      relative;
  background:    white;
  border-radius: 3px;
  min-width:     0;
}

 .grid-item.processor {
  display:  grid;
  overflow: hidden;
}
.grid-item.program,
.grid-item.results {
  display:    grid;
}

.grid-item.processor.fullscreen {
  grid-column:   1 / span 3;
  grid-row:      1;
  height: 100%;
  width:  100%;
  position:      relative;
  top:           0;
  left:          0;
  right:         0;
  bottom:        0;
  z-index:       999;
  border-radius: 0;
  border:        none;
  box-shadow:    0 0 10px rgba(0,0,0,0.3);
}

/* Ocultar otros componentes en pantalla completa */
.container.processor-fullscreen .grid-item.program,
.container.processor-fullscreen .grid-item.results {
  display: none;
}
  
.grid-item.program.fullscreen {
  grid-column:   1 / span 3;
  grid-row:      1;
  height: 100%;
  width:  100%;
  position:      relative;
  top:           0;
  left:          0;
  right:         0;
  bottom:        0;
  z-index:       999;
  border-radius: 0;
  border:        none;
  box-shadow:    0 0 10px rgba(0,0,0,0.3);
}

  /* Ocultar otros componentes en pantalla completa */
.container.program-fullscreen .grid-item.processor,
.container.program-fullscreen .grid-item.results {
  display: none;
}

  
.blur-overlay {
  top:      0;
  left:     0;
  width:    100%;
  height:   100%;
  z-index:  1000;
  position: fixed;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(5px);
}

.overlay {
  top:   50%;
  left:  50%;
  z-index: 1001;
  position:   fixed;
  transform:  translate(-50%, -50%);
  background: white;
  padding:    2rem;
  border-radius: 8px;
  box-shadow:    0 4px 20px rgba(0, 0, 0, 0.2);
  text-align: center;
  min-width: 300px;
}

.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #3498db;
  border-radius: 50%;
  width:    40px;
  height:   40px;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.grid-item.processor.fullscreen .processor-content {
  padding:   0px;
  max-width: 1400px;
  margin:    0 auto;
}

.grid-item.processor.fullscreen::-webkit-scrollbar {
  width: 10px;
}

.grid-item.processor.fullscreen::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.grid-item.processor.fullscreen::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 5px;
}

.grid-item.program.fullscreen .processor-content {
  padding:   0px;
  max-width: 1400px;
  margin:    0 auto;
}

.grid-item.program.fullscreen::-webkit-scrollbar {
  width: 10px;
}

.grid-item.program.fullscreen::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.grid-item.program.fullscreen::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 5px;
}

</style>
