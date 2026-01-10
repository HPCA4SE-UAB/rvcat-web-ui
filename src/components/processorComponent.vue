<script setup>
  import { ref, nextTick, inject, watch } from 'vue'
  import HelpComponent from '@/components/tutorialComponent.vue';

/* ------------------------------------------------------------------ 
 * Processor selection and ROB size specification
 * ------------------------------------------------------------------ */

  // Get your worker handlers
  const handlers = inject('handlers', {})
  const simState = inject('simulationState');
 
  // Define the handler for when processors data arrives
  const processorsHandler = (data) => {
    try {
      const processors = JSON.parse(data)
      simState.availableProcessors.value = processors
    
      // Auto-select first processor if none selected
      if (!simState.selectedProcessor.value && processors.length > 0) {
        simState.selectedProcessor.value = processors[0]
      }
    } catch (error) {
      console.error('Failed to parse processors:', error)
    }
  }

  handlers['get_processors'] = processorsHandler

  const reloadProcessor = () => {
     console.log('Reloading with:', {
       processor: simState.selectedProcessor.value,
       processorsCount: simState.availableProcessors.value.length
     })
     // Call Python RVCAT to load new processor configuration
     setProcessor( simState.selectedProcessor.value )
  }
}
  
/* ------------------------------------------------------------------ 
 * Help support 
 * ------------------------------------------------------------------ */
  const showHelp     = ref(false);
  const helpPosition = ref({ top: '0%', left: '40%' });
  const helpIcon     = ref(null);

  function openHelp()  { nextTick(() => { showHelp.value = true }) }
  function closeHelp() { showHelp.value  = false }
</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Processor Pipeline</span>
      </div>
      
      <div id="settings-div">
        <select 
          v-model="simState.selectedProcessor"
          title="Select Processor" 
          @change="reloadProcessor"
        >
          <option value="" disabled>Select a processor</option>
          <option 
            v-for="processor in simState.availableProcessors" 
            :key="processor"
            :value="processor"
          >
            {{ processor }}
          </option>
        </select>
        <!-- Display current selection -->
        <div v-if="selectedProcessor">
          Selected: {{ selectedProcessor }}
        </div>
        
        <span class="iters-label">ROB size: </span>
        <input type="number" title="# ROB entries" id="rob-size" name="rob-size" min="1" max="200"
               v-model.number="simState.ROBsize">
      </div>
    </div>
    
    <div class="cache-info" id="cache-info"></div>  
    <div class="pipeline-img" id="pipeline-graph"></div>

    <Teleport to="body">
      <HelpComponent v-if="showHelp" :position="helpPosition"
      text="Provides graphical visualization of the <strong>processor microarchitecture</strong> (pipeline) characteristics.
          <p>Modify the size of the <strong>ROB</strong> (ReOrder Buffer) or select a new <em>processor configuration</em> file from the list.
          Use the <strong>Processor</strong> tab to modify the microarchitectural parameters.</p>"
      title="Processor MicroArchitecture"
      @close="closeHelp" />
    </Teleport>
  </div>
</template>

<style scoped>
  .pipeline-img {
    display:         flex;
    align-items:     center;
    justify-content: center;
    position: relative;
    margin:   0 auto;
    margin-top: 10%;
  }
  .pipeline-img svg {
    width:  100%;
    max-height: 50%;
  }
  .pipeline-graph {
    display: block;
    width:   70%;
    margin:  auto;
  }
  .cache-info {
    flex:          1;
    display:       flex;
    align-items:   center;
    padding:       4px 10px;
    background:    #f8f8f8;
    border-radius: 6px;
    margin-top:    5px;
    font-size:     0.9rem;
    justify-content: space-between;
  }
  
  #processors-list {
    font-size: 2.2vh;
  }
  #rob-size {
    max-width: 40%;
    font-size: 2.2vh;
  }
  table {
    display:none;
  }
  .scale-container {
    display: flex;
    justify-content: center; /* Center horizontally */
  }
  .color-scale {
    width:      30%;
    height:     10px;
    background: linear-gradient(to right, #00FF00, #FFFF00, #FF0000);
    position:   relative;
    border-radius: 5px;
  }
  #settings-div {
    display:     flex;
    gap:         5px;
  }

</style>
