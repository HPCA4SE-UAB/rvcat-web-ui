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

// ============================================================================
// Main Simulator Panel UI
// ============================================================================
// Map of component keys -> component definitions
const components = {
  timelineComponent,
  staticAnalysisComponent,
  aboutComponent,
  simulationComponent
};
  
// Navigation state
const currentFullKey    = ref('none')
const currentKey        = ref('simulationComponent')
const currentComponent  = shallowRef(components[currentKey.value])

// Computed to use on template
const isNotFullscreen       = computed(() => currentFullKey.value === 'none');
const isProcessorFullscreen = computed(() => currentFullKey.value === 'processor');
const isProgramFullscreen   = computed(() => currentFullKey.value === 'program');
const isTutorialFullscreen  = computed(() => currentFullKey.value === 'tutorial');

const getButtonText = (key, baseText) => {
  return computed(() => 
    currentFullKey.value === key ? `📍${baseText}` : `📌${baseText}`
  );
};

// Button texts using helper
const fullProcessorButtonText = getButtonText('processor', 'Edit Processor');
const fullProgramButtonText   = getButtonText('program',   'Edit Program');
const fullTutorialButtonText  = getButtonText('tutorial',  'Edit Tutorial');

// Container classes
const containerClasses = computed(() => ({
  'processor-fullscreen': isProcessorFullscreen.value,
  'program-fullscreen':   isProgramFullscreen.value,
  'tutorial-fullscreen':  isTutorialFullscreen.value
}));

// ============================================================================
// Functions to change panel/full-screen
// ============================================================================
  
// Handle requests from header (& processor/program/tutorial engine)
function onRequestSwitch(key) {
  const nextComp             = components[key]
  currentKey.value           = key
  currentComponent.value     = nextComp
  currentFullKey.value       = 'none'
}

// Handle requests from header (& processor/program/tutorial engine)
function toggleFullScreen(key) {
  if (currentFullKey.value === key) {
    currentFullKey.value = 'none'
    return
  }
  currentFullKey.value = key
  document.querySelector(`.grid-item.${key}`).scrollIntoView({ behavior: 'smooth' }); 
}

// ============================================================================
// Loading view
// ============================================================================

// Navigation state
const showOverlay = ref(true);

function closeLoadingOverlay() { 
   showOverlay.value = false 
}
  
// ============================================================================
// EVENT HANDLERS: import_rvcat     WATCH: isReady
// ============================================================================
const loadingMessage = ref('Initializing');

// Handler for 'import_rvcat' message
const handleRVCAT = async (data, dataType) => {
  if (dataType === 'error') {
    console.error('❌ handler: failed to import RVCAT:', data);
    return;
  }
  loadingMessage.value = 'Loading complete!';
  setTimeout(() => closeLoadingOverlay(), 1500)
  simState.state = 1;  // fires processor component to set processor configuration
};

watch(isReady, (ready) => {
  if (ready) {
      loadingMessage.value = 'Loading complete!';
      importRVCAT();       // call RVCAT API
  }
})
  
// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
let  cleanupRVCAT = null
  
onMounted(() => {
  console.log('🔵🎯 Main Component mounted')
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
  
</script>

<!----  Id's on the template are used for tutorial linking of panels and buttons: do not change them! -->
<template>
  <body>
    <header>
     <div id="top" class="header-title"> 
       <img src="/img/favicon.png" class="title-img"> 
       <h1>RVCAT-WEB</h1>
       <nav>
        <ul>
          <li>
            <button class="blue-button" :class="{ 'active': isProcessorFullscreen }"
               id="processor-button" 
               title="Open full window for processor configuration" 
               @click="toggleFullScreen('processor')" >
                {{ fullProcessorButtonText }}
            </button>
          </li>
          <li>
            <button class="blue-button" :class="{ 'active': isProgramFullscreen }"
               id="program-button"   
               title="Open full window for program edition" 
               @click="toggleFullScreen('program')" >
                {{ fullProgramButtonText }}
            </button>
          </li>
          <li>
            <button class="blue-button" :class="{ 'active': isTutorialFullscreen }"
               id="tutorial-button"  
               title="Open full window for tutorial edition" 
               @click="toggleFullScreen('tutorial')" >
                {{ fullTutorialButtonText }}
            </button>
          </li>

          <li class="separator"></li>

          <li>
            <button class="blue-button" :class="{ active: currentKey === 'simulationComponent' }"
               id="simulation-button" 
               title="Simulate Program's execution and collect performance metrics"
               @click="onRequestSwitch('simulationComponent')" > 
                Simulation
            </button>
          </li>
          <li>
            <button class="blue-button" :class="{ active: currentKey === 'staticAnalysisComponent' }"
               id="analysis-button"   
               title="Static Performance Analysis -> identify potential bottleneck, either throughput or latency (depnedencies)"
               @click="onRequestSwitch('staticAnalysisComponent')" >
                Static Analysis
            </button>
          </li>
          <li>
            <button class="blue-button" :class="{ active: currentKey === 'timelineComponent' }"
               id="timeline-button"   
               title="Detailed Timeline of Program's execution"
               @click="onRequestSwitch('timelineComponent')" >
                Timeline
            </button>
          </li>
          <li>
            <button class="blue-button" :class="{ active: currentKey === 'aboutComponent' }"
               id="about-button"      
               title="Credits on the design and development for this tool"
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
      
      <div v-show="isProcessorFullscreen || isNotFullscreen" 
          class="grid-item processor" :class="{ 'fullscreen': isProcessorFullscreen }"
          id="processor-panel"      
        >
        <processorComponent :is-fullscreen="isProcessorFullscreen" @requestSwitchFull="toggleFullScreen"/>
      </div>
      
      <div v-show="isProgramFullscreen || isNotFullscreen" 
        class="grid-item program" :class="{ 'fullscreen': isProgramFullscreen }"
        id="program-panel"
        >
        <programComponent   :is-fullscreen="isProgramFullscreen"/>
      </div>

      <div v-show="isTutorialFullscreen" 
        class="grid-item tutorial" :class="{ 'fullscreen': isTutorialFullscreen }"
        id="tutorial-panel"
        >
        <tutorialEditor     :is-fullscreen="isTutorialFullscreen"  @requestSwitchFull="toggleFullScreen"/>
      </div>
      
      <div v-show= "isNotFullscreen" 
        class="grid-item results"
        id="right-panel"
        >
        <component :is="currentComponent" v-if="currentComponent" ref="settingsCompInst" />
        <div v-else>Component not found</div>
      </div>

      <!-- Tutorial System -->
      <tutorialComponent 
        :activeView="currentKey"
        :activeFull="currentFullKey"
        id="tutorial-activation"
        @requestSwitchPanel="onRequestSwitch"
        @requestSwitchFull="toggleFullScreen"
      />
      <programComponent  @requestSwitchFull="toggleFullScreen"/>
    </main>
  </body>
</template>

<style scoped>

/* applied to header title */
#top {
  max-height:      5vh;
  width:           100vw;
  padding:         0.6%;
  display:         flex;
  color:           white;
  padding:         20px 10px;
  box-shadow:      0 4px 8px rgba(0, 0, 0, 0.05);
  box-sizing:      border-box;
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

.separator {
  width: 1px;
  background-color: rgba(0, 0, 0, 0.15);
  align-self: center; /* Centrar verticalmente */
  display: flex;
  align-items: center;
  border-right: 1px solid rgba(0, 0, 0, 0.1);
  margin: 0 20px;
  height: 60%; /* Porcentaje de la altura del contenedor */
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
.tutorial  { grid-column: 1; grid-row: 1; }
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

.grid-item.processor,  
.grid-item.program,
.grid-item.results,
.grid-item.tutorial {
  display: grid;
  overflow: hidden;
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

.grid-item.processor.fullscreen,
.grid-item.program.fullscreen  {
  padding:       0px;
  max-height: 1400px;
  margin:     0 auto;
}

.grid-item.tutorial.fullscreen  {
  padding:       0px;
  max-height: 2400px;
  margin:     0 auto;
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
