<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, watch } from 'vue'
  import HelpComponent    from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

  const { setProcessor }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  // Reactive SVG string
  const pipelineSvg         = ref('');
  const currentProcessor    = ref('');
  const availableProcessors = ref([]);

  // Watch for processor changes
  watch(() => currentProcessor, (newProcessor, oldProcessor) => {
    console.log(`Processor changed from "${oldProcessor}" to "${newProcessor}"`);
    if (newProcessor && newProcessor !== oldProcessor) {
      reloadProcessor();
    }
  });

  // Watch for changes on RVCAT import
  watch(() => simState.RVCAT_imported, (newValue, oldValue) => {
    if (newValue) {
      console.log('RVCAT imported: look for processors and select current');
      initProcessor();
    }
  });

  // Handler for 'set_processor' message (fired by this component)
  const handleSetProcessor = (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to set processor:', data);
      return;
    }
    simState.selectedProcessor = currentProcessor.value;  // fire other components, watching for a change
    console.log('Processor set into RVCAT')
  }

  onMounted(() => {
    const cleanupHandleSet = registerHandler('set_processor',  handleSetProcessor);
  });

  onUnmounted(() => {
    cleanupHandleSet();
  });

  
  const initProcessor = async () => {
    console.log('Init processor list');
    try {
      let processorKeys = getKeys('processor') // from localStorage

      if (processorKeys.length == 0) { // load processors from distribution files
        console.log('Load processors from distribution files')
        const response = await fetch('./index.json')
        const data     = await response.json()
        for (let i = 0; i < data.processors.length; i += 1) {
           const filedata = await loadJSONfile(`./processors/${data.processors[i]}.json`)
           localStorage.setItem(`processor.${data.processors[i]}`, JSON.stringify(filedata))
        }
        processorKeys = getKeys('processor')
      }
      availableProcessors.value = processorKeys
      currentProcessor.value = processorKeys[0]
      reloadProcessor()
    } catch (error) {
      console.error('Failed to set processor:', error)
      programText.value = 'Failed to set program';
    }      
  }
  
  const reloadProcessor = async () => {
    console.log('Reloading processor with:', currentProcessor.value);
    try {
      const jsonString = localStorage.getItem(`processor.${currentProcessor.value}`)
      const processorInfo = JSON.parse(jsonString)
      setProcessor( jsonString )   // Call Python RVCAT to load new processor config --> 'set-processor'
      //   insert_cache_annotations(cache)
      const svg = await getProcessorGraph(processorInfo);
      pipelineSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('Failed to set processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }
  
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
        <select v-model="currentProcessor.value" title="Select Processor">
          <option value="" disabled>Select</option>
          <option 
            v-for="processor in availableProcessors" 
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

    <div class="pipeline-container">
      <div class="cache-info" id="cache-info"></div>
      <div class="pipeline-img">
        <div v-html="pipelineSvg" v-if="pipelineSvg"></div>
      </div>
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
    padding: 2px;
  }
  .pipeline-img {
    width:           100%;
    height:          150px;
    display:         flex;
    align-items:     center;
    justify-content: center;
    overflow:        hidden;
    position:        relative;
    margin:          2px auto;
    margin-top:      5%;
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
    max-width: 20%;
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
