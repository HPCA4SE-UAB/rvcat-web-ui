<script setup>
  import { ref, unref, onMounted, onUnmounted, nextTick, inject, computed, reactive, watch } from 'vue'
  import HelpComponent                                            from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                                             from '@/rvcatAPI'
  import {  modalState, resourceConfig, openSaveModal, closeAllModals, validateResourceName,
          downloadJSON, uploadJSON, loadFromLocalStorage, saveToLocalStorage, removeFromLocalStorage,
          initResource, createGraphVizGraph                                           } from '@/common'
  
  const { setProcessor }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

   // TO DO: obtain from a distribution/local file, or from Processor Configuration
  const availableInstructions = [ "INT", "BRANCH", "MEM.STR", "MEM.LOAD", "MEM.VLOAD", 
                                  "MEM.VSTR", "FLOAT.ADD", "FLOAT.MUL", "FLOAT.FMA",
                                  "FLOAT.DIV", "FLOAT.SQRT", "VFLOAT.ADD", "VFLOAT.MUL",
                                  "VFLOAT.FMA" ]

  const props = defineProps({
    isFullscreen: {
      type: Boolean,
      default: false
    }
  })
  

// ============================================================================
// Processor options & localStorage
// ============================================================================

  const STORAGE_KEY = 'processorOptions'

  const defaultOptions = {
    processorName:      '',
    ROBsize:            20,
    availableProcessors: []
  }

  let jsonString    = ''
  let processorInfo = null
  
  const savedOptions = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      console.log('💻load options')
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const processorOptions = reactive({ ...defaultOptions, ...savedOptions })
  const pipelineSvg      = ref('')

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(processorOptions))
    } catch (error) {
      console.error('💻❌ Failed to save processor options:', error)
    }
  }
    

// ============================================================================
// Temporal in-edition processor 
// ============================================================================

  const procConfig = reactive({
    dispatch:   1,
    retire:     1,
    latencies:  {},
    ports:      {0:[]},
    nBlocks:    0,
    blkSize:    1,
    mPenalty:   1,
    mIssueTime: 1
  });

  const portList = computed(() => 
    Object.keys(procConfig.ports)
      .map(k => Number(k))
      .sort((a, b) => a - b)
  );

  const updateProcessorSettings = async (procInfo) => {
    try {
      procConfig.dispatch   = procInfo.dispatch;
      procConfig.retire     = procInfo.retire;
      procConfig.retire     = procInfo.retire;
      procConfig.sched      = procInfo.sched || 'optimal';
      procConfig.nBlocks    = procInfo.nBlocks;
      procConfig.blkSize    = procInfo.blkSize;
      procConfig.mIssueTime = procInfo.mIssueTime;
      procConfig.mPenalty   = procInfo.mPenalty;

      // refresh latencies
      Object.keys(procConfig.latencies).forEach(k => delete procConfig.latencies[k]);
      Object.entries(procInfo.latencies || {}).forEach(([k,v]) => {
        procConfig.latencies[k] = v;
      });
    } catch(e) {
      console.error("💻❌ Failed to update processor settings:", e);
    }
  };


function loadEditedProcessor() {
  const stored = localStorage.getItem('processorTemp');
  if (!stored) return;
  try {
    const data = JSON.parse(stored);
    updateProcessorSettings(data)
  } catch (e) {
    console.error('📄❌ Failed to load edited processor from localStorage:', e);
  }
}


// ============================================================================
// WATCHES: processor, globalState  HANDLERS: setProcessor
// ============================================================================
   const ADD_NEW_OPTION = '_add_new_'

  // Watch ALL processor options for changes
  watch( [
    () => processorOptions.processorName,
    () => processorOptions.ROBsize,
    () => processorOptions.availableProcessors
  ],
  ([newName, newROBsize, newAvailable], [oldName, oldROBsize, oldAvailable]) => {
    try {    
      if (newName === ADD_NEW_OPTION)
        return uploadProcessor(oldName)

      if (newROBsize !== oldROBsize) {
        newROBsize = Math.max(Math.min(newROBsize, 200), 1);
        if (newROBsize === oldROBsize)
          return
      }

      if (newROBsize !== oldROBsize) {
        processorOptions.ROBsize = newROBsize
        saveOptions()
        console.log(`💻✅ ROB size changed to "${newROBsize}"`);
        drawProcessor()
        simState.ROBsize = newROBsize // fires other components
        return
      }

      if (simState.state > 0) {  // RVCAT already imported
         if (newName !== simState.selectedProcessor) {
           console.log(`💻✅ Processor changed from "${oldName}" to "${newName}"`);
           reloadProcessor()
         }
      }
    } catch (error) {
      console.error('💻❌ Failed to handle changes on processor:', error)
    } 
  },
  { deep: true, immediate: true })

  // Watch ALL processor configuration values for changes
  watch(procConfig, () => {
    try {
      localStorage.setItem('processorTemp', JSON.stringify(procConfig));
      if (simState.state >= 2)  // RVCAT imported & processor loaded
        drawProcessor()  
    } catch (error) {
      console.error('💻❌ Failed to handle changes on processor configuration:', error)
    } 
  },
  { deep: true, immediate: true })

  // Watch for changes on RVCAT state
  watch(() => simState.state, (newValue, oldValue) => {
    if (newValue == 1) { // This is an initialization step
      console.log('💻✅ Initialization Step (1): RVCAT imported')
      initProcessor()
    }
  });

  // Handler for 'set_processor' message (fired by this component)
  const handleSetProcessor = (data, dataType) => {
    if (dataType === 'error') {    
      console.error('💻❌ Failed to set processor:', data);
      return;
    }
    simState.selectedProcessor = processorOptions.processorName;  // fire other components
    if (simState.state == 1) {  // This is an initialization step
      simState.state = 2;       // Change to next initialization step
      console.log('💻✅ Initialization step (2): processor configuration provided to RVCAT')
    }
    else
       console.log('💻✅ new processor configuration set on RVCAT')
    updateProcessorSettings(processorInfo);  // update graph & local variables and view
  }


// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleSet = null
  
  onMounted(() => {
    console.log('💻🎯 ProcessorComponent mounted')
    cleanupHandleSet = registerHandler('set_processor',  handleSetProcessor);
    loadEditedProcessor()
  });

  onUnmounted(() => {
    if (cleanupHandleSet) {
      cleanupHandleSet()
      cleanupHandleSet = null
    }
  });


// ============================================================================
// PROCESSOR ACTIONS: initProcessor, reloadProcessor, editProcessor, removeProcessor, 
//     uploadForEdition, updateProcessorSettings, drawProcessor, get_processor_dot
// ============================================================================
  const initProcessor = async () => {
    await initResource('processor', processorOptions, 'processorName', 'availableProcessors');
  };

  const reloadProcessor = async () => {
    console.log('💻🔄 Reloading processor with:', processorOptions.processorName);
    try {
      jsonString    = localStorage.getItem(`processor.${processorOptions.processorName}`)
      processorInfo = JSON.parse(jsonString)
      setProcessor( jsonString )  // Call Python RVCAT to load new processor config --> 'set-processor'
    } catch (error) {
      console.error('💻❌ Failed to set processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  const emit = defineEmits(['requestSwitchFull']) 
  
  function editProcessor () {
    if (processorInfo) {
      localStorage.setItem('processorTemp', jsonString);
      updateProcessorSettings(processorInfo)
      emit('requestSwitchFull', 'processor')
      console.log('📄 Emit requestSwitchFull for processor edition')
    }
  }

  function removeProcessor () {
    removeFromLocalStorage('processor', processorOptions.processorName, processorOptions.availableProcessors)
    if ( processorOptions.availableProcessors.length > 0)
      processorOptions.processorName = processorOptions.availableProcessors[0]
    else {
      processorOptions.availableProcessors = ''
      alert("Removing all processor configurations forces to load the original processors provided in the distribution")
      initProcessor()
    }
  }

  // UpLOAD from Edition Panel: straightforward version (no modal)
  const uploadForEdition = async () => { 
    try {
      const data = await uploadJSON(null, 'processor');
      if (data) {
        // TODO: Check here if it is a valid processor
        jsonString = JSON.stringify(data)
        localStorage.setItem('processorTemp', jsonString);
        updateProcessorSettings(data)
      }
    } catch (error) {
      console.error('📄❌ Failed to upload processor for edition:', error)
    }
  };

  const drawProcessor = async () => {
    console.log('💻🔄Redrawing processor');
    try {
      const dotCode = get_processor_dot ()
      const svg = await createGraphVizGraph(dotCode);  
      pipelineSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw processor:', error)
      pipelineSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function get_processor_dot() {
    const dispatch_width = procConfig.dispatch
    const retire_width   = procConfig.retire
    const sched          = procConfig.sched
    const ROBsize        = processorOptions.ROBsize
    const num_ports      = Object.keys(procConfig.ports).length
    let dot_code = `
    digraph "Processor Pipeline" {
      rankdir=TB;
      node [fontsize=14, fontname="Arial"];
      Fetch [shape=point width=0 height=0 fixedsize=true label="" margin=0 style=invis ];
    `;

    // --- FETCH  ---
    dot_code += `  Fetch [style=invis, shape=box, height=0, width=0];\n`;
    dot_code += `
      Fetch -> "Waiting Buffer" [
        label="Dispatch = ${dispatch_width}",
        tooltip="Dispath Width: ${dispatch_width} instructions per cycle",
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
      rank=same; Fetch; "Waiting Buffer"; tooltip="Instructions wait for input data and available port"
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
    dot_code += `ROB [label="ROB: ${ROBsize} entries", tooltip="Reorder Buffer: maintains sequential program order", shape=box, height=0.6, width=5, fixedsize=true];\n`;
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

// ============================================================================
// Processor Edition LOGIC: addPort, removePort
//           togglePortInstruction, toggleScheduler, noPortAssigned
// ============================================================================

 function addPort() {
    const existing = portList.value;
    let next = 0;
    for (; existing.includes(next); next++);
    procConfig.ports[next] = [];  
  }

  function removePort(port) {
    const idx = Number(port);
    delete procConfig.ports[idx];
  
    // Si quedan puertos, reindexar
    const ports = Object.entries(procConfig.ports)
      .map(([k, v]) => [Number(k), v])
      .sort((a, b) => a[0] - b[0]);
  
    // Limpiar y reasignar
    Object.keys(procConfig.ports).forEach(k => delete procConfig.ports[k]);
    ports.forEach(([oldIdx, portArr], newIdx) => {
      procConfig.ports[newIdx] = portArr;
    });
  }
  
  function togglePortInstruction(portNum, instruction, isChecked) {
    if (!procConfig.ports[portNum]) procConfig.ports[portNum] = [];
    if (isChecked) {
      if (!procConfig.ports[portNum].includes(instruction))
        procConfig.ports[portNum].push(instruction);
    } else {
      procConfig.ports[portNum] = procConfig.ports[portNum].filter(i => i !== instruction);
    }
  }

  function toggleScheduler() {
    if (procConfig.sched === 'greedy') {
      procConfig.sched = 'optimal'
    } else {
      procConfig.sched = 'greedy'
    }
  }

  function noPortAssigned(instr) {
    if (!portList.value.some(p => procConfig.ports[p]?.includes(instr))) {
      procConfig.ports[0].push(instr)
    }
    return !portList.value.some(p => procConfig.ports[p]?.includes(instr))
  }

// ============================================================================
// confirmDownload, uploadProcessor, clearProcessor
// ============================================================================

  const showModalDownload = ref(false)
  const showModalClear    = ref(false)
  const modalName         = ref("")
  const nameError         = ref("")
  
  async function confirmDownload() {
    const name   = modalName.value.trim();
    const stored = localStorage.getItem('processorTemp');
    if (stored) {
      const data = JSON.parse(stored)
      data.name  = name
      await downloadJSON(data, name, 'processor')
    }
    showModalDownload.value = false;
  }

  const uploadProcessor = async (oldProcessor) => {  
    try {
      const data = await uploadJSON(null, 'processor');
      if (data) {
        if (processorOptions.availableProcessors.includes(data.name)) {
          alert(`A processor with name: "${data.name}" has been already loaded.`)
        }
        else {
          // TODO: Check here if it is a valid processor
          processorInfo = data
          saveToLocalStorage('processor', data.name, data, 
                                          processorOptions.availableProcessors)
          processorOptions.processorName = data.name
          return;
        }
      }
      processorOptions.processorName = oldProcessor;       
    } catch (error) {
      processorOptions.processorName = oldProcessor;
    }
  };
  
  function clearProcessor() {
    updateProcessorSettings( {
      dispatch:   1,
      retire:     1,
      sched:      'optimal',
      latencies:  {},
      ports:      {0:[]},
      nBlocks:    0,
      blkSize:    1,
      mPenalty:   1,
      mIssueTime: 1
    })
    showModalClear.value = false;
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
          <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help">
            <img src="/img/info.png" class="info-img">
          </span>
          <span class="header-title">Processor</span>
        </div>
        <div class="settings-container">
          <select v-model="processorOptions.processorName" class="form-select"
              id="processors-list" title="Select Processor">
            <option value="" disabled>Select</option>
            <option v-for="processor in processorOptions.availableProcessors" :key="processor" :value="processor" >
              {{ processor }}
            </option>
            <option value="_add_new_">Add new</option>
          </select>
          <button class="blue-button small-btn" @click="editProcessor" 
            id="edit-processor-button" 
            title="Edit current processor on full-screen as a new program">
          📝
          </button>
          <button class="blue-button small-btn" @click="removeProcessor"
            id="remove-processor-button"
            title="Remove processor configuration from list (and local storage)">
          🧹
          </button>
          <div class="iters-group rob-group">
            <span class="iters-label" title="Number of ROB entries (1 to 200)">ROB:</span>
            <input type="number" min="1" max="200" id="rob-size" title="Number of ROB entries (1 to 200)" 
                 v-model.number="processorOptions.ROBsize">
          </div>
        </div>
      </div>

      <!--    Processor Graph with visual usage  -->
      <div class="graph-section">
        <div class="pipeline-container">
          <div class="pipeline-img">
            <div v-html="pipelineSvg" v-if="pipelineSvg"></div>
          </div>
        </div>
      </div>

      <div class="scale-container">
        <div class="color-scale"></div>
        <div class="scale-labels">
          <span>underutilized</span>
          <span></span>
          <span>saturated</span>
        </div>
      </div>

    </div>

    <div v-if="isFullscreen" class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Processor Settings - Editor</span>
      </div>
      
      <div class="settings-container fullscreen-settings">
        <div class="buttons">
          <button class="blue-button" 
                  id="processor-download-button"
                  title="Save edited processor configuration" 
                  @click="showModalDownload = true"> 
              Download 
          </button>
           <button class="blue-button" 
                  id="processor-upload-button"
                  title="Load new processor configuration from file system for edition" 
                  @click="uploadForEdition"> 
              Upload 
          </button>
        </div>
        <div class="buttons">
          <button class="blue-button"   @click="showModalClear = true"
                title="Clear edition and start new processor configuration from scratch" 
                id="clear-processor-button">
            Clear
          </button>
        </div>
      </div>
    </div>

    <div v-if="isFullscreen" class="settings-sections">
      <div class="horizontal-layout">
        <div class="settings-group widths-group">
          <div class="section-title-and-info">
            <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show Help">
              <img src="/img/info.png" class="info-img">
            </span>
            <span class="header-title">Stage Width Settings</span>
          </div>
        
          <div class="iters-group">
            <span>Dispatch:</span>
            <input type="number" v-model.number="procConfig.dispatch" min="1" max="9" 
                 id="dispatch-width"
                 title="max. number of instructions dispatched per cycle (1 to 9)"/>
        
            <span>Retire:</span>
            <input type="number" v-model.number="procConfig.retire" min="1" max="9" 
                   id="retire-width"
                   title="max. number of instructions retired per cycle(1 to 9)"/>

            <span>Scheduling Optimal:</span>
            <input type="checkbox" 
                 title="Set if scheduling algorithm is optimal. Otherwise it is greedy"
                 id="schedule-check"
                 :checked="procConfig.sched !== 'greedy'"
                 @change="toggleScheduler" />

          </div>
        </div> 

        <div class="settings-group cache-group">
          <div class="section-title-and-info">
            <span ref="helpIcon3" class="info-icon" @click="openHelp3" title="Show Help">
              <img src="/img/info.png" class="info-img">
            </span>
            <span class="header-title">Cache Memory Settings</span>
          </div>

          <div class="iters-group">
            <span>Number of Blocks:</span>
            <input type="number" v-model.number="procConfig.nBlocks" min="0" max="32" 
                 id="cache-blocks"
                 title="Memory blocks stored into cache (0 => no cache; up to 32)"/>
            
            <span>Block Size:</span>
            <div class="button-group">
              <button @click="procConfig.blkSize = Math.max(1, procConfig.blkSize / 2)">−</button>
              <input type="number" v-model.number="procConfig.blkSize" readonly 
                   id="block-size"
                   title="Size of Memory block: must be a power of two (1 to 128)"
               />
              <button @click="procConfig.blkSize = Math.min(128, procConfig.blkSize * 2)">+</button>
            </div>
            
            <span>Miss Penalty:</span>
            <input type="number" v-model.number="procConfig.mPenalty" min="1" max="99" 
                 id="miss-penalty"
                 title="Extra latency due to cache miss (1 to 99)"/>

            <span>Miss Issue Time:</span>
            <input type="number" v-model.number="procConfig.mIssueTime" min="1" max="99" 
                 id="miss-issue-time"
                 title="Minimum time between Memory accesses (1 to 99)"/>
          </div>
        </div>
      </div>      
      
      <div class="horizontal-layout">
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
              <button v-if="portList.length > 1" class="delete-port"  @click="removePort(port)" 
                      :title="`Remove port P${port} from the Execution Engine`"
                      :id="`remove-port${port}-button`" >
                <img src="/img/delete.png" class="delete-icon" width="16px">
              </button>
            </span>
            <button v-if="portList.length < 10" title="Add new port to the Execution Engine" 
                    id="add-port-button"
                    class="add-port" @click="addPort">
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
                      <input type="number" v-model.number="procConfig.latencies[instr]" class="latency-input" min="1" max="99"
                         :id="`${instr}-latency`"
                         :title="`Execution latency in clock cycles for the ${instr} instruction type (1 to 99)`"/>
                    </div>
                  </td>
                  <td v-for="port in portList" :key="port" class="port-checkbox">
                    <label class="port-label">
                      <input type="checkbox" 
                       :title="`Set if Port P${port} can execute ${instr} instructions`"
                       :id="`Port${port}-${instr}-check`"
                      :checked="(procConfig.ports[port] || []).includes(instr) || (port === portList[0] && noPortAssigned(instr))"
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
        Pin the <strong>Edit Processor</strong> tab to modify the microarchitectural parameters.</p>
        <p>After simulating the execution of a program, the graphical view of the processor provides utilization information:
        hover over the <em>execution ports</em> to inspect their individual <em>utilization</em>. 
        <strong>Red</strong> indicates a potential performance bottleneck in execution.</p>"
    title="Processor MicroArchitecture and Usage"
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
    text="Modify the <strong>Latency</strong> and the maximum <strong>Execution Throughput</strong> of instruction types.
      <p>Each instruction type can be assigned a fixed execution latency and a set of eligible execution ports 
         (only one is used for execution each instruction). A given execution port, named <em>Px</em>, can start executing one instruction every clock cycle.
        If a port is deleted, execution port P0 is automatically assigned to any instruction types left without a valid port.</p>"
    title="Instruction Latency and Throughput Settings"
    @close="closeHelp4"/>

  </Teleport>

  <div v-if="showModalDownload" class="modal-overlay">
    <div class="modal">
      <h4>Save Configuration As</h4>
      <label for="config-name">Name:</label>
      <input v-model="modalName" type="text" id="save-processor-name"
           title="file name of new processor configuration"
        />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Accept Download" @click="confirmDownload"> Yes </button>
        <button class="blue-button" title="Cancel Download"   @click="showModalDownload=false">  Cancel </button>
      </div>
    </div>
  </div>

  <div v-if="showModalClear" class="modal-overlay">
    <div class="modal">
      <p>You may have unsaved changes. Do you want to clear current edited program?</p>
      <div class="modal-actions">
        <button class="blue-button" title="Yes, clear!" @click="clearProcessor">  OK   </button>
        <button class="blue-button" title="No, cancel!" @click="showModalClear = false"> Cancel </button>
      </div>
    </div>
  </div>   
</template>

<style scoped> 
  .horizontal-layout {
    display:     flex;
    gap:         6px; /* Espacio entre tabla e imagen */
    margin-top:  2px;
    align-items: stretch;
    height:      auto;
  }

.iters-group rob-group {
       gap:         0px;
}

  .settings-group {
    display:        flex;
    min-width:      0;
    box-sizing:     border-box;
    flex-direction: column;
    align-items:    center;
    border:         1px solid #ccc;
    border-radius:  8px;
    padding:        0.3rem;
    background:     #fafafa;
  } 
  
  .settings-group.widths-group {
    flex:           1 1 35%;
  }
  .settings-group.latency-group {
    flex:           1 1 45%;
  }
  .settings-group.cache-group {
    flex: 1 1 65%;
  }
  
  /* Para que la tabla no se expanda más allá de lo necesario */
  .settings-group.latency-group .table-container {
    flex: 0 0 auto; /* No crece, se ajusta al contenido */
  }
  
  #processors-list {
    font-size: larger;
  }
  
  .pipeline-container {
    width:     100%;
    height:    100%;
    display:   flex;
    margin-top: 6px;
  }
  .pipeline-side-container {
    flex: 1 1 55%;
    min-width: 0;           /* Importante para evitar desbordamiento */
    box-sizing: border-box; /* Incluye padding y border en el cálculo */
    display:   flex;
    padding:   3px;
    flex-direction: column;
    border:        1px solid #ddd;
    background:    #f8f9fa;
    border-radius: 8px;
  }
  
  .settings-container {
    display: flex;
    align-items: center;
    gap: 3px;
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
  .latency-group {
    flex: 1; /* Ocupa espacio disponible */
  }
  .latency-group .table-container {
    overflow-y: auto; /* Scroll vertical si la tabla es muy larga */
  }
  
.form-select {
  width:            100%;
  padding:          1px 1px;
  margin-bottom:    2px;
  border:           2px solid #ddd;
  border-radius:    6px;
  font-size:        medium;
  background-color: white;
  transition:       border-color 0.3s;
}

.form-select:focus {
  outline:      none;
  border-color: #4a6cf7;
}

.form-select option[value="_add_new_"] {
  color:            #4a6cf7;
  font-weight:      bold;
  background-color: #f0f5ff;
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

  .graph-section {
    display:         flex;
    justify-content: center;
    align-items:     center;
  }
  
  .scale-container {
    width:      30%;
    margin:     0 auto;
    margin-top: 2%;
    text-align: center;
    display:    block;
  }
  .scale-labels {
    width:      100%;
    display:    flex;
    margin-top: 2px;
    font-size:  x-small;
    justify-content: space-between;
  }
  .color-scale {
    width:       100%;
    height:      8px;
    border:      1px solid black;
    position:    relative;
    background:    linear-gradient(to right, white, #6bff6b, #ffc400, #ce0000);
    border-radius: 5px;
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

</style>
