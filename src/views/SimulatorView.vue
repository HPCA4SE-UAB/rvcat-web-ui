<script setup>
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick } from 'vue';
import headerComponent         from '@/components/headerComponent.vue';
import loadingComponent        from '@/components/loadingComponent.vue';
import processorComponent      from '@/components/processorComponent.vue';
import programComponent        from '@/components/programComponent.vue';
import timelineComponent       from '@/components/timelineComponent.vue';
import aboutComponent          from '@/components/aboutComponent.vue';
import staticAnalysisComponent from '@/components/staticAnalysisComponent.vue';
import procSettingsComponent   from '@/components/procSettingsComponent.vue';
import simulationComponent     from '@/components/simulationComponent.vue';

// Inject worker
const { isReady, executePython } = inject('worker');

// Modal & navigation state
const showLeaveModal    = ref(false);
const pendingKey        = ref(null);
const settingsCompInst  = ref(null);

// Map of component keys -> component definitions
const components = {
  timelineComponent,
  staticAnalysisComponent,
  procSettingsComponent,
  aboutComponent,
  simulationComponent
};

// Current view key & component
const currentKey       = ref('simulationComponent');
const currentComponent = shallowRef(components[currentKey.value]);
 
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

onMounted(() => {
  nextTick(() => {
    openLoadingOverlay();
    setLoadingOverlayMessage('Loading RVCAT');
  });
});

watch(isReady, (ready) => {
  if (ready) {
    // loadInitialData();
    closeLoadingOverlay();
  }
});


// UI stuff
function openLoadingOverlay() { 
  document.getElementById('loading-overlay').style.display   = 'block';
  document.getElementById('blur-overlay-item').style.display = 'block';
}

function closeLoadingOverlay() {
    document.getElementById('loading-overlay').style.display   = 'none';
    document.getElementById('blur-overlay-item').style.display = 'none';
}

function setLoadingOverlayMessage(message) {
    document.getElementById('loading-overlay-message').innerHTML = message;
}
  
</script>

<template>
  <body>
    <header>
      <headerComponent
        :activeView="currentKey"
        @requestSwitch="onRequestSwitch"
      />
    </header>

    <loadingComponent />

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
</style>
