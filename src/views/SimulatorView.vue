<script setup>
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick, watch, computed } from 'vue';

import processor               from '@/components/processor.vue';
import program                 from '@/components/program.vue';
import programEditor           from '@/components/programEditor.vue';
import processorEditor         from '@/components/processorEditor.vue';
import tutorialComponent       from '@/components/tutorialComponent.vue';
import tutorialEditor          from '@/components/tutorialEditor.vue';
import timelineComponent       from '@/components/timelineComponent.vue';
import aboutComponent          from '@/components/aboutComponent.vue';
import staticAnalysisComponent from '@/components/staticAnalysisComponent.vue';
import simulationComponent     from '@/components/simulationComponent.vue';

import { useRVCAT_Api }        from '@/rvcatAPI';
import { RVCAT_VERSION }       from '@/common';

const simState                      = inject('simulationState');
const { isReady, registerHandler }  = inject('worker');
const { importRVCAT }               = useRVCAT_Api();

// ============================================================================
// RVCAT options & localStorage
// ============================================================================

  const STORAGE_KEY = 'rvcatOptions'

  const rvcatOptions = {
    version: RVCAT_VERSION,
    year:    2026
  }

  function checkRVCATversion() {
    const storedData = localStorage.getItem(STORAGE_KEY)

    if (storedData) {
      try {
        const parsedData = JSON.parse(storedData)
        if (parsedData.version === rvcatOptions.version)
          return
      } catch (error) {
        console.error('Error when parsing localStorage:', error)
      }
    }
    localStorage.clear()
    // Non-blocking notice (an alert() would stop the page while it loads)
    versionNotice.value = `New version of RVCAT released (V${rvcatOptions.version}). ` +
                          'Saved settings and results have been reset.'
    setTimeout(() => { versionNotice.value = '' }, 15000)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rvcatOptions))
  }
  const versionNotice = ref('')

// ============================================================================
// Side panel (processor + program) can be collapsed to give more room to the right panel
// ============================================================================
  const SIDE_KEY = 'sidePanelCollapsed'
  const sideCollapsed = ref(false)
  try { sideCollapsed.value = localStorage.getItem(SIDE_KEY) === 'true' } catch { /* default */ }
  watch(sideCollapsed, (v) => {
    try { localStorage.setItem(SIDE_KEY, String(v)) } catch { /* ignore */ }
    // The right panel changed width: let width-dependent views (timeline) adapt
    nextTick(() => window.dispatchEvent(new Event('resize')))
  })

// ============================================================================
// Main Simulator Panel UI
// ============================================================================
// Map of component keys -> component definitions
const components = {
  simulationComponent,
  timelineComponent,
  staticAnalysisComponent,
  aboutComponent
};

// Navigation state
const checkOK          = ref(false);
const currentFullKey   = ref('none')
const currentKey       = ref('simulationComponent')
const currentComponent = shallowRef(components[currentKey.value])

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
  'side-collapsed':       sideCollapsed.value && isNotFullscreen.value,
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

function toggleFullScreen(key) {
  if (currentFullKey.value === key) {
    currentFullKey.value = 'none'
    return
  }
  currentFullKey.value = key
}

// ============================================================================
// Loading view
// ============================================================================

// Navigation state
const showOverlay = ref(true);

function closeLoadingOverlay() { showOverlay.value = false }

// ============================================================================
// EVENT HANDLERS: import_rvcat     WATCH: isReady
// ============================================================================
const loadingMessage = ref('Initializing');

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
  checkRVCATversion()
  console.log('🔵🎯 Main Component mounted')
  checkOK.value = true   // mount all components
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

<template>
  <div class="app-root">
    <header :title="`RVCAT version ${RVCAT_VERSION}`">
      <div id="top">
        <div class="header-title">
          <img src="/img/favicon.png" class="title-img" alt="RVCAT" :title="`RVCAT version ${RVCAT_VERSION}`">
          <div :style="{ fontSize: 'large', padding: '0 40px' }">RVCAT-WEB</div>
          <nav>
            <ul>
              <li>
                <button class="blue-button side-toggle" :disabled="!isNotFullscreen"
                  id="side-panel-toggle"
                  :title="sideCollapsed ? 'Show the processor and program panels' : 'Hide the processor and program panels to give more room to the right panel'"
                  @click="sideCollapsed = !sideCollapsed">
                    {{ sideCollapsed ? '▶' : '◀' }} Side panel
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
                <button class="blue-button" :class="{ active: currentKey === 'timelineComponent' }"
                  id="timeline-button"
                  title="Detailed Timeline of Program's execution"
                  @click="onRequestSwitch('timelineComponent')" >
                    Timeline
                </button>
              </li>
              <li>
                <button class="blue-button" :class="{ active: currentKey === 'staticAnalysisComponent' }"
                  id="analysis-button"
                  title="Static Performance Analysis: identify potential bottleneck (throughput or latency/dependencies)"
                  @click="onRequestSwitch('staticAnalysisComponent')" >
                    Static Analysis
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

              <li class="separator"></li>
              <li>
                <button class="blue-button" :class="{ 'active': isProgramFullscreen }"
                  id="program-button"
                  title="Open/Close program edition panel"
                  @click="toggleFullScreen('program')" >
                    {{ fullProgramButtonText }}
                </button>
              </li>
              <li>
                <button class="blue-button" :class="{ 'active': isProcessorFullscreen }"
                  id="processor-button"
                  title="Open/Close processor edition panel"
                  @click="toggleFullScreen('processor')" >
                    {{ fullProcessorButtonText }}
                </button>
              </li>
              <li>
                <button class="blue-button" :class="{ 'active': isTutorialFullscreen }"
                  id="tutorial-button"
                  title="Open/Close tutorial edition panel"
                  @click="toggleFullScreen('tutorial')" >
                    {{ fullTutorialButtonText }}
                </button>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>

    <div v-if="versionNotice" class="version-notice" role="status">
      💻 {{ versionNotice }}
      <button class="version-notice-close" @click="versionNotice = ''" title="Close">✕</button>
    </div>

    <div class="blur-overlay" :style="{ display: showOverlay ? 'block' : 'none' }"></div>
    <div class="overlay"      :style="{ display: showOverlay ? 'block' : 'none' }">
      <div class="spinner"></div>
      <p>{{ loadingMessage }}</p>
      <p>Please wait. Loading can take several seconds</p>
    </div>

    <main class="container" :class="containerClasses">

      <div class="components-wrapper" v-if="checkOK" v-show="isNotFullscreen && !sideCollapsed" id="process-panel">
        <processor @requestSwitchFull="toggleFullScreen"/>
        <program :active-view="currentKey" @requestSwitchFull="toggleFullScreen"/>
      </div>
      <!-- Collapsed side panel: a narrow strip that brings it back -->
      <button v-if="checkOK && isNotFullscreen && sideCollapsed" class="side-expand"
              id="side-panel-expand" title="Show the processor and program panels"
              @click="sideCollapsed = false">
        <span>▶</span><span class="side-expand-label">Processor &amp; Program</span>
      </button>

      <div v-if="checkOK" v-show="isProcessorFullscreen" class="grid-item processor" id="processorEditor-panel">
        <processorEditor :is-fullscreen="isProcessorFullscreen"/>
      </div>

      <div v-if="checkOK" v-show="isProgramFullscreen"   class="grid-item program"   id="programEditor-panel">
        <programEditor   :is-fullscreen="isProgramFullscreen"  />
      </div>

      <div v-if="checkOK" v-show="isTutorialFullscreen"
        class="grid-item tutorial" :class="{ 'fullscreen': isTutorialFullscreen }"
        id="tutorial-panel"
        >
        <tutorialEditor :is-fullscreen="isTutorialFullscreen"  />
      </div>

      <div v-if="checkOK" v-show= "isNotFullscreen"
        class="grid-item results"
        id="right-panel"
        >
        <component :is="currentComponent" v-if="currentComponent" ref="settingsCompInst"/>
        <div v-else>Component not found</div>
      </div>

      <div v-if="checkOK">
        <tutorialComponent :activeView="currentKey" :activeFull="currentFullKey"
          id="tutorial-activation"
          @requestSwitchPanel="onRequestSwitch"
          @requestSwitchFull="toggleFullScreen"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>

/* The application fills exactly the browser window: header + panels area.
   Each column/panel scrolls inside itself, so the page itself never scrolls. */
.app-root {
  height:         100vh;
  height:         100dvh;
  display:        flex;
  flex-direction: column;
  overflow:       hidden;
}
header { flex: none; }

#top {
  max-height:      5vh;
  width:           100%;   /* 100vw would include the scrollbar width */
  padding:         0.6%;
  display:         flex;
  color:           white;
  padding:         20px 10px;
  box-shadow:      0 4px 8px rgba(0, 0, 0, 0.05);
  box-sizing:      border-box;
  align-items:     center;
  justify-content: space-between;
  background-color: #0cb35f;
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
  margin-top: 0.0vh;
}

.header-title {
  display:flex;
  gap:    5px;
}

.container {
  position:              relative;
  display:               grid;
  grid-template-columns: 33% calc(67% - 0.3vh);
  grid-template-rows:    minmax(0, 1fr) auto;   /* panels row fills the height; tutorial row is empty */
  gap:          0.3vh;
  flex:         1 1 auto;
  min-height:   0;
  width:        100%;
  margin-top:   0.3vh;
  background:   #e3e3e3;
  overflow:     hidden;
  box-sizing:   border-box;
  transition:   all 0.3s ease;
}

/* Side panel collapsed: narrow strip + right panel */
.container.side-collapsed {
  grid-template-columns: 28px calc(100% - 28px - 0.3vh);
  grid-template-rows:    minmax(0, 1fr) auto;
}
.side-expand {
  grid-column:    1;
  grid-row:       1;
  display:        flex;
  flex-direction: column;
  align-items:    center;
  gap:            8px;
  padding:        8px 0;
  border:         none;
  border-radius:  3px;
  background:     #d4dbe6;
  color:          #1a4fb3;
  cursor:         pointer;
  font-weight:    600;
}
.side-expand:hover { background: #c3cde0; }
.side-expand-label {
  writing-mode: vertical-rl;
  white-space:  nowrap;
}

.version-notice {
  position:      fixed;
  top:           56px;
  left:          50%;
  transform:     translateX(-50%);
  z-index:       2000;
  display:       flex;
  align-items:   center;
  gap:           12px;
  padding:       8px 12px 8px 16px;
  background:    #fff8e1;
  color:         #5a4500;
  border:        1px solid #e0c060;
  border-radius: 6px;
  box-shadow:    0 4px 12px rgba(0, 0, 0, 0.15);
}
.version-notice-close {
  background: none;
  border:     none;
  cursor:     pointer;
  font-size:  1em;
  color:      inherit;
}

.processor { grid-column: 1; grid-row: 1; }
.program   { grid-column: 1; grid-row: 1; }
.tutorial  { grid-column: 1; grid-row: 1; }
.results   { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; }
.process   { grid-column: 1; grid-row: 1; min-width: 0;}

.container.processor-fullscreen,
.container.program-fullscreen,
.container.tutorial-fullscreen {
  grid-template-columns: 1fr;
  grid-template-rows:    minmax(0, 1fr) auto;
  padding:  0;
  background: white;
}

.grid-item {
  display:       flex;
  flex-direction: column;
  flex-shrink:   0;
  position:      relative;
  background:    white;
  border-radius: 3px;
  min-width:     0;
}

.components-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0;
  min-height: 0;
  overflow-y: auto;      /* processor + program scroll inside the left column */
  overflow-x: hidden;
}

.components-wrapper > * {
  width: 100%;
  margin: 0;
  padding: 0;
  flex-shrink: 0;
  flex-grow: 0;
}

.components-wrapper processorComponent,
.components-wrapper programComponent {
  align-self: flex-start;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  min-height: auto;
  height: auto;
}

.grid-item.processor,
.grid-item.program,
.grid-item.tutorial {
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

.grid-item.processor,
.grid-item.program,
.grid-item.tutorial {
  padding:       0px;
  max-height: none;
  overflow:   auto;      /* full-screen editors scroll inside */
  margin:     0 auto;
}

.grid-item.processor::-webkit-scrollbar,
.grid-item.program::-webkit-scrollbar,
.grid-item.tutorial::-webkit-scrollbar {
  width: 10px;
}

.grid-item.processor::-webkit-scrollbar-track,
.grid-item.program::-webkit-scrollbar-track,
.grid-item.tutorial::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.grid-item.processor::-webkit-scrollbar-thumb,
.grid-item.program::-webkit-scrollbar-thumb,
.grid-item.tutorial::-webkit-scrollbar-thumb {
  background:    #888;
  border-radius: 5px;
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

</style>
