<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, computed, reactive, watch } from 'vue'
  import HelpComponent                                            from '@/components/helpComponent.vue'

  import { downloadJSON, uploadJSON, saveToLocalStorage, removeFromLocalStorage,
          initResource, createGraphVizGraph,
          instructionTypes, typeOperations, typeSizes                                 } from '@/common'

  const simState = inject('simulationState');

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
    processorName:       '',
    ROBsize:             20,
    availableProcessors: [],
    expandedTypes:       Object.fromEntries( instructionTypes.map(type => [ type, false]))
  }

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
  const simulatedSvg     = ref('')

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(processorOptions))
    } catch (error) {
      console.error('💻❌ Failed to save processor options:', error)
    }
  }


// ============================================================================
// Temporal in-edition processor:  updateProcessorSettings, loadEditedProcessor
// ============================================================================

  function createDefaultConfig() {
    return {
      name:       'default',
      sched:      'optimal',
      dispatch:   1,
      retire:     1,
      nBlocks:    0,
      blkSize:    1,
      mPenalty:   1,
      mIssueTime: 1,
      latencies:  Object.fromEntries(
                    instructionTypes.map(type => [
                      type,
                      {
                        default: 1,
                        ...Object.fromEntries(
                          typeOperations[type].map(op => [op, 1])
                        )
                      }
                   ])
                  ),
      ports:      { 0:
                    instructionTypes.map(type => [type])
                  },
    };
  }

  const procConfig = reactive(createDefaultConfig());
  const editedSvg  = ref('')

  const portList = computed(() =>
    Object.keys(procConfig.ports)
      .map(k => Number(k))
      .sort((a, b) => a - b)
  );

  const updateProcessorSettings = async (procInfo) => {
    try {
      Object.assign(procConfig, JSON.parse(JSON.stringify(procInfo)))   // deep copy & fire draw-update
      if (!procConfig.ports || typeof procConfig.ports !== 'object') {
        procConfig= createDefaultConfig()
        console.warn('💻⚠️ Invalid processor configuration: missing or malformed "ports" property. Resetting to default configuration.')
      }
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
  watch( [ () => processorOptions.processorName ], (newName, oldName) => {
    try {
      if (newName === ADD_NEW_OPTION)
        return uploadProcessor(oldName)

      saveOptions()

      if (simState.state > 0) {  // RVCAT already imported
         if (newName !== simState.selectedProcessor) {
           console.log(`💻✅ Processor changed from "${oldName}" to "${newName}"`);
           reloadProcessor()
         }
      }
    } catch (error) {
      console.error('💻❌ Failed when changing processor name:', error)
    }
  },
  { deep: true, immediate: true })


// Watch ALL processor options for changes
  watch( [() => processorOptions.ROBsize ], (newROBsize, oldROBsize) => {
    try {
      if (newROBsize !== oldROBsize) {
        newROBsize = Math.max(Math.min(newROBsize, 200), 1);
        if (newROBsize === oldROBsize)
          return
      }

      saveOptions()
      processorOptions.ROBsize = newROBsize
      if (simState.state < 2)  // processor still not loaded
        return
      console.log(`💻✅ ROB size changed to "${newROBsize}"`);
      drawProcessor()
      simState.ROBsize = newROBsize // fires other components
    } catch (error) {
      console.error('💻❌ Failed to handle changes on processor:', error)
    }
  },
  { deep: true, immediate: true })


// Watch ALL processor options for changes
  watch( [ () => processorOptions.availableProcessors, () => processorOptions.expandedType], () => {
    try {
      saveOptions()
    } catch (error) {
      console.error('💻❌ Failed to handle changes on processor:', error)
    }
  },
  { deep: true, immediate: true })


  // Watch ALL processor configuration values for changes
  watch(procConfig, () => {
    try {
      localStorage.setItem('processorTemp', JSON.stringify(procConfig));
      if (simState.state < 2)  // processor still not loaded
        return
      drawEditedProcessor()
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


// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================

  onMounted(() => {
    console.log('💻🎯 ProcessorComponent mounted')
    loadEditedProcessor()
  });

  onUnmounted(() => {
    console.log('💻👋 ProcessorComponent unmounted')
    localStorage.removeItem('processorTemp')
  });


// ============================================================================
// PROCESSOR ACTIONS: initProcessor, reloadProcessor, editProcessor, removeProcessor,
//     uploadForEdition, drawProcessor, drawEditedProcessor, get_processor_dot
// ============================================================================
  const initProcessor = async () => {
    await initResource('processor', processorOptions, 'processorName', 'availableProcessors');
    reloadProcessor()
  };

  const reloadProcessor = async () => {
    console.log('💻🔄 Reloading processor with:', processorOptions.processorName);
    try {
      const jsonString  = localStorage.getItem(`processor.${processorOptions.processorName}`)
      simState.simulatedProcessor = JSON.parse(jsonString)
      simState.selectedProcessor  = processorOptions.processorName;  // fire other components
      if (simState.state == 1) {  // This is an initialization step
        simState.state = 2;       // Change to next initialization step
        console.log('💻✅ Initialization step (2): processor configuration loaded')
      }
      drawProcessor()
    } catch (error) {
      console.error('💻❌ Failed to set processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  const emit = defineEmits(['requestSwitchFull'])

  function editProcessor () {
    if (simState.simulatedProcessor) {
      emit('requestSwitchFull', 'processor')
      updateProcessorSettings(simState.simulatedProcessor)
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
        updateProcessorSettings(data)
      }
    } catch (error) {
      console.error('📄❌ Failed to upload processor for edition:', error)
    }
  };

  const drawProcessor = async () => {
    console.log('💻🔄Redrawing simulated processor');
    try {
      const dotCode      = get_processor_dot (simState.simulatedProcessor)
      const svg          = await createGraphVizGraph(dotCode);
      simulatedSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  const drawEditedProcessor = async () => {
    console.log('💻🔄Redrawing edited processor');
    try {
      const dotCode   = get_processor_dot (procConfig)
      const svg       = await createGraphVizGraph(dotCode);
      editedSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw edited processor:', error)
      editedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function get_processor_dot(data) {
    const dispatch_width = data.dispatch
    const retire_width   = data.retire
    const sched          = data.sched
    const ROBsize        = processorOptions.ROBsize
    const num_ports      = Object.keys(data.ports).length
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
        fontsize=12, fontname="Arial"
      ];
    `;

    for (let i = dispatch_width - 1; i > 0; i--) {
      dot_code += 'Fetch -> "Waiting Buffer"; ';
    }

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

    for (let i = dispatch_width - 1; i >= 0; i--) {
      dot_code += 'Fetch -> ROB;\n';
    }

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

    for (let i = retire_width - 1; i > 0; i--) {
      dot_code += 'ROB -> Registers; ';
    }

    dot_code += `}\n`;
    return dot_code;
  }

// ============================================================================
// Processor Edition LOGIC:      addPort, removePort, toggleTypeExpand,
//      togglePortType, togglePortOperation, toggleScheduler, noPortAssigned
// ============================================================================

  function toggleTypeExpand(type) {
    processorOptions.expandedTypes[type] = ! processorOptions.expandedTypes[type];
  }

  function typeOpKey(type, op) {
    return `${type}.${op}`;
  }

  function opsOfTypeAssigned(port, type) {
    const ops      = typeOperations[type];
    const assigned = procConfig.ports[port] || [];
    return ops.filter(op => assigned.includes(typeOpKey(type, op)));
  }

  function isTypeChecked(port, type) {
    return opsOfTypeAssigned(port, type).length === typeOperations[type].length;
  }

  function isTypeIndeterminate(port, type) {
    const n = opsOfTypeAssigned(port, type).length;
    return n > 0 && n < typeOperations[type].length;
  }

  function toggleTypeForPort(port, type, checked) {
    if (!procConfig.ports[port])
      procConfig.ports[port] = [];

    const ops      = typeOperations[type];
    const assigned = procConfig.ports[port];

    if (checked) {
      // marcar TODAS las operaciones
      ops.forEach(op => {
        const k = typeOpKey(type, op);
        if (!assigned.includes(k)) assigned.push(k);
      });
    } else {
      // desmarcar TODAS
      procConfig.ports[port] = assigned.filter(x => !x.startsWith(type + '.'));
    }
  }


  function togglePortOperation(portNum, type, oper, isChecked) {
    if (!procConfig.ports[portNum])
      procConfig.ports[portNum] = [];

   const typeOper = type + "." + oper;
    if (isChecked) {
      if (!procConfig.ports[portNum].includes(typeOper))
        procConfig.ports[portNum].push(typeOper);
    } else {
      procConfig.ports[portNum] = procConfig.ports[portNum].filter(i => i !== typeOper);
    }
  }

  function toggleScheduler() {
    if (procConfig.sched === 'greedy') {
      procConfig.sched = 'optimal'
    } else {
      procConfig.sched = 'greedy'
    }
  }

  function noPortAssigned(type) {
    if (!portList.value.some(p => procConfig.ports[p]?.includes(type))) {
      procConfig.ports[0].push(type)
    }
    return !portList.value.some(p => procConfig.ports[p]?.includes(type))
  }

  function addPort() {
    const existing = portList.value;
    let   next     = 0;
    for (; existing.includes(next); next++);
    procConfig.ports[next] = [];
  }

  function removePort(port) {
    const  idx = Number(port);
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
          simState.simulatedProcessor = data
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
    updateProcessorSettings(createDefaultConfig())
    showModalClear.value = false;
  }

/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp  = ref(false); const helpIcon  = ref(null);
  const showHelp1 = ref(false); const showHelp2 = ref(false); const showHelp3 = ref(false); const showHelp4 = ref(false);
  const helpIcon1 = ref(null);  const helpIcon2 = ref(null);  const helpIcon3 = ref(null);  const helpIcon4 = ref(null);
  const helpPosition = ref({ top: '0%', left: '40%' });

  function openHelp()   { nextTick(() => { showHelp.value = true }) }
  function closeHelp()  { showHelp.value  = false }
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
        <div class="processor-container">
          <div class="processor-img">
            <div v-html="simulatedSvg" v-if="simulatedSvg"></div>
          </div>
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
                 title="max. number of instructions dispatched per cycle (1 to 9)"
             />

            <span>Retire:</span>
            <input type="number" v-model.number="procConfig.retire" min="1" max="9"
                   id="retire-width"
                   title="max. number of instructions retired per cycle(1 to 9)"
             />

            <span>Schedule Opt.:</span>
            <input type="checkbox"
                 title="Set checkbox if scheduling algorithm is optimal. Otherwise it is greedy"
                 id="schedule-check"
                 :checked="procConfig.sched !== 'greedy'"
                 @change="toggleScheduler"
             />

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

          <div class="table-container">
            <table class="instr-table">
              <thead>
                <tr class="type-row">
                  <th>Type</th><th>Operation</th><th>Size</th><th>Latency</th>
                  <th v-for="port in portList" :key="port">P{{ port }}</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="type in instructionTypes" :key="type">
                  <tr class="type-row">
                    <td>
                      <button class="dropdown-type"
                        @click="toggleTypeExpand(type)"
                        title="Show Operations of this type"
                        id="show-critical-button">
                        <span class="arrow" aria-hidden="true">
                          {{ processorOptions.expandedTypes[type] ? '▼' : '▶' }} {{ type }}
                        </span>
                      </button>
                    </td>
                    <td>-</td>
                    <td>-</td>
                    <td>
                      <input type="number"
                          v-model.number="procConfig.latencies[type].default"
                          class="latency-input"
                          min="1" max="99"
                          :id="`${type}-latency`"
                          :title="`Execution latency in clock cycles for the ${type} instruction type (1 to 99)`" />
                    </td>
                    <td v-for="port in portList" :key="port" class="port-checkbox">
                      <label class="port-label">

                        <input
                          type="checkbox"
                          :checked="isTypeChecked(port, type) || (port === portList[0] && noPortAssigned(type))"
                          :ref="el => el && (el.indeterminate = isTypeIndeterminate(port, type))"
                          @change="toggleTypeForPort(port, type, $event.target.checked)"
                          :id="`Port${port}-${type}-check`"
                          :title="`Set if Port P${port} can execute ${type} instructions`"
                        />
                      </label>
                    </td>
                  </tr>

                  <tr
                    v-if="processorOptions.expandedTypes[type] && !isTypeChecked(port, type)"
                    v-for="op in typeOperations[type]"
                    :key="`${type}-${op}`"
                    class="op-row">

                    <td></td>
                    <td class="op-cell">
                      {{ op }}
                    </td>
                    <td> - </td>

                    <td>
                      <input type="number"
                        v-model.number="procConfig.latencies[type][op]"
                        min="1" max="99"
                        class="latency-input" />
                    </td>

                    <td v-for="port in portList" :key="port" class="port-checkbox">
                      <label class="port-label">
                        <input type="checkbox"
                          :title="`Set if Port P${port} can execute ${type}.${op} instructions`"
                          :id="`Port${port}-${type}-${op}-check`"
                          :checked="(procConfig.ports[port] || []).includes(`${type}.${op}`)"
                          @change="togglePortOperation(port, type, op, $event.target.checked)"
                          />
                      </label>
                    </td>


                  </tr>
                </template>
              </tbody>
            </table>
          </div> <!--- Table Container -->
        </div> <!--- Latency & Port Settings Group -->

        <div class="processor-side-container">
          <div class="processor-img">
            <div v-html="editedSvg" v-if="editedSvg"></div>
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
    gap:         6px;
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

  .settings-group.latency-group .table-container {
    flex: 0 0 auto;
  }

  .processor-container {
    width:     100%;
    height:    100%;
    display:   flex;
    margin-top: 2px;
  }

  .processor-side-container {
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


  .latency-input {
    width:     40px !important; /* Más estrecho */
    max-width: 70px;
    padding:   3px !important;
    margin:    0 auto !important;
  }

  .port-checkbox {
    text-align: center;
  }

  .port-label {
      display: block;
      margin:  0;
      padding: 0;
  }

  port-label input[type="checkbox"] {
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

  .processor-img {
    width:        100%;
    height:       100%;
    max-width:    150%;
    max-height:   150%;
    align-items:  center;
    object-fit:   contain;
    transform-box: fill-box;
  }

  .processor-img svg text {
    font-size:   12px !important;
    font-family: Arial, sans-serif !important;
  }

  .processor-img svg polygon,
  .processor-img svg path {
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
    margin-top:      1px;
    border-collapse: collapse;
    border: 3px solid green;
  }

  .instr-table th,
  .instr-table td {
    padding:    1px;
    text-align: center;
    border:     1px solid #d86868;
  }

  .instr-table th {
    background-color: #f5f5f5;
    position: sticky;
    top:      0;
  }

    /* Ajusta el ancho específico de las columnas */
  .instr-table th:first-child,  /* Columna TYPE */
  .instr-table td:first-child {
    min-width:    60px;
    max-width:   100px;
    text-align:  center;
    font-size:   medium;
    padding:     0px;
  }

  .instr-table th:nth-child(2),  /* Columna Operation */
  .instr-table td:nth-child(2) {
    min-width: 90px;
    max-width: 100px;
    width:     auto;
    padding:   0px;
    font-size: medium;
  }

  .instr-table th:nth-child(3),  /* Columna Size */
  .instr-table td:nth-child(3) {
    width: auto;
    min-width:  50px;
    max-width:  60px;
    padding:    0px;
  }

  .instr-table th:nth-child(4),  /* Columna LATENCY */
  .instr-table td:nth-child(4) {
    min-width: 68px;
    max-width: 100px;
    width:     auto;
    padding:   0px;
  }

  /* Columnas de puertos - muy estrechas */
  .instr-table th:nth-child(n+5),  /* Todas las columnas de puertos */
  .instr-table td:nth-child(n+5) {
    width:     auto;
    min-width: 24px;
    max-width: 60px;
    padding:   0px;
  }

  /* Chrome, Safari, Edge, Opera */
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button {
    -webkit-appearance: auto;
    width:      6ch;
    padding:    1px;
    margin:     0 0px;
    text-align: right;
  }

  /* Firefox */
  input[type=number] {
    appearance: auto;
    -moz-appearance: number-input;
    width:      6ch;
    padding:    1px;
    margin:     0 0px;
    text-align: right;
  }

  .ports-toolbar {
    margin: 2px 0;
  }
  .port-tag {
    display:       inline-flex;
    background:    #e3e3e3;
    border-radius: 4px;
    padding:       1px;
    margin-right:  1px;
    margin-bottom: 1px;
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
    padding:       2px 42px;
    border-radius: 4px;
    cursor:        pointer;
    font-size:     0.9em;
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

  .type-row {
    background:     #e6f2ff;
    font-weight:    bold;
    cursor:         pointer;
  }

  .op-row {
    background: #f9fbff;
  }

  .op-cell {
    padding-left:   2px;
    font-size:      smaller;
    font-style:     italic;
  }

  .type-cell {
    user-select:  none;
  }

  .dropdown-type {
    all:         unset;  /* button reset */
    width:       auto;
    cursor:      pointer;
    padding:     6px 0px;
    display:     inline-flex;
    align-items: center;
    font-size:   medium
  }
  .dropdown-type:hover {
    background: #eaeaea;
  }


</style>
