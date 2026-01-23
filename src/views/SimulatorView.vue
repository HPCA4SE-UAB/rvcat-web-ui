<script setup>
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick, watch, computed } from 'vue';

import processorComponent      from '@/components/processorComponent.vue';
import programComponent        from '@/components/programComponent.vue';

import tutorialComponent       from '@/components/tutorialComponent.vue';
import tutorialEditor          from '@/components/tutorialEditor.vue';
  
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

// full screen mode
const FULL_NONE      = 0
const FULL_PROCESSOR = 1
const FULL_PROGRAM   = 2
const FULL_TUTORIAL  = 3
const fullComponent = ref(FULL_NONE);

// Computed para usar en template
const isNotFullscreen       = computed(() => fullComponent.value === FULL_NONE);
const isProcessorFullscreen = computed(() => fullComponent.value === FULL_PROCESSOR);
const isProgramFullscreen   = computed(() => fullComponent.value === FULL_PROGRAM);
const isTutorialFullscreen  = computed(() => fullComponent.value === FULL_TUTORIAL);

const getButtonText = (componentType, baseText) => {
  return computed(() => 
    fullComponent.value === componentType ? `📍${baseText}` : `📌${baseText}`
  );
};

// Button texts usando el helper
const fullProcessorButtonText = getButtonText(FULL_PROCESSOR, 'Edit Processor');
const fullProgramButtonText   = getButtonText(FULL_PROGRAM,   'Edit Program');
const fullTutorialButtonText  = getButtonText(FULL_TUTORIAL,  'Edit Tutorial');

// Container classes
const containerClasses = computed(() => ({
  'processor-fullscreen': isProcessorFullscreen.value,
  'program-fullscreen':   isProgramFullscreen.value,
  'tutorial-fullscreen':  isTutorialFullscreen.value
}));
  
// Map of component keys -> component definitions
const components = {
  timelineComponent,
  staticAnalysisComponent,
  aboutComponent,
  simulationComponent
};
  
// Navigation state, Current view key & component
const showOverlay       = ref(true);
const loadingMessage    = ref('Initializing');
const currentKey        = ref('simulationComponent')
const currentComponent  = shallowRef(components[currentKey.value])
let   cleanupRVCAT      = null
  
// Handle requests from header
function onRequestSwitch(key) {
  const nextComp = components[key];
  currentKey.value       = key;
  currentComponent.value = nextComp;
  fullComponent.value    = FULL_NONE;
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

function toggleFullscreen(component) {
  if (fullComponent.value == FULL_NONE) {
    fullComponent.value == component
    let item = '.grid-item.processor'
    switch (component) {
      case FULL_PROCESSOR:
        item= '.grid-item.processor'
        break
      case FULL_PROGRAM:
        item = '.grid-item.program'
        break
      case FULL_TUTORIAL:
        item = '.grid-item.tutorial'
        break
    }
    document.querySelector(item).scrollIntoView({ behavior: 'smooth' });
  }
  else if (fullComponent.value == component)
    fullComponent.value == FULL_NONE
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
            <button class="blue-button" title="Open full window for processor configuration" 
              :class="{ 'active': isProcessorFullscreen }" @click="toggleFullscreen(FULL_PROCESSOR)" >
                {{ fullProcessorButtonText }}
            </button>
          </li>
          <li>
            <button class="blue-button" title="Open full window for program edition" 
              :class="{ 'active': isProgramFullscreen }" @click="toggleFullscreen(FULL_PROGRAM)" >
                {{ fullProgramButtonText }}
            </button>
          </li>
          <li>
            <button class="blue-button" title="Open full window for tutorial edition" 
              :class="{ 'active': isTutorialFullscreen }" @click="toggleFullscreen(FULL_TUTORIAL)" >
                {{ fullTutorialButtonText }}
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
      
      <div v-show="isProcessorFullscreen" class="grid-item processor" :class="{ 'fullscreen': isProcessorFullscreen }">
        <processorComponent :is-fullscreen="fullComponent === FULL_PROCESSOR" />
      </div>
      
      <div v-show="isProgramFullscreen" class="grid-item program" :class="{ 'fullscreen': isProgramFullscreen }">
        <programComponent :is-fullscreen="fullComponent === FULL_PROGRAM" />
      </div>

      <div v-show="isTutorialFullscreen" class="grid-item tutorial" :class="{ 'fullscreen': isTutorialFullscreen }">
        <tutorialEditor :is-fullscreen="isTutorialFullscreen" />
      </div>
      
      <div v-show= "isNotFullscreen" class="grid-item results">
        <component :is="currentComponent" v-if="currentComponent" ref="settingsCompInst" />
        <div v-else>Component not found</div>
      </div>

      <!-- Tutorial System -->
      <tutorialComponent 
        :activeView="currentKey"
        @requestSwitch="onRequestSwitch"
      />

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
  font-size: large;
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
.tutorial  { grid-column: 1; grid-row: 2; }
.results   { grid-column: 2; grid-row: 1 / 3; min-width: 0;}

.container.processor-fullscreen, 
.container.program-fullscreen,
.container.tutorial-fullscreen {
  grid-template-columns: 1fr;
  grid-template-rows:    1fr;
  position: fixed; 
  top:      40px;  
  left:     0;
  right:    0;
  bottom:   0;
  z-index:  999;
  padding:  0; 
  background: white;
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
.grid-item.results,
.grid-item.tutorial {
  display: grid;
}

.grid-item.processor.fullscreen,
.grid-item.program.fullscreen,
.grid-item.tutorial.fullscreen {
  grid-column:   1 / span 3;
  grid-row:      1;
  height:        100%;
  width:         100%;
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
.container.processor-fullscreen .grid-item.tutorial,
.container.processor-fullscreen .grid-item.results,
.container.program-fullscreen .grid-item.processor,
.container.program-fullscreen .grid-item.tutorial,
.container.program-fullscreen .grid-item.results,
.container.tutorial-fullscreen .grid-item.processor,
.container.tutorial-fullscreen .grid-item.program,
.container.tutorial-fullscreen .grid-item.results {
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
  top:     50%;
  left:    50%;
  z-index: 1001;
  position:       fixed;
  transform:      translate(-50%, -50%);
  background:     white;
  padding:       2rem;
  border-radius: 8px;
  box-shadow:    0 4px 20px rgba(0, 0, 0, 0.2);
  text-align:    center;
  min-width:     300px;
}

.spinner {
  border:            4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #3498db;
  border-radius:     50%;
  width:    40px;
  height:   40px;
  animation: spin 1s linear infinite;
  margin:    0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.grid-item.processor.fullscreen .processor-content {
  padding:   0px;
  max-width: 1400px;
  margin:    0 auto;
}

.grid-item.processor.fullscreen::-webkit-scrollbar,
.grid-item.program.fullscreen::-webkit-scrollbar,
.grid-item.tutorial.fullscreen::-webkit-scrollbar {
  width: 10px;
}

.grid-item.processor.fullscreen::-webkit-scrollbar-track,
.grid-item.program.fullscreen::-webkit-scrollbar-track,
.grid-item.tutorial.fullscreen::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.grid-item.processor.fullscreen::-webkit-scrollbar-thumb,
.grid-item.program.fullscreen::-webkit-scrollbar-thumb,
.grid-item.tutorial.fullscreen::-webkit-scrollbar-thumb {
  background:    #888;
  border-radius: 5px;
}

</style>
