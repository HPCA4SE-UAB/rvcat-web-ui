<script setup>
  import { ref, watch, watchEffect, onMounted, onUnmounted, nextTick, inject, computed, reactive } from 'vue'
  import HelpComponent                                                  from '@/components/helpComponent.vue'
  import { uploadJSON, saveToLocalStorage, removeFromLocalStorage, initResource,
           createGraphVizGraph, typeOperations, get_processor_dot }                           from '@/common'

  const simState = inject('simulationState');

// ============================================================================
// Processor options & localStorage
// ============================================================================

  const STORAGE_KEY = 'processorOptions'

  const defaultOptions = {
    processorName:       '',
    availableProcessors: []
  }

  const processorOptions = reactive(defaultOptions)
  const simulatedSvg     = ref('')

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(processorOptions, JSON.parse(saved))
        console.log('💻load options')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('💻default load options')
      }
    } catch (error) {
      console.error('💻❌ Failed to load:', error)
    }
  }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(processorOptions))
    } catch (error) {
      console.error('💻❌ Failed to save processor options:', error)
    }
  }

  const saveSimState = () => {
    try {
      localStorage.setItem('SimulationState', JSON.stringify(simState))
      console.log('🚀✅ SimulationState saved');
    } catch (error) {
      console.error('🚀❌ Failed to save SimulationState:', error)
    }
  }

  const activeField = ref("rob");
  let cacheConfigOptions = ["cache_nBlk", "cache_BlkSz", "cache_mPenalty", "cache_mIssueTime"]
  let currentCacheOption = 0

  const FIELD_CONFIG = {
    rob: {
      label: "ROB:",
      title: "Number of ROB entries (1 to 200)",
      min: 1,
      max: 200,
      model: "ROBsize"
    },
    dispatch: {
      label: "Dispatch:",
      title: "Dispatch width (1 to 9)",
      min: 1,
      max: 9,
      model: "dispatch"
    },
    cache_nBlk: {
      label: "nBlocks:",
      title: "Number of Cache blocks (0 to 32)",
      min: 0,
      max: 32,
      model: "nBlocks"
    },
    cache_BlkSz: {
      label: "BlkSize:",
      title: "Cache block size (1 to 128 bytes)",
      min: 1,
      max: 128,
      model: "blkSize"
    },
    cache_mPenalty: {
      label: "missPenalty:",
      title: "Cache Miss penalty (cycles added to memory operations when cache miss, 1 to 99)",
      min: 1,
      max: 99,
      model: "mPenalty"
    },
    cache_mIssueTime: {
      label: "mIssueTime:",
      title: "Memory Issue Time (minimum time between memory accesses, 1 to 99)",
      min: 1,
      max: 99,
      model: "mIssueTime"
    },
    retire: {
      label: "Retire:",
      title: "Retire width (1 to 9)",
      min: 1,
      max: 9,
      model: "retire"
    }
  };

  const currentConfig = computed(() => FIELD_CONFIG[activeField.value]);

  const inputValue   = ref('');
  const isInvalid    = ref(false);
  let   errorTimeout = null;

  const validateField = () => {
    const min = currentConfig.value.min;
    const max = currentConfig.value.max;
    let rawValue = inputValue.value;

    if (errorTimeout) clearTimeout(errorTimeout);

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      const lastValidValue = simState.simulatedProcess[currentConfig.value.model];
      inputValue.value = lastValidValue ?? min;
      isInvalid.value = false;
      return;
    }

    let numValue = Number(rawValue);

    if (isNaN(numValue)) {
      const lastValidValue = simState.simulatedProcess[currentConfig.value.model];
      inputValue.value = lastValidValue ?? min;
      isInvalid.value = false;
      return;
    }

    if (numValue < min) {
      numValue = min;
      inputValue.value = numValue;
      showTemporaryError(`El valor mínimo es ${min}`);
    } else if (numValue > max) {
      numValue = max;
      inputValue.value = numValue;
      showTemporaryError(`El valor máximo es ${max}`);
    }

    if (simState.simulatedProcess[currentConfig.value.model] !== numValue) {
      simState.simulatedProcess[currentConfig.value.model] = numValue;
    }
  }

  const showTemporaryError = (message) => {
    isInvalid.value = true;
    errorTimeout = setTimeout(() => {
      isInvalid.value = false;
    }, 2000);
    console.warn(message);
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      event.target.blur();
    }
  };

  const handleInput = (event) => {
    if (isInvalid.value) {
      isInvalid.value = false;
    }
    let value = event.target.value;
    if (value !== '' && !/^\d*$/.test(value)) {
      event.target.value = value.replace(/\D/g, '');
      inputValue.value = event.target.value;
    }
  };

  const labelHighlighted = ref(false);

  const highlightLabel = () => {
    labelHighlighted.value = true;

    setTimeout(() => {
      labelHighlighted.value = false;
    }, 3000); // 3000ms
  };

// ============================================================================
// WATCHES: processor, globalState
// ============================================================================
  const ADD_NEW_OPTION = '_add_new_'

  watch( () => processorOptions.processorName, (newName, oldName) => {
    try {
      if (newName === ADD_NEW_OPTION)
        return uploadProcessor(oldName)

      saveOptions()

      if (simState.state > 1) {  // Processor already initialized
         if (newName !== simState.processorName) {
           console.log(`💻✅ Processor changed from "${oldName}" to "${newName}"`);
           reloadProcessor()
         }
      }
    } catch (error) {
      console.error('💻❌ Failed when changing processor name:', error)
    }
  })

  watch( () => ({ state: simState.state,
      processorName:     simState.processorName,
      simulatedProcess:  simState.simulatedProcess
    }),
    saveSimState,
    { deep: true }
  )

  watch( () => simState.state, (newValue, oldValue) => {
      if (newValue === 1 && oldValue !== 1) {
        console.log('💻✅ Initialization Step (1): RVCAT imported')
        initProcessor()
      }
    }
  )

  watch( () => simState.highlightedPort, (newValue, oldValue) => {
      if (newValue !== oldValue)
        drawProcessor()
    }
  )

  watchEffect(() => { // Dependences: re-evaluated when they change
    const svg = simulatedSvg.value;
    if (svg) { // available SVG
      nextTick(() => {
        addClickListenersToSvg()
      })
    }
  })

  watch(() => currentConfig.value?.label, (newLabel, oldLabel) => {
    if (newLabel && newLabel !== oldLabel) {
      highlightLabel()
    }
  })

  watch(() => simState.simulatedProcess, () => {
    if (simState.state > 1) {
      drawProcessor()
    }
  },
  { deep: true, immediate: true })

  watch(() => simState.simulatedProcess[currentConfig.value.model],
    (newVal) => {
      if (String(inputValue.value) !== String(newVal)) {
        inputValue.value = newVal ?? '';
        isInvalid.value = false;
      }
    },
    { immediate: true }
  )

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  onMounted(() => {
    loadOptions()
    if (currentConfig.value?.label) highlightLabel()
    console.log('💻🎯 Processor Component mounted')
  });

  onUnmounted(() => {
    console.log('💻👋 Processor Component unmounted')
    localStorage.removeItem('processorTemp')
    removeClickListeners()
  });

// ============================================================================
// PROCESSOR ACTIONS: initProcessor, reloadProcessor, editProcessor, removeProcessor,
//     drawProcessor, get_processor_dot
// ============================================================================

  const initProcessor = async () => {
    await initResource('processor', processorOptions, 'processorName', 'availableProcessors');
    reloadProcessor()
  };

  const reloadProcessor = async () => {
    console.log('💻🔄 Reloading processor with:', processorOptions.processorName);
    try {
      const jsonString = localStorage.getItem(`processor.${processorOptions.processorName}`)
      const data       = JSON.parse(jsonString)

      if (simState.state == 1) {  // This is an initialization step
        simState.state = 2;       // Change to next initialization step
        console.log('💻✅ Initialization step (2): processor configuration loaded')
      }
      data.name = simState.simulatedProcess.name || 'unknown'
      Object.assign(simState.simulatedProcess, data)
      simState.processorName= processorOptions.processorName
      drawProcessor()
    } catch (error) {
      console.error('💻❌ Failed to set processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  const emit = defineEmits(['requestSwitchFull'])

  function editProcessor () {
    if (simState.simulatedProcess) {
      const cleanProcConfig = {
        name:       'edit',
        sched:      simState.simulatedProcess.sched      || 'optimal',
        dispatch:   simState.simulatedProcess.dispatch   || 1,
        retire:     simState.simulatedProcess.retire     || 1,
        ROBsize:    simState.simulatedProcess.ROBsize    || 20,
        nBlocks:    simState.simulatedProcess.nBlocks    || 0,
        blkSize:    simState.simulatedProcess.blkSize    || 1,
        mPenalty:   simState.simulatedProcess.mPenalty   || 1,
        mIssueTime: simState.simulatedProcess.mIssueTime || 1,
        latencies:  JSON.parse(JSON.stringify(simState.simulatedProcess.latencies)),
        ports:      JSON.parse(JSON.stringify(simState.simulatedProcess.ports))
      }
      localStorage.setItem('processorTemp', JSON.stringify(cleanProcConfig));
      console.log('💻📄 Emit requestSwitchFull for processor edition')
      emit('requestSwitchFull', 'processor')
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

  const drawProcessor = async () => {
    try {
      const dotCode      = get_processor_dot (simState.simulatedProcess, simState.highlightedPort)
      const svg          = await createGraphVizGraph(dotCode);
      // console.log('💻🔄Redrawing SVG', svg);
      simulatedSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  let clickListeners = [];     // To clean listeners

  const addClickListenersToSvg = () => {
    nextTick(() => {
      const svgElement = document.querySelector('.simProcessor-img svg');
      if (!svgElement) return;

      removeClickListeners()
      console.log('💻Add click listeners to processor table');

      svgElement.querySelectorAll('g').forEach(g => {
        if (typeof g.id === 'string' && g.id.startsWith("a_")) {
          const clickHandler = (e) => {
            e.preventDefault()

            const action = g.id.slice(2)
            console.log("Action:", action)

            switch (action) {
              case 'dispatch':
              case 'rob':
              case 'retire':
                activeField.value = action
                break

              case 'sched':
                if (simState.simulatedProcess.sched === 'greedy') {
                  simState.simulatedProcess.sched = 'optimal'
                } else {
                  simState.simulatedProcess.sched = 'greedy'
                }
                break

              case 'port':
                const port = g.id.slice(2)
                console.log('Port clicked:', port)
                break

              case 'cache':
                currentCacheOption = (currentCacheOption + 1) % cacheConfigOptions.length;
                activeField.value  = cacheConfigOptions[currentCacheOption];
                break

              case 'op':
                // const [_, __, p, row, label] = parts
                // console.log('Op:', p, row, label)
                break
            }
          }
          // Guardar referencia para poder removerlo después
          clickListeners.push({
            node:    g,
            handler: clickHandler
          })

          g.addEventListener('click', clickHandler)
        }
      })
    })
  }

  const removeClickListeners = () => {
    clickListeners.forEach(({ node, handler }) => {
      node.removeEventListener('click', handler);
    })
    clickListeners = []
  }

// ============================================================================
// uploadProcessor
// ============================================================================

  const uploadProcessor = async (oldProcessor) => {
    try {
      const data = await uploadJSON(null, 'processor')
      if (data) {
        const exists = processorOptions.availableProcessors.includes(data.name)
        if (exists && !confirm(`A processor with the name "${data.name}" is already loaded. Do you want to overwrite it?`)) {
          alert('Upload cancelled.')
          processorOptions.processorName = oldProcessor
          return
        }
        saveToLocalStorage('processor', data.name, data, processorOptions.availableProcessors)
        simState.processorName = data.name
        processorOptions.processorName = data.name
        data.name = simState.simulatedProcess.name || 'unknown'
        Object.assign(simState.simulatedProcess, data)
        return
      }
    } catch (error) {
      console.error('💻❌ Failed to upload processor:', error)
    }
    processorOptions.processorName = oldProcessor
  }

/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp  = ref(false); const helpIcon  = ref(null);
  const helpPosition = ref({ top: '0%', left: '40%' });

  function openHelp()   { nextTick(() => { showHelp.value = true }) }
  function closeHelp()  { showHelp.value  = false }

/* ------------------------------------------------------------------
 * Button Support: press & hold
 * ------------------------------------------------------------------ */
  let holdTimeout = null;
  let holdInterval= null;

  function startHold(action) {
    const INITIAL_DELAY   = 400;   // tiempo hasta que empieza la repetición
    const REPEAT_INTERVAL = 100;   // velocidad de repetición

    action()    // first click

    // wait until repetition
    holdTimeout = setTimeout(() => {
      holdInterval = setInterval(() => {
        action();
      }, REPEAT_INTERVAL);
    }, INITIAL_DELAY);
  }

  function stopHold() {
    clearTimeout(holdTimeout);
    clearInterval(holdInterval);
  }

  function increaseParameter() {
    const max    = currentConfig.value.max
    let newValue = simState.simulatedProcess[currentConfig.value.model]
    simState.simulatedProcess[currentConfig.value.model] = Math.min(newValue+1, max)
  }

  function decreaseParameter() {
    const min    = currentConfig.value.min
    let newValue = simState.simulatedProcess[currentConfig.value.model]
    simState.simulatedProcess[currentConfig.value.model] = Math.max(newValue-1, min)
  }

</script>

<template>
  <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Processor</span>
      </div>
      <div class="settings-container">
        <select v-model="processorOptions.processorName" class="form-select"
            id="processors-list" title="Select Processor Configuration">
          <option value="" disabled>Select</option>
          <option v-for="processor in processorOptions.availableProcessors" :key="processor" :value="processor" >
            {{ processor }}
          </option>
          <option value="_add_new_">Add new</option>
        </select>
        <button class="blue-button small-btn" @click="editProcessor"
          id="edit-processor-button"
          title="Edit current processor on full-screen">
        📝
        </button>
        <button class="blue-button small-btn" @click="removeProcessor"
          id="remove-processor-button"
          title="Remove processor configuration from list (and local storage)">
        🧹
        </button>
        <div class="iters-group rob-group">
          <span class="iters-label"
            :class="{ 'highlight': labelHighlighted }"
            :title="currentConfig.title">
            {{ currentConfig.label }}
          </span>
          <input
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            :placeholder="currentConfig.min.toString()"
            v-model="inputValue"
            @blur="validateField"
            @keypress="handleKeyPress"
            @input="handleInput"
            :class="{ 'invalid': isInvalid }"
            :title="`Rang: ${currentConfig.min} - ${currentConfig.max}`"
          />
        </div>
        <button
          class="blue-button small-btn"
          @mousedown="startHold(increaseParameter)"
          @mouseup="stopHold"
          @mouseleave="stopHold"
          @touchstart.prevent="startHold(increaseParameter)"
          @touchend="stopHold"
          title="Increase parameter (press and hold for faster incrementing)"
        >
          ▲
        </button>
        <button
          class="blue-button small-btn"
          @mousedown="startHold(decreaseParameter)"
          @mouseup="stopHold"
          @mouseleave="stopHold"
          @touchstart.prevent="startHold(decreaseParameter)"
          @touchend="stopHold"
          title="Decrease parameter (press and hold for faster decrementing)"
        >
          ▼
        </button>
      </div>
  </div>

  <div class="graph-section">
    <div class="processor-container">
      <div class="simProcessor-img" v-html="simulatedSvg" v-if="simulatedSvg"></div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    text="The table describes the <strong>processor microarchitecture</strong> (pipeline) characteristics.
        <p>Click on the corresponding table cells to modify the <strong>Dispatch</strong> and/or <strong>Retire</strong> widths
          (maximum number of instructions dispatched into or retired from the <strong>Execution Engine</strong> per clock cycle),
          or the <strong>ROB</strong> (ReOrder Buffer) size (maximum number of instructions on the <strong>Execution Engine</strong>).
          All of them may impose a <strong><em>throughput-bound</em></strong> performance limit.</p>
        <p>Click on the <strong>Cache</strong> row to modify the cache configuration (number of blocks, block size, miss penalty and issue time).
           Setting a Number of Blocks = 0 means all data accesses will always hit in the cache, and, therefore, the latency of memory loads and stores will always be the same.
           The cache miss latency indicates the extra time required to execute load and store instructions when they miss in the cache.
           The cache miss issue time (<strong>m</strong>) is the minimum time required to issue consecutive memory block read/write requests to the Main Memory.
           It determines the maximum Main Memory bandwidth (one memory block every <strong>m</strong> clock cycles).</p>
        <p>Click on the <strong>Waiting Buffer</strong> row to toggle between a <em>greedy</em> instructionscheduler
          (which issues older ready instructions as soon as possible) and an <em>optimal</em> scheduler
          (which always issues the best combination of ready instructions to maximize performance).</p>
        <p>Each instruction type is assigned a fixed execution latency and a set of eligible execution ports
         (only one is used for execution each instruction). A given execution port, named <em>Px</em>, can start executing one instruction every clock cycle.
         Hover the different <strong>Execution Ports</strong> to see the assigned instruction types and their latencies.</p>
        <p>A new <em>processor configuration</em> can be selected from the list (referring to a JSON file description stored in local storage).
         Click on the <strong>edit</strong> button to modify a processor configuration or
         to <strong>remove</strong> a file from local storage.</p>
        "
    title="Processor MicroArchitecture Description"
    @close="closeHelp" />
  </Teleport>

</template>

<style scoped>
  .iters-group rob-group {
    gap:         0px;
  }

  .iters-group input {
    width:         30px;
    padding:       2px 4px;
    border:        1px solid #ccc;
    border-radius: 4px;
    transition:    all 0.2s ease;
  }

  .iters-group input:focus {
    outline: none;
    border-color: #4a90e2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
  }

  .iters-group input.invalid {
    border-color:     #ff4444;
    background-color: #fff0f0;
    animation:        shake 0.3s ease-in-out;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-5px); }
    75%      { transform: translateX(5px); }
  }

  .processor-container {
    width:     100%;
    height:    100%;
    display:   flex;
    margin-top: 2px;
  }

  .settings-container {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1;
    justify-content: center;
  }
  .settings-container select,
  .settings-container button {
    flex-shrink: initial;
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

  .graph-section {
    display:         flex;
    justify-content: center;
    align-items:     center;
  }

  .simProcessor-img {
    width:        100%;
    height:       100%;
    max-width:    150%;
    max-height:   150%;
    align-items:  center;
    object-fit:   contain;
    transform-box: fill-box;
  }
  .simProcessor-img svg text {
    font-size:   12px;
    font-family: Arial, sans-serif;
  }
  .simProcessor-img svg polygon,
  .simProcessor-img svg path {
    stroke-width: 2px;
  }
  .simProcessor-img svg[viewBox] {
    width:    100%;
    height:   100%;
    overflow: hidden;
  }
  .simProcessor-img g.node.selected polygon {
    stroke-width: 3px !important;
    stroke:       #0066ff !important;
    filter:       drop-shadow(0 0 5px rgba(0, 100, 255, 0.5));
  }
  .simProcessor-img g.node:hover polygon {
    stroke-width: 2px !important;
    stroke:       #444444 !important;
    cursor:       pointer;
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

</style>
