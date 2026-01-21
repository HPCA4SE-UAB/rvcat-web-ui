<script setup>
  import { ref, unref, onMounted, onUnmounted, nextTick, inject, computed, reactive, watch } from 'vue'
  import HelpComponent    from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

  const { setProcessor }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  // Usando Composition API con setup
  const props = defineProps({
    isFullscreen: {
      type: Boolean,
      default: false
    }
  })

 /* ------------------------------------------------------------------ 
   * Processor options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'processorOptions'

  const defaultOptions = {
    currentProcessor:    '',
    currentROBsize:      20,
    availableProcessors: []
  }

  // JSON of current processor configuration. Updated by ReloadProcessor()
  let jsonString    = ''
  let processorInfo = null

  const dispatch        = ref(1);
  const retire          = ref(1);
  const resources       = reactive({});
  const name            = ref("default");
  const ports           = ref({});
  const nBlocks         = ref(0);
  const blkSize         = ref(1);
  const mPenalty        = ref(1);
  const mIssueTime      = ref(1);
  
  const showModalChange = ref(false);
  const prevProcessor   = ref(null);
  
  let prevProcessorHandler;
  let processorsListHandler;
  let lastRequestId         = 0;
  let modalConfirmOperation = null;

  const availableInstructions = [ "INT", "BRANCH", "MEM.STR", "MEM.LOAD", "MEM.VLOAD", "MEM.VSTR", "FLOAT.ADD", "FLOAT.MUL", "FLOAT.FMA", "FLOAT.DIV", "FLOAT.SQRT", "VFLOAT.ADD", "VFLOAT.MUL", "VFLOAT.FMA" ]

  const originalSettings = reactive({
    dispatch:   1,
    retire:     1,
    resources:  {},
    name:       "default",
    ports:      {},
    rports:     {},
    cache:      null,
    nBlocks:    0,
    blkSize:    1,
    mPenalty:   1,
    mIssueTime: 1,
  });

  // --- computed lists ---
  const portList = computed(() => Object.keys(ports.value));

  // --- modal state ---
  const showModalDown = ref(false);
  const showModalUp   = ref(false);
  const modalName     = ref("");
  const modalDownload = ref(true);
  const nameError     = ref("");
  
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
      simState.RVCAT_state = 2;       // fire program load
      console.log('RVCAT Initialization: processor set. Next, program must be set')
    }
    else
       console.log('New processor set into RVCAT')
    updateProcessorSettings();
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
          console.log(`ROB size changed to "${processorOptions.currentROBsize}"`);
          drawProcessor()
          simState.ROBsize = processorOptions.currentROBsize // fires other components
        }
      }
    } catch (error) {
      console.error('Failed to handle changes on processor:', error)
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
      jsonString    = localStorage.getItem(`processor.${processorOptions.currentProcessor}`)
      processorInfo = JSON.parse(jsonString)
      setProcessor( jsonString )  // Call Python RVCAT to load new processor config --> 'set-processor'
    } catch (error) {
      console.error('Failed to set processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  // --- load & update processor settings ---
  const updateProcessorSettings = async () => {
    try {
      dispatch.value   = processorInfo.stages.dispatch;
      retire.value     = processorInfo.stages.retire;
      name.value       = processorInfo.name;
      ports.value      = processorInfo.ports || {};
      nBlocks.value    = processorInfo.nBlocks;
      blkSize.value    = processorInfo.blkSize;
      mIssueTime.value = processorInfo.mIssueTime;
      mPenalty.value   = processorInfo.mPenalty;

      // refresh resources
      Object.keys(resources).forEach(k => delete resources[k]);
      Object.entries(processorInfo.resources || {}).forEach(([k,v]) => {
        resources[k] = v;
      });

      // stash original
      Object.assign(originalSettings, {
        dispatch:   processorInfo.stages.dispatch,
        retire:     processorInfo.stages.retire,
        name:       processorInfo.name,
        resources:  JSON.parse(JSON.stringify(processorInfo.resources || {})),
        ports:      JSON.parse(JSON.stringify(processorInfo.ports || {})),
        rports:     JSON.parse(JSON.stringify(processorInfo.rports || {})),
        cache:      processorInfo.cache,
        nBlocks:    processorInfo.nBlocks,
        blkSize:    processorInfo.blkSize,
        mPenalty:   processorInfo.mPenalty,
        mIssueTime: processorInfo.mIssueTime,
      });
    } catch(e) {
      console.error("Failed to update processor settings:", e);
    }
  };

  function updateProcessor(name) {
    if ( processorOptions.availableProcessors.includes(name) )
        return false   // choose another name
    
    processorInfo = getCurrentProcessorJSON(name);
    jsonString    = JSON.stringify(processorInfo, null, 2)

    setTimeout(()=>{
      localStorage.setItem(`processor.${name}`, jsonString)
      processorOptions.availableProcessors = getKeys('processor')
      processorOptions.currentProcessor    = name;
    }, 100);
    
    Object.assign(originalSettings, {
      dispatch:   processorInfo.stages.dispatch,
      retire:     processorInfo.stages.retire,
      name:       processorInfo.name,
      resources:  JSON.parse(JSON.stringify(processorInfo.resources)),
      ports:      JSON.parse(JSON.stringify(processorInfo.ports)),
      rports:     JSON.parse(JSON.stringify(processorInfo.rports)),
      cache:      processorInfo.cache,
      nBlocks:    processorInfo.nBlocks,
      blkSize:    processorInfo.blkSize,
      mPenalty:   processorInfo.mPenalty,
      mIssueTime: processorInfo.mIssueTime,
    });

    return true  // processor replaced
  }

  async function downloadProcessor(name) {
     // force a Save As... dialog if API is supported
     if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${name}.json`,
          types: [{
            description: 'JSON files',
            accept: { 'application/json': ['.json'] }
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();
     } else {
        // fallback: traditional anchor download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `${name}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
     }
  }
  
  function uploadProcessor(event) {
    const inputEl = event.target;
    const file    = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        
        // === apply JSON to your reactive state ===
        dispatch.value   = data.stages?.dispatch ?? dispatch.value;
        retire.value     = data.stages?.retire   ?? retire.value;
        name.value       = data.name             ?? name.value;
        nBlocks.value    = data.nBlocks;
        blkSize.value    = data.blkSize;
        mIssueTime.value = data.mIssueTime;
        mPenalty.value   = data.mPenalty;

        // update resources
        Object.keys(resources).forEach(k => delete resources[k]);
        Object.entries(data.resources || {}).forEach(([k,v]) => {
          resources[k] = v;
        });

        // update ports
        ports.value = data.ports || {};

        // stash originalSettings if needed...
        Object.assign(originalSettings, {
          dispatch:   data.stages?.dispatch ?? 0,
          retire:     data.stages?.retire   ?? 0,
          name:       data.name             ?? "",
          resources:  JSON.parse(JSON.stringify(data.resources||{})),
          ports:      JSON.parse(JSON.stringify(data.ports||{})),
          rports:     JSON.parse(JSON.stringify(data.rports||{})),
          cache:      data.cache,
          nBlocks:    data.nBlocks,
          blkSize:    data.blkSize,
          mPenalty:   data.mPenalty,
          mIssueTime: data.mIssueTime,
        });

        // === now pop up the Save‐As dialog ===
        // strip extension from filename for default
        modalName.value     = file.name.replace(/\.[^.]+$/, "");
        modalDownload.value = false;
        nameError.value     = "";
        showModalUp.value   = true;

      } catch (err) {
        console.error("Invalid JSON:", err);
        alert("Failed to load processor config. Please, check the file.");
      }
      inputEl.value = "";
    };
    reader.readAsText(file);
  }

  const drawProcessor = async () => {
    console.log('Redrawing processor');
    try {
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

/* <b>Cache:</b><span>${cache.nBlocks} blocks of ${cache.blkSize} bytes. Miss penalty: ${cache.mPenalty}. 
   Miss Issue time: ${cache.mIssueTime}</span>`; */

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


/********************************************************
 **  Manipulation of processor data in User Interface ***
 ********************************************************/
  
  // return current processor configuration as JSON
  function getCurrentProcessorJSON(name) {
    const rports = {};
    Object.entries(ports.value).forEach(([port, instrs]) => {
      instrs.forEach(instr => {
        if (!rports[instr]) rports[instr] = [];
        rports[instr].push(port);
      });
    });
    return {
      name: name,
      stages: {
        dispatch: dispatch.value,
        execute:  Object.keys(ports.value).length,
        retire:   retire.value,
      },
      resources:  { ...resources },
      ports:      ports.value,
      rports:     rports,
      cache:      originalSettings.cache,
      nBlocks:    nBlocks.value,
      blkSize:    blkSize.value,
      mPenalty:   mPenalty.value,
      mIssueTime: mIssueTime.value,
    };
  }

  function shallowEq(a, b) {  
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let k of ka) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
  
  function portsEq(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    
    if (ka.length !== kb.length) return false;
    
    for (let k of ka) {
      const arrA = a[k] || [], arrB = b[k] || [];
      if (arrA.length !== arrB.length) return false;

      // get frequencies as arrays could be in different order
      const freq = new Map();
      for (let v of arrA) {
        freq.set(v, (freq.get(v) || 0) + 1);
      }
      for (let v of arrB) {
        if (!freq.has(v)) return false;
        freq.set(v, freq.get(v) - 1);
        if (freq.get(v) === 0) freq.delete(v);
      }
      // after removing all arrB items, map should be empty
      if (freq.size !== 0) return false;
    }
    return true;
  }
  
  const isModified = computed(() => {
    if (dispatch.value !== originalSettings.dispatch)       return true;
    if (retire.value   !== originalSettings.retire)         return true;
    if (nBlocks.value   !== originalSettings.nBlocks)       return true;
    if (blkSize.value   !== originalSettings.blkSize)       return true;
    if (mPenalty.value   !== originalSettings.mPenalty)     return true;
    if (mIssueTime.value   !== originalSettings.mIssueTime) return true;
    if (!shallowEq(resources, originalSettings.resources))  return true;
    if (!portsEq(ports.value, originalSettings.ports))      return true;
    return false;
  });

  function canLeave() {
    return isModified.value;
  }

  defineExpose({ canLeave });
  
  // --- port add/delete ---
  function addPort() {
    const existing = portList.value.map(n => parseInt(n,10)).sort((a,b)=>a-b);
    let next = 0;
    for (; existing.includes(next); next++);
    ports.value[next] = [];
  }
  
  function removePort(port) {
    const idx = Number(port);
    delete ports.value[idx];

    //sort and reindex other ports
    const leftover = Object.entries(ports.value)
      .map(([k,v]) => [Number(k), v])
      .sort((a,b) => a[0] - b[0]);

    Object.keys(ports.value).forEach(k => delete ports.value[k]);
    leftover.forEach(([oldIdx, portArr], newIdx) => {
      ports.value[newIdx] = portArr;
    });
  }

  function togglePortInstruction(portNum, instruction, isChecked) {
    if (!ports.value[portNum]) ports.value[portNum] = [];
    if (isChecked) {
      if (!ports.value[portNum].includes(instruction))
        ports.value[portNum].push(instruction);
    } else {
      ports.value[portNum] = ports.value[portNum].filter(i => i !== instruction);
    }
  }

  function noPortAssigned(instr) {
    if (!portList.value.some(p => ports.value[p]?.includes(instr))) {
      ports.value[0].push(instr)
      showTooltip.value = true
      setTimeout(() => { showTooltip.value = false }, 2000)
    }
    return !portList.value.some(p => ports.value[p]?.includes(instr))
  }


/* ------------------------------------------------------------------ 
 * Confirm Modal support 
 * ------------------------------------------------------------------ */

  function openModal() {
    modalName.value     = name.value + "*";
    modalDownload.value = true;
    nameError.value     = "";
    showModalDown.value = true;
  }

  function closeModal() {
    showModalDown.value = false;
    showModalUp.value   = false;
  }
  
  function confirmLeave(){
    showModalChange.value = false;
    if(modalConfirmOperation=='upload') {
      document.getElementById('file-upload').click();
    }
    else if(modalConfirmOperation=='change') {
      updateProcessorSettings();
    }
  }

  function cancelLeave() {
    if (modalConfirmOperation=='change') {
      programOptions.currentProcessor = prevProcessor.value;
    }
    showModalChange.value = false;
  }

  function openUploadModal() {
    if (isModified.value) {
      showModalChange.value = true;
      modalConfirmOperation = 'upload';
    }
    else {
      document.getElementById('file-upload').click();
    }
  }

  async function confirmModal() {
    if (!updateProcessor(modalName.value)) {
      nameError.value = "A processor configuration with this name already exists. Please, choose another one.";
      return;
    }

    if (modalDownload.value) {    //download JSON file
      downloadProcessor(modalName.value)
    }
    showModalDown.value = false;
    showModalUp.value   = false;
  }

/* ------------------------------------------------------------------ 
 * Help support 
 * ------------------------------------------------------------------ */
  const showHelp  = ref(false); const helpIcon  = ref(null);
  const showHelp1 = ref(false); const showHelp2 = ref(false); const showHelp3 = ref(false); const showHelp4 = ref(false);
  const helpIcon1 = ref(null);  const helpIcon2 = ref(null);  const helpIcon3 = ref(null);  const helpIcon4 = ref(null);
  const helpPosition = ref({ top: '0%', left: '40%' });

  function openHelp()  { nextTick(() => { showHelp.value = true }) }
  function closeHelp() { showHelp.value  = false }
  function openHelp1()  { nextTick(() => { showHelp1.value = true }) }
  function closeHelp1() { showHelp1.value  = false }
  function openHelp2()  { nextTick(() => { showHelp2.value = true }) }
  function closeHelp2() { showHelp2.value  = false }
  function openHelp3()  { nextTick(() => { showHelp3.value = true }) }
  function closeHelp3() { showHelp3.value  = false }
  function openHelp4()  { nextTick(() => { showHelp4.value = true }) }
  function closeHelp4() { showHelp4.value  = false }
</script>

<template>
  <div class="main">

    <div v-if="!isFullscreen">
      <div class="header">
        <div class="section-title-and-info">
          <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
          <span class="header-title">Processor</span>
        </div>
        <div class="settings-container">
          <select v-model="processorOptions.currentProcessor" title="Select Processor">
            <option value="" disabled>Select</option>
            <option v-for="processor in processorOptions.availableProcessors" :key="processor" :value="processor" >
              {{ processor }}
            </option>
          </select>
          <div class="iters-group">
            <span class="iters-label">ROB size:</span>
            <input type="number" min="1" max="200" title="# ROB entries" 
                 v-model.number="processorOptions.currentROBsize">
          </div>
        </div>
      </div>
      <div class="pipeline-container">
        <div class="pipeline-img">
          <svg v-html="pipelineSvg" v-if="pipelineSvg"></svg>
        </div>
      </div>
    </div>

    <div v-if="isFullscreen" class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Processor Settings - <strong>{{  simState.selectedProcessor }}</strong></span>
      </div>
      
      <div class="settings-container fullscreen-settings">
        <select v-model="processorOptions.currentProcessor" title="Select Processor">
          <option value="" disabled>Select</option>
          <option v-for="processor in processorOptions.availableProcessors" :key="processor" :value="processor" >
            {{ processor }}
          </option>
        </select>

        <div class="buttons">
          <button class="blue-button" title="Apply/Save new processor configuration" @click="openModal" 
                  :disabled="!isModified"> Apply Changes </button>
          <input id="file-upload" type="file" accept=".json" @change="uploadProcessor" style="display: none;"/>
          <button class="blue-button" title="Load new Processor" @click="openUploadModal"> Upload </button>
        </div>
      </div>
    </div>

    <div v-if="isFullscreen" class="settings-sections">
    
      <!-- Widths Group -->
      <div class="settings-group widths-group">
        <div class="section-title-and-info">
          <div class="title-group left-group">
            <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show Help">
              <img src="/img/info.png" class="info-img">
            </span>
            <span class="header-title">Stage Width Settings</span>
          </div>
          <div class="spacer"></div>
          <div class="spacer"></div>
          <div class="title-group right-group">
            <span ref="helpIcon3" class="info-icon" @click="openHelp3" title="Show Help">
              <img src="/img/info.png" class="info-img">
            </span>
            <span class="header-title">Cache Memory Settings</span>
          </div>
        </div>
          
        <div class="iters-group">
          <span>Dispatch:</span>
          <input type="number" v-model.number="dispatch" min="1" max="9" 
                 title="max. number of instructions dispatched per cycle"/>
        
          <span>Retire:</span>
          <input type="number" v-model.number="retire" min="1" max="9" 
                   title="max. number of instructions retired per cycle"/>

          <div class="spacer"></div>
 
          <span>Number of Blocks:</span>
          <input type="number" v-model.number="nBlocks" min="0" max="32" 
                 title="Memory blocks stored into cache (0 => no cache)"/>
        
          <span>Block Size:</span>
          <div class="button-group">
            <button @click="blkSize = Math.max(1, blkSize / 2)">−</button>
            <input type="number" v-model.number="blkSize" readonly
                   title="Size of Memory block: must be a power of two"
             />
            <button @click="blkSize = Math.min(128, blkSize * 2)">+</button>
          </div>

          <span>Miss Penalty:</span>
          <input type="number" v-model.number="mPenalty" min="1" max="99" 
                 title="Extra latency due to cache miss"/>

          <span>Miss Issue Time:</span>
          <input type="number" v-model.number="mIssueTime" min="1" max="99" 
                 title="Minimum time between Memory accesses"/>
        </div>
      </div> <!--- Width-group Settings Group -->
      
      
      <!-- Contenedor para tabla + imagen en horizontal -->
      <div class="horizontal-layout">
        <!-- Latency and Port Settings Group (izquierda) -->
        <div class="settings-group latency-group">
              
          <div class="section-title-and-info">
            <span ref="helpIcon4" class="info-icon" @click="openHelp4" title="Show Help" >
              <img src="/img/info.png" class="info-img">
            </span>
            <span class="header-title">Instruction Latencies and Execution Ports</span>
          </div>

          <!-- Ports toolbar -->
          <div class="ports-toolbar">
            <span v-for="port in portList" :key="port" class="port-tag">
              P{{ port }}
              <button v-if="portList.length > 1" class="delete-port" @click="removePort(port)" 
                      :title="`Remove port P${port} from the Execution Engine`">
                <img src="/img/delete.png" class="delete-icon" width="16px">
              </button>
            </span>
            <button v-if="portList.length < 10" title="Add new port to the Execution Engine" class="add-port" @click="addPort">
              + Add Port
            </button>
          </div>
            
          <!-- Tabla -->
          <div class="table-container">
            <table class="instr-table" style="border: 3px solid green;">
              <thead>
                <tr style="background: cyan;">
                  <th>TYPE</th><th>LATENCY</th>
                  <th v-for="port in portList" :key="port">P{{ port }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="instr in availableInstructions" :key="instr" style="background: #f0f0f0;">
                  <td>{{ instr }}</td>
                  <td>
                    <div class="latency-group">
                      <input type="number" v-model.number="resources[instr]" class="latency-input" min="1" max="99"
                         title="Execution latency in clock cycles for the corresponding instruction type (1 to 99)"/>
                    </div>
                  </td>
                  <td v-for="port in portList" :key="port" class="port-checkbox">
                    <label class="port-label">
                      <input type="checkbox" title="Indicates if this port can execute the corresponding instruction type"
                      :checked="(ports[port] || []).includes(instr) || (port === portList[0] && noPortAssigned(instr))"
                      @change="togglePortInstruction(port, instr, $event.target.checked)" />
                    </label>
                  </td>
                </tr>
              </tbody>
            </table>
          </div> <!--- Table Container -->
        </div> <!--- Latency & Port Settings Group -->

        <div class="pipeline-side-container">
          <div class="pipeline-img">
            <div v-html="pipelineSvg" v-if="pipelineSvg"></div>
          </div>
        </div>
        
      </div>
    </div>
  </div>
  
  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    text="Provides graphical visualization of the <strong>processor microarchitecture</strong> (pipeline) characteristics.
        <p>Modify the size of the <strong>ROB</strong> (ReOrder Buffer) or select a new <em>processor configuration</em> file from the list.
        Pin the <strong>Edit Processor</strong> tab to modify the microarchitectural parameters.</p>"
    title="Processor MicroArchitecture"
    @close="closeHelp" />

    <HelpComponent v-if="showHelp1" :position="helpPosition" 
    text="Modify the simulated processor’s <strong>configuration settings</strong>, including: (1) <em>Dispatch & Retire</em> Widths;
      (2) <em>Cache Memory</em>; (3) <em>Execution Ports</em> (Add or remove execution ports, up to a maximum of 10); and
      (4) <em>Execution Latencies</em>"
    title="Processor Settings"
    @close="closeHelp1"/>

    <HelpComponent v-if="showHelp2" :position="helpPosition" 
    text="Modify the <strong>Dispatch</strong> and/or <strong>Retire</strong> Widths. 
       They indicate the maximum number of instructions per clock cycle that must be dispatched into or retired from the Execution Engine.
      <p>They may impose a throughput-bound performace limit.</p>"
    title="Dispatch/Retire Width Settings"
    @close="closeHelp2"/>

    <HelpComponent v-if="showHelp3" :position="helpPosition" 
    text="Modify the <strong>Cache Memory</strong> settings. Setting a Number of Blocks = 0 means all data accesses 
      will always hit in the cache, and, therefore, the latency of memory loads and stores will always be the same.
      <p>The cache miss latency indicates the extra time required to execute load and store instructions when they miss in the cache.
      The cache miss issue time (<strong>m</strong>) is the minimum time required to issue consecutive memory block read/write requests to the Main Memory. 
      It determines the maximum Main Memory bandwidth (one memory block every <strong>m</strong> clock cycles)</p>"
    title="Cache Memory Settings"
    @close="closeHelp3"/>

  <HelpComponent v-if="showHelp4" :position="helpPosition" 
    text="Modify the <strong>Latency</strong> and the maximum <strong>Execution Thorughput</strong> of instruction types.
      <p>Each instruction type can be assigned a fixed execution latency and a set of eligible execution ports 
         (only one is used for execution each instruction). A given execution port, named <em>Px</em>, can start executing one instruction every clock cycle.
        If a port is deleted, execution port P0 is automatically assigned to any instruction types left without a valid port.</p>"
    title="Instruction Latency and Throughput Settings"
    @close="closeHelp4"/>
    
  </Teleport>
  
  <!-- Modal Dialog -->
  <div v-if="showModalDown" class="modal-overlay">
    <div class="modal">
      <h4>Save Configuration As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" title="file name of new processor configuration" v-model="modalName"/>
      <div v-if="nameError" class="error">{{ nameError }}</div>

      <label class="download-checkbox">
        <input type="checkbox" v-model="modalDownload" />
        Download JSON file
        <span class="warning-wrapper" aria-label="Info">
          ⚠️
          <div class="tooltip-text">
            Saving a local copy is recommended as modified settings will not persist in your next session.
          </div>
        </span>
      </label>

      <div class="modal-actions">
        <button class="blue-button" title="Yes, I will save the current changes" @click="confirmModal">Apply</button>
        <button class="blue-button" title="No, I do not want to save the current changes" @click="closeModal">Cancel</button>
      </div>
    </div>
  </div>

  <div v-if="showModalUp" class="modal-overlay">
    <div class="modal">
      <h4>Load Configuration As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" title="name of loaded processor configuration" v-model="modalName"/>
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Yes, I want to load" @click="confirmModal">Load</button>
        <button class="blue-button" title="No, I want to cancel"  @click="closeModal">Cancel</button>
      </div>
    </div>
  </div>

  <div v-if="showModalChange" class="modal-overlay">
    <div class="modal">
      <p>The processor settings have been modified, but not saved. 
         Changes will be lost if you select or upload a new processor configuration.</p>
      <p><b>Do you want to continue?</b></p>
      <div class="modal-actions">
        <button class="blue-button" title="Yes, I want to continue" @click="confirmLeave">OK</button>
        <button class="blue-button" title="No, I want to cancel" @click="cancelLeave">Cancel</button>
      </div>
    </div>
  </div>   
</template>

<style scoped> 
  .horizontal-layout {
    display:     flex;
    gap:         6px; /* Espacio entre tabla e imagen */
    margin-top:  6px;
    align-items: stretch;
    height:      auto;
  }
  
  .settings-group.latency-group {
    display:        flex;
    flex: 1 1 45%;
    min-width: 0;           /* Importante para evitar desbordamiento */
    box-sizing: border-box; /* Incluye padding y border en el cálculo */
    flex-direction: column;
    align-items:    center;
    border:         1px solid #ccc;
    border-radius:  8px;
    padding:        0.3rem;
    background:     #fafafa;
  }
  
  /* Para que la tabla no se expanda más allá de lo necesario */
  .settings-group.latency-group .table-container {
    flex: 0 0 auto; /* No crece, se ajusta al contenido */
  }
  .pipeline-container {
    width:     100%;
    height:    100%;
    display:   flex;
  }
  .pipeline-side-container {
    flex: 1 1 55%;
    min-width: 0;           /* Importante para evitar desbordamiento */
    box-sizing: border-box; /* Incluye padding y border en el cálculo */
    display:   flex;
    padding:   2px;
    flex-direction: column;
    border:        1px solid #ddd;
    background:    #f8f9fa;
    border-radius: 8px;
  }

  .fullscreen-only {
    display: none;
  }
  
  .settings-container {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .fullscreen-settings {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .settings-sections {
    display:         flex;
    flex-direction:  column;
    justify-content: down;
    gap:             5px;
    width:           100%;
  }

  .button-group {
    display:     inline-flex;
    align-items: center;
  }
  .title-group {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .latency-group {
    flex: 1; /* Ocupa espacio disponible */
  }
  .latency-group .table-container {
    overflow-y: auto; /* Scroll vertical si la tabla es muy larga */
  }
  /* Input de latencia más compacto */
  .latency-input {
    width:     40px !important; /* Más estrecho */
    max-width: 60px;
    padding:   3px !important;
    margin:    0 auto !important;
  }

 /* Asegurar que los checkboxes sean pequeños */
 .port-checkbox {
   text-align: center;
 }
 .port-label {
    display: block;
    margin:  0;
    padding: 0;
 }
 .port-label input[type="checkbox"] {
    width:  12px;
    height: 14px;
    margin: 0;
    cursor: pointer;
  }

  .pipeline-img {
    width:        100%;
    height:       100%;
    max-width:    150%;
    max-height:   150%;
    align-items:  center;
    object-fit:   contain;
    transform-box: fill-box;
  }
  
  .pipeline-img svg text {
    font-size:   12px !important;
    font-family: Arial, sans-serif !important;
  }
  .pipeline-img svg polygon,
  .pipeline-img svg path {
    stroke-width: 2px !important;
  }

  .table-container {
     width:      auto; /* Se ajusta al contenido */
     max-width:  100%; /* Pero no más ancho que el contenedor */
     overflow-x: auto; /* Scroll si es necesario */
     overflow-y: auto; /* Scroll vertical si es necesario */
     padding-bottom: 30px; /* permite mover el contenedor y verlo completo */
  }

  table {
    display: table !important;
  }
  .instr-table {
    width:           auto;
    white-space:     nowrap;
    marginn-top:     1px;
    border-collapse: collapse;
  }

  .instr-table th,
  .instr-table td {
    padding:    1px;
    text-align: center;
    border:     1px solid #ddd;
  }

  .instr-table th {
    background-color: #f5f5f5;
    position: sticky;
    top:      0;
  } 

  /* Ajusta el ancho específico de las columnas */
  .instr-table th:first-child,  /* Columna TYPE */
  .instr-table td:first-child {
    text-align:  center;
    padding:     2px;
  }

  .instr-table th:nth-child(2),  /* Columna LATENCY */
  .instr-table td:nth-child(2) {
    min-width: 50px;
    max-width: 100px; 
    width: auto;
    padding: 2px;
  }

  /* Columnas de puertos - muy estrechas */
  .instr-table th:nth-child(n+3),  /* Todas las columnas de puertos */
  .instr-table td:nth-child(n+3) {
    width: auto;
    min-width: 20px;
    max-width: 60px;
    padding: 2px;
  }

  /* Chrome, Safari, Edge, Opera */
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button {
    -webkit-appearance: auto;
    width:      6ch;
    padding:    1px;
    margin:     0 2px;
    text-align: right;
  }

  /* Firefox */
  input[type=number] {
    appearance: auto;
    -moz-appearance: number-input;
    width:      6ch;
    padding:    1px;
    margin:     0 2px;
    text-align: right;
  }

  .ports-toolbar {
    margin: 4px 0;
  }
  .port-tag {
    display:       inline-flex;
    background:    #e3e3e3;
    border-radius: 4px;
    padding:       1px;
    margin-right:  1px;
    margin-bottom: 3px;
    font-size:     0.9em;
  }
  .delete-port {
    background:  none;
    border:      none;
    cursor:      pointer;
    font-weight: bold;
  }
  .add-port {
    background:    #4caf50;
    color:         white;
    border:        none;
    padding:       2px 4px;
    border-radius: 4px;
    cursor:        pointer;
    font-size:     0.9em;
  }

  .download-checkbox {
    display:    block;
    margin-top: 10px;
  }
  
  strong{
    margin:0;
  }
  .warning-wrapper {
    position: relative;
    display: inline-block;
    cursor: default;
  }

  .tooltip-text {
    visibility: hidden;
    width:      240px;
    color:      #fff;
    text-align: left;
    padding:    8px;
    font-size:  0.85em;
    position:   absolute;
    top:        50%;
    left:       100%;
    transform:  translate(8px, -50%);
    z-index:    10;
    opacity:    0;
    white-space:   normal;
    border-radius: 4px;
    transition:    opacity 0.2s ease-in-out;
    background-color: rgba(0, 0, 0, 0.7);
  }

  .warning-wrapper:hover .tooltip-text {
    visibility: visible;
    opacity: 1;
  }

  .spacer {
    min-width: 120px; /* Espacio mínimo entre elementos */
    height:    1px; /* Solo para referencia visual */  
  }

</style>
