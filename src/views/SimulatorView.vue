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

// Inject worker
const { isReady, executePython } = inject('worker');

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
 
onMounted(() => {
  nextTick(() => {
      loadingMessage.value = 'Loading RVCAT';
      showOverlay.value    = true
  });
});

watch(isReady, (ready) => {
  if (ready) {
      loadingMessage.value = 'Loading complete!';
      setTimeout(() => closeLoadingOverlay(), 500) // Optional delay
      // loadInitialData();
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

    <div class="blur-overlay" v-show="showOverlay"></div>
    <div class="overlay"      v-show="showOverlay">
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
    position: fixed;
    display: none;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgb(65, 65, 65, 0.5);
    z-index: 1000;
    backdrop-filter: blur(5px);
}
.overlay {
    position: fixed;
    display: none;
    margin: auto;
    width: fit-content;
    height: fit-content;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.4);
    z-index: 100;
    border-radius: 15px;
    border: 2px solid #506c8666;
    padding: 2%;
    padding-right: 5%;
    padding-left: 5%;
}

#loading-overlay p {
    margin: auto;
    font-weight: bold;
    text-align: center;
    font-size: 2.5vh;
}

/* Spinner animation */
.spinner {
    border: 12px solid #f3f3f3;
    border-top: 12px solid #007bff;
    border-radius: 50%;
    width: 80px;
    height: 80px;
    animation: spin 1s linear infinite;
    margin: auto;
    margin-bottom: 20px;
}

.spinner-small {
    border: 3px solid #f3f3f3;
    border-top: 3px solid #868686;
    border-radius: 50%;
    width: 15px;
    height: 15px;
    animation: spin 1s linear infinite;
    margin: auto;
}

@keyframes spin {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}

</style>
