<script setup>
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick, watch } from 'vue';

import headerComponent         from '@/components/headerComponent.vue';
import processorComponent      from '@/components/processorComponent.vue';
import programComponent        from '@/components/programComponent.vue';
import timelineComponent       from '@/components/timelineComponent.vue';
import aboutComponent          from '@/components/aboutComponent.vue';
import staticAnalysisComponent from '@/components/staticAnalysisComponent.vue';
import procSettingsComponent   from '@/components/procSettingsComponent.vue';
import simulationComponent     from '@/components/simulationComponent.vue';
  
import { useRVCAT_Api }        from '@/rvcatAPI';

const simState                      = inject('simulationState');
const { isReady, registerHandler }  = inject('worker');
const { importRVCAT, getProcessors, getPrograms } = useRVCAT_Api();

/* ------------------------------------------------------------------ 
 * Read Processor/Program/Tutorial files from distribution folders
 * ------------------------------------------------------------------ */

async function loadFileList() {
  try {
    const response = await fetch('./index.json')
    const data     = await response.json()
    console.log('Processor List:', data.processors)
    simState.availableProcessors = data.processors
    if (!simState.selectedProcessor && data.processors.length > 0) {
      simState.selectedProcessor = data.processors[0]
    }
    console.log('Program List:', data.programs)
    simState.availablePrograms = data.programs
    if (!simState.selectedProgram && data.programs.length > 0) {
      simState.selectedProgram = data.program[0]
    }
    console.log('Tutorial List:', data.tutorials)
    simState.availableTutorials = data.tutorials
  } catch (error) {
    console.error('Failed to load processor/program/tutorial list:', error)
    return []
  }
}

async function loadProcessorData(processorName) {
  try {
    const response = await fetch(`/processors/${processorName}.json`)
    const data     = await response.json()
    return data
  } catch (error) {
    console.error(`Failed to load ${processorName}:`, error)
    throw error
  }
}


/* ------------------------------------------------------------------ 
 * Main Simulator Panel UI
 * ------------------------------------------------------------------ */
  
// Modal & navigation state, Current view key & component
const showLeaveModal    = ref(false);
const pendingKey        = ref(null);
const settingsCompInst  = ref(null);
const showOverlay       = ref(true);
const loadingMessage    = ref('Initializing');

// Map of component keys -> component definitions
const components = {
  timelineComponent,
  staticAnalysisComponent,
  procSettingsComponent,
  aboutComponent,
  simulationComponent
};

const currentKey        = ref('simulationComponent');
const currentComponent  = shallowRef(components[currentKey.value]);
  
// Handle requests from header
function onRequestSwitch(key) {
  const nextComp = components[key];
  if (
    currentKey.value === 'procSettingsComponent' &&
    settingsCompInst.value?.canLeave?.()
  ) {
    pendingKey.value   = key;
    showLeaveModal.value = true;
  } else {
    currentKey.value       = key;
    currentComponent.value = nextComp;
  }
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
  pendingKey.value       = null;
}

function closeLoadingOverlay() { showOverlay.value = false }

// Handler for 'import_rvcat' message
const handleRVCAT = async (data, dataType) => {
  if (dataType === 'error') {
    console.error('Failed to load RVCAT:', data);
    return;
  }
  setTimeout(() => closeLoadingOverlay(), 500) // Optional delay

  await loadFileList()
  
  if ( simState.selectedProcessor ) {
    const firstProcessor = await loadProcessorData( simState.selectedProcessor )
    console.log('First processor data:', firstProcessor)
  }

  // Look in localStorage for processors & programs, 
  // if not found, get from distribution folders
  //getProcessors();  // from RVCAT API
  //getPrograms();    // from RVCAT API
};
 
onMounted(() => {
  nextTick(() => {
      loadingMessage.value = 'Loading RVCAT';
      showOverlay.value    = true
  });
  
  // Register processors handler
  const cleanupRVCAT = registerHandler('import_rvcat', handleRVCAT);
});

onUnmounted(() => {
  cleanupRVCAT();
});
  
watch(isReady, (ready) => {
  if (ready) {
      loadingMessage.value = 'Loading complete!';
      importRVCAT();  // from RVCAT API
  }
})
 
</script>

<template>
  <body>
    <header>
      <headerComponent
        :activeView="currentKey"
        @requestSwitch="onRequestSwitch"
      />
    </header>

    <div class="blur-overlay" :style="{ display: showOverlay ? 'block' : 'none' }"></div>
    <div class="overlay"      :style="{ display: showOverlay ? 'block' : 'none' }">
      <div class="spinner"></div>
      <p>{{ loadingMessage }}</p>
      <p>Please wait. Loading can take several seconds</p>
    </div>
    
    <main class="container">
      <div class="grid-item processor">
        <processorComponent />
      </div>
      <div class="grid-item program">
        <programComponent />
      </div>
      <div class="grid-item results">
        <component
          :is="currentComponent"
          v-if="currentComponent"
          ref="settingsCompInst"
        />
        <div v-else>Component not found</div>
      </div>

      <div v-if="showLeaveModal" class="modal-overlay">
        <div class="modal">
          <p>You should apply (save) the changes on the processor settings before leaving this page.</p>
          <p><b>Do you want to continue?</b></p>
          <div class="modal-actions">
            <button @click="confirmLeave" title="Leave" class="blue-button">OK</button>
            <button @click="cancelLeave"  title="Cancel" class="blue-button">Cancel</button>
          </div>
        </div>
      </div>
    </main>
  </body>
</template>

<style scoped>
.container {
  position: relative;
  display:  grid;
  grid-template-columns: 34% 64%;
  grid-auto-rows:        50% 50%;
  gap:            2vh;
  width:        100vw;
  height:        94vh;
  margin-top:   0.5vh;
  margin-right: 0.5vh;
  background:   #e3e3e3;
  overflow:     hidden;
  box-sizing:   border-box;
}
.grid-item {
  position:      relative;
  background:    white;
  border-radius: 10px;
  min-width:     0;
}
.processor { grid-column: 1; grid-row: 1; }
.program   { grid-column: 1; grid-row: 2; }
.results   { grid-column: 2; grid-row: 1 / 3; min-width: 0;}

.blur-overlay {
  top:    0;
  left:   0;
  width:  100%;
  height: 100%;
  z-index: 1000;
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
</style>
