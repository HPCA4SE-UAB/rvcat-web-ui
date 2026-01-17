<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, reactive, watch } from 'vue'
  import HelpComponent    from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

  const { setProcessor }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

 /* ------------------------------------------------------------------ 
   * Processor options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'processorOptions'

  const defaultOptions = {
    currentProcessor:    '',
    currentROBsize:      20,
    availableProcessors: []
  }
  
  const savedOptions = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const processorOptions = reactive({ ...defaultOptions, ...savedOptions })
  
  const pipelineSvg      = ref('')
  let   cleanupHandleSet = null

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(processorOptions))
    } catch (error) {
      console.error('❌ Failed to save:', error)
    }
  }

  // Watch for changes on RVCAT state
  watch(() => simState.RVCAT_state, (newValue, oldValue) => {
    if (newValue == 1) {
      console.log('RVCAT imported: look for processors and select current');
      initProcessor()
    }
  });

  // Handler for 'set_processor' message (fired by this component)
  const handleSetProcessor = (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to set processor:', data);
      return;
    }
    simState.selectedProcessor = processorOptions.currentProcessor;  // fire other components
    if (simState.RVCAT_state == 1) {  // RVCAT only imported
      simState.RVCAT_state = 2;                  // fire program load
      console.log('RVCAT Initialization: processor set. Next, program must be set')
    }
    else
       console.log('New processor set into RVCAT')
    drawProcessor()
  }

  onMounted(() => {
    cleanupHandleSet = registerHandler('set_processor',  handleSetProcessor);
    try {    // Load from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(processorOptions, JSON.parse(saved))
      }
      if (simState.RVCAT_state == 1) {
        console.log('RVCAT just imported: look for processors and select current');
        initProcessor()
      }
    } catch (error) {
      console.error('❌ Failed to load:', error)
    }
  });

  onUnmounted(() => {
    if (cleanupHandleTimeline) {
      cleanupHandleSet()
      cleanupHandleSet = null
    }
  });

  // Watch ALL processor options for changes
  watch(processorOptions, () => {
    try {     
      processorOptions.currentROBsize = Math.min(processorOptions.currentROBsize, 200);
      processorOptions.currentROBsize = Math.max(processorOptions.currentROBsize, 1);
      saveOptions()
      if (simState.RVCAT_state > 0) {  // imported or loaded
         if (processorOptions.currentProcessor !== simState.selectedProcessor) {  // Processor changed
            console.log(`Processor changed from "${simState.selectedProcessor}" to "${processorOptions.currentProcessor}"`);
            reloadProcessor()
            return
         }
        if (processorOptions.currentROBsize !== simState.ROBsize)  { // ROB size changed
          console.log(`ROB size changed from "${oldValue}" to "${newValue}"`);
          drawProcessor()
          simState.ROBsize = processorOptions.currentROBsize // fires other components
        }
      }
    } catch (error) {
      console.error('Failed to save dependence graph options:', error)
    } 
  },
  { deep: true, immediate: true })
  
  const initProcessor = async () => {
    console.log('Init processor list');
    try {
      if (processorOptions.availableProcessors.length == 0) {
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
        processorOptions.availableProcessors = processorKeys
        processorOptions.currentProcessor    = processorKeys[0]  // creates reactive action to reloadProcessor
      }
      else {
        console.log('Processors already stored on localStorage. Set processor')
        reloadProcessor()
      }
    } catch (error) {
      console.error('Failed to set processor:', error)
    }      
  }
  
  const reloadProcessor = async () => {
    console.log('Reloading processor with:', processorOptions.currentProcessor);
    try {
      const jsonString    = localStorage.getItem(`processor.${processorOptions.currentProcessor}`)
      const processorInfo = JSON.parse(jsonString)
      setProcessor( jsonString )  // Call Python RVCAT to load new processor config --> 'set-processor'
    } catch (error) {
      console.error('Failed to set processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }
  
  const drawProcessor = async () => {
    console.log('Redrawing processor');
    try {
      const jsonString    = localStorage.getItem(`processor.${processorOptions.currentProcessor}`)
      const processorInfo = JSON.parse(jsonString)
      const dotCode = get_processor_dot (
         processorInfo.stages.dispatch,
         Object.keys(processorInfo.ports).length, 
         processorInfo.stages.retire,
         processorOptions.currentROBsize,
         {
           'nBlocks':    processorInfo.nBlocks,
           'blkSize':    processorInfo.blkSize,
           'mPenalty':   processorInfo.mPenalty,
           'mIssueTime': processorInfo.mIssueTime
         }
      );
      const svg = await createGraphVizGraph(dotCode);  
      pipelineSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('Failed to draw processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function insert_cache_annotations(cache) {
    if (cache.nBlocks>0){
      document.getElementById('cache-info').innerHTML=`
       <b>Cache:</b><span>${cache.nBlocks} blocks of ${cache.blkSize} bytes. Miss penalty: ${cache.mPenalty}. Miss Issue time: ${cache.mIssueTime}</span>`;
    }
    else {
      document.getElementById('cache-info').innerHTML="<b>Processor does not simulate a cache memory.</b>";
    }
  }

  function get_processor_dot(dispatch_width, num_ports, retire_width, rob_size, cache) {
    let dot_code = `
    digraph "Processor Pipeline" {
      rankdir=TB;
      node [fontsize=14, fontname="Arial"];

      Fetch [
        shape=point
        width=0
        height=0
        fixedsize=true
        label=""
        margin=0
        style=invis
      ];
    `;

    // --- FETCH  ---
    dot_code += `  Fetch [style=invis, shape=box, height=0, width=0];\n`;
    dot_code += `
      Fetch -> "Waiting Buffer" [
        label="Dispatch = ${dispatch_width}",
        tooltip="Dispath Width: instructions per cycle",
        fontsize=14, fontname="Arial"
      ];
    `;

    // --- WAITING BUFFER ---
    dot_code += `"Waiting Buffer" [label="Waiting\\nBuffer", tooltip="Instructions wait for execution", shape=box, height=1, width=1, fixedsize=true];\n`;

    // --- EXECUTE PORTS ---
    dot_code += `subgraph cluster_execute {
        rankdir=TB;
        node [shape=box3d, height=0.4, width=0.6, fixedsize=true];
        tooltip="Execution Ports: one instruction per cycle, per port";
    `;

    let shown_ports = [];
    if (num_ports >= 4) {
      shown_ports = [0, 1, 2, num_ports - 1];

      dot_code += `P${num_ports - 1} [label="P${num_ports - 1}",tooltip="Execution Port: one instruction per cycle"];\n`;
      if (num_ports > 4) {
        dot_code += `"..." [label="...", tooltip="Remaining execution ports: one instruction per cycle and port"];\n`;
      }
      dot_code += `P2 [label="P2", tooltip="Execution Port: one instruction per cycle"];\n`;
      dot_code += `P1 [label="P1", tooltip="Execution Port: one instruction per cycle"];\n`;
      dot_code += `P0 [label="P0", tooltip="Execution Port: one instruction per cycle"];\n`;
    } else {
      for (let i = num_ports - 1; i >= 0; i--) {
        shown_ports.push(i);
        dot_code += `P${i} [label="P${i}", tooltip="Execution Port: one instruction per cycle"];\n`;
      }
    }

    dot_code += `}\n`;

    for (let idx = 0; idx < shown_ports.length; idx++) {
      dot_code += `"Waiting Buffer" -> P${shown_ports[idx]}[tooltip="One instruction per cycle and port"];\n`;
    }
    if (num_ports>4) {
      dot_code += `"Waiting Buffer" -> "..." [style=invis];\n`;
    }
    // REGISTERS
    dot_code += `Registers [shape=box, height=1, width=1, fixedsize=true, tooltip="Architectural state: updated on instruction retirement"];\n`;

    dot_code += `
    {
      rank=same;
      Fetch;
      "Waiting Buffer";
      tooltip="Instructions wait for input data and available port"
    `;

    if (num_ports >= 4) {
      dot_code += `P0; P1; P2;\n`;

      if (num_ports > 4) {
        dot_code += `"...";\n`;
      }
      dot_code += `P${num_ports - 1};\n`;
    } else {
      for (let i = 0; i < shown_ports.length; i++) {
        dot_code += `P${shown_ports[i]};\n`;
      }
    }

    dot_code += `Registers;\n  }\n`;

    // --- ROB ---
    dot_code += `ROB [label="ROB: ${rob_size} entries", tooltip="Reorder Buffer: maintains sequential program order", shape=box, height=0.6, width=5, fixedsize=true];\n`;
    dot_code += `{ rank=sink; ROB; }\n\n`;

    dot_code += `Fetch -> ROB;\n`;
    for (let i = 0; i < shown_ports.length; i++) {
      dot_code += `P${shown_ports[i]} -> ROB;\n`;
    }
    dot_code += `
      ROB -> Registers [
        label="Retire = ${retire_width}",
        tooltip="Instructions update registers in program order"
        fontsize=14, fontname="Arial"
      ];
    `;

    dot_code += `}\n`;
    return dot_code;
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
        <select v-model="processorOptions.currentProcessor" title="Select Processor">
          <option value="" disabled>Select</option>
          <option 
            v-for="processor in processorOptions.availableProcessors" 
            :key="processor"
            :value="processor"
          >
            {{ processor }}
          </option>
        </select>
        
        <span class="iters-label">ROB size: </span>
        <input type="number" title="# ROB entries" id="rob-size" name="rob-size" min="1" max="200"
               v-model.number="processorOptions.currentROBsize">
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
