<script setup>
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick, watch, computed } from 'vue';

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
const { importRVCAT }               = useRVCAT_Api();

/* ------------------------------------------------------------------ 
 * Main Simulator Panel UI
 * ------------------------------------------------------------------ */
  
// Modal & navigation state, Current view key & component
const showLeaveModal    = ref(false);
const pendingKey        = ref(null);
const settingsCompInst  = ref(null);
const showOverlay       = ref(true);
const loadingMessage    = ref('Initializing');

// full screen mode
const isProcessorFullscreen = ref(false);
const fullscreenButtonText = computed(() => 
  isProcessorFullscreen.value ? 'Exit Fullscreen' : 'Fullscreen Processor'
);

// Map of component keys -> component definitions
const components = {
  timelineComponent,
  staticAnalysisComponent,
  procSettingsComponent,
  aboutComponent,
  simulationComponent
};

const currentKey        = ref('simulationComponent')
const currentComponent  = shallowRef(components[currentKey.value])
let   cleanupRVCAT      = null
  
// Handle requests from header
function onRequestSwitch(key) {
  const nextComp = components[key];
  if (
    currentKey.value === 'procSettingsComponent' &&
    settingsCompInst.value?.canLeave?.()
  ) {
    pendingKey.value     = key;
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
  
  // Register processors handler
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
  isProcessorFullscreen.value = !isProcessorFullscreen.value;
  if (isProcessorFullscreen.value) {
    document.querySelector('.grid-item.processor').scrollIntoView({ behavior: 'smooth' });
  }
}
  
</script>

<template>
  <body>
    <header>
      <headerComponent :activeView="currentKey"  @requestSwitch="onRequestSwitch" />
      <!--Full Screen Button -->
      <button  @click="toggleProcessorFullscreen" class="fullscreen-btn" :class="{ 'active': isProcessorFullscreen }" >
        {{ fullscreen }}
      </button>
    </header>

    <div class="blur-overlay" :style="{ display: showOverlay ? 'block' : 'none' }"></div>
    <div class="overlay"      :style="{ display: showOverlay ? 'block' : 'none' }">
      <div class="spinner"></div>
      <p>{{ loadingMessage }}</p>
      <p>Please wait. Loading can take several seconds</p>
    </div>
    
    <main class="container" :class="{ 'processor-fullscreen': isProcessorFullscreen }">
      
      <!-- Processor Component -->
      <div class="grid-item processor" :class="{ 'fullscreen': isProcessorFullscreen }">
        <processorComponent />
        <!-- Close button -->
        <button v-if="isProcessorFullscreen" @click="toggleProcessorFullscreen" class="close-fullscreen-btn" >
          ✕ Close
        </button>
      </div>
      
      <div v-if="!isProcessorFullscreen" class="grid-item program">
        <programComponent />
      </div>
      
      <div v-if="!isProcessorFullscreen" class="grid-item results">
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

/* Layout en modo normal */
.container {
  display:     grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr;
  gap:        15px;
  height:     calc(100vh - 60px);
  padding:    15px;
  transition: all 0.3s ease;
}

/* Layout en modo pantalla completa */
.container.processor-fullscreen {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}
  
.grid-item {
  position:      relative;
  background:    white;
  border-radius: 10px;
  min-width:     0;
}

  /* Componente procesador normal */
.grid-item.processor {
  grid-column: 1;
  overflow:    auto;
  border:      1px solid #ddd;
  border-radius: 8px;
  background:    white;
  transition:    all 0.3s ease;
  position:      relative;
}

/* Componente procesador en pantalla completa */
.grid-item.processor.fullscreen {
  grid-column: 1 / span 3;
  grid-row:    1;
  position:    fixed;
  top:         60px; /* Altura del header */
  left:        0;
  right:       0;
  bottom:      0;
  z-index:     999;
  border-radius: 0;
  border:        none;
  box-shadow:    0 0 30px rgba(0,0,0,0.3);
  overflow-y:    auto;
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

.fullscreen-btn {
  position: absolute;
  top:      15px;
  right:    15px;
  padding:  8px 16px;
  background: #4a6fa5;
  color:      white;
  border:     none;
  border-radius: 4px;
  cursor:        pointer;
  font-size:     14px;
  transition:    all 0.3s;
  z-index:       1000;
}

.fullscreen-btn:hover {
  background: #3a5a8a;
}

.fullscreen-btn.active {
  background: #ff6b6b;
}

/* Botón de cerrar en modo pantalla completa */
.close-fullscreen-btn {
  position: absolute;
  top: 15px;
  right: 15px;
  padding: 10px 20px;
  background: #ff6b6b;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  z-index: 1001;
}

.close-fullscreen-btn:hover {
  background: #ff5252;
}

/* Ocultar otros componentes en pantalla completa */
.container.processor-fullscreen .grid-item.program,
.container.processor-fullscreen .grid-item.results {
  display: none;
}

/* Asegurar que el contenido del procesador sea visible */
.grid-item.processor.fullscreen .processor-content {
  padding:   20px;
  max-width: 1400px;
  margin:   0 auto;
}

/* Añadir scroll suave */
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
  
</style>
