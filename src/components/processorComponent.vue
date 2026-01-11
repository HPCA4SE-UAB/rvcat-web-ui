<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, watch } from 'vue'
  import HelpComponent    from '@/components/tutorialComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

  const { setProcessor }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  // Reactive SVG string
  const pipelineSvg = ref('');

/* ------------------------------------------------------------------ 
 * Processor selection and ROB size specification
 * ------------------------------------------------------------------ */

  // Watch for processor changes
  watch(() => simState.selectedProcessor, (newProcessor, oldProcessor) => {
    console.log(`Processor changed from "${oldProcessor}" to "${newProcessor}"`);
    if (newProcessor && newProcessor !== oldProcessor) {
      reloadProcessor();
    }
  });
  
  // Handler for 'get_processors' message (fired from parent component)
  const handleProcessors = (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to get list of processors:', data);
      return;
    }
    try {
      let processors = JSON.parse(data);
      console.log('Processor List:', processors)
      simState.availableProcessors = processors
      // Auto-select first processor if none selected
      if (!simState.selectedProcessor && processors.length > 0) {
        simState.selectedProcessor = processors[0]
      }
    } catch (error) {
      console.error('Failed to parse processors:', error)
    }
  }

  // Handler for 'set_processor' message (fired by this component)
  const handleSetProcessor = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to set processor:', data);
      return;
    }
    try {
      let processorInfo = JSON.parse(data);
      console.log('Processor Info:', processorInfo)
      //   insert_cache_annotations(cache)
      const svg = await getProcessorGraph(processorInfo);
      pipelineSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('Failed to set processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  
  onMounted(() => {
    const cleanupHandleGet = registerHandler('get_processors', handleProcessors);
    const cleanupHandleSet = registerHandler('set_processor',  handleSetProcessor);
  });

  onUnmounted(() => {
    cleanupHandleGet();
    cleanupHandleSet();
  });

  const reloadProcessor = () => {
    console.log('Reloading with:', simState.selectedProcessor);
    // Call Python RVCAT to load new processor configuration --> 'set-processor'
    setProcessor( simState.selectedProcessor )
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
        <select v-model="simState.selectedProcessor" title="Select Processor">
          <option value="" disabled>Select</option>
          <option 
            v-for="processor in simState.availableProcessors" 
            :key="processor"
            :value="processor"
          >
            {{ processor }}
          </option>
        </select>
        
        <span class="iters-label">ROB size: </span>
        <input type="number" title="# ROB entries" id="rob-size" name="rob-size" min="1" max="200"
               v-model.number="simState.ROBsize">
      </div>
    </div>
    
    <!-- <div class="cache-info" id="cache-info"></div>   -->
    <div class="pipeline-img">
      <div v-html="pipelineSvg" v-if="pipelineSvg"></div>
    </div>

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
  .pipeline-container {
    width:   100%;
    height:  100%;
    padding: 20px;
  }
  .pipeline-img {
    display:         flex;
    align-items:     center;
    justify-content: center;
    position:        relative;
    margin:          10px auto;
    margin-top:      10%;
    width:           100%;
    height:          250px;
    /* min-height:      200px; /* Fixed height or use min-height */
    border:          2px solid #e0e0e0;
    border-radius:   8px;
    background:      #f8f9fa;
    overflow:        hidden;
  }
  .pipeline-img :deep(svg) {
    width:      100% !important;
    height:     100% !important;
    max-width:  100% !important;
    max-height: 100% !important;
    object-fit: contain; /* Keeps aspect ratio */
    display:    block;
  }
  .pipeline-img :deep(svg) g {
    transform-box: fill-box;
  }
  
  /* Make GraphViz elements more visible */
  .pipeline-img svg text {
    font-size:   12px !important;
    font-family: Arial, sans-serif !important;
  }

  .pipeline-img svg polygon,
  .pipeline-img svg path {
    stroke-width: 2px !important;
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
