<script setup>
  import { t, locale } from '@/i18n'
  import { ref, watch, watchEffect, onMounted, onUnmounted, nextTick, inject, computed, reactive } from 'vue'
  import HelpComponent                                                  from '@/components/helpComponent.vue'
  import { uploadJSON, downloadJSON, saveToLocalStorage, removeFromLocalStorage, initResource,
           createGraphVizGraph, get_processor_dot, CACHE_BLOCK_SIZES,
           getAllowedCacheBlockSizes, getLargestMemoryAccessSize, typeOperations, typeSizes,
           allOperationNames, removePortFrom, MAX_PORTS }                                 from '@/common'
  import { processorDraftFrom, processorSignature }                                     from '@/editDrafts'
  import { isLocked }                                                                   from '@/lessons'

  const simState = inject('simulationState');

  // ---- Lessons: only the processors of the lesson, and its locks ----
  const visibleProcessors = computed(() => simState.lesson ? simState.lesson.processors : processorOptions.availableProcessors)
  const locked = (what) => isLocked(simState.lesson, what, simState.lessonAllow ?? [])
  // field of the processor edited by each cell of the diagram
  const CELL_FIELD = { dispatch: 'dispatch', retire: 'retire', rob: 'rob', cache: 'cache', bpenalty: 'bPenalty', addport: 'ports' }
  const editLocked = computed(() => ['dispatch', 'retire', 'rob', 'cache', 'bPenalty', 'ports', 'latencies']
    .every(f => locked(`processor.${f}`)))

// ============================================================================
// Processor options & localStorage
// ============================================================================

  const STORAGE_KEY = 'processorOptions'

  const defaultOptions = {
    processorName:       '',
    availableProcessors: [],
    opsCollapsed:        true      // operation types of the ports hidden in the diagram (when a processor is loaded)
  }

  const processorOptions = reactive(defaultOptions)
  const simulatedSvg     = ref('')
  let initializingProcessor = false

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
  let cacheConfigOptions = [
    "cache_nBlk",
    "cache_BlkSz",
    "cache_mPenalty",
    "cache_mIssueTime",
    "cache_nFillBuffers",
    "cache_nWriteBuffers",
    "cache_rThru"
  ]
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
      title: "Cache block size (8, 16, 32, 64, or 128 bytes)",
      min: 8,
      max: 128,
      model: "blkSize"
    },
    cache_mPenalty: {
      label: "Penalty:",
      title: "Cache miss penalty (must be at least mIssueTime)",
      min: 1,
      max: 99,
      model: "mPenalty"
    },
    cache_mIssueTime: {
      label: "IssueTime:",
      title: "Memory Issue Time (minimum time between memory accesses, 1 to 99)",
      min: 1,
      max: 99,
      model: "mIssueTime"
    },
    cache_nFillBuffers: {
      label: "FillBuff:",
      title: "Number of fill buffers (1 to 32)",
      min: 1,
      max: 32,
      model: "nFillBuffers"
    },
    cache_nWriteBuffers: {
      label: "WrtBuff:",
      title: "Number of write buffers (1 to 32)",
      min: 1,
      max: 32,
      model: "nWriteBuffers"
    },
    cache_rThru: {
      label: "RetThru:",
      title: "Cache return throughput (1 to 32 instructions per cycle)",
      min: 1,
      max: 32,
      model: "rThru"
    },
    bpenalty: {
      label: "BrPenalty:",
      title: "Branch penalty: cycles to refill the front-end after a mispredicted conditional branch resolves (0 to 99)",
      min: 0,
      max: 99,
      model: "bPenalty"
    },
    retire: {
      label: "Retire:",
      title: "Retire width (1 to 9)",
      min: 1,
      max: 9,
      model: "retire"
    }
  };

  // Selected operation type (cell of a port) or port of the diagram
  const selectedOp   = ref(null)    // { port, label }
  const selectedPort = ref(null)    // port id (string)

  // operations represented by a cell label: "FLOAT.ADD", or a whole type ("INT": all its operations)
  const opsOfLabel = (label, list) => list.filter(op => op === label || op.startsWith(`${label}.`))
  const latencyKeys = (label) => (label.includes('.') ? [label]
    : [label, ...(typeOperations[label] ?? []).map(op => `${label}.${op}`)])

  // data sizes with their own latency ("FLOAT.ADD.double"); only for one operation, not a whole type
  const sizesOf = (label) => (label?.includes('.') ? typeSizes[label.split('.')[0]] ?? [] : [])
  const selectedSize = ref('')      // '' = every size

  function latencyOf(label, size = '') {
    const lat = simState.simulatedProcess.latencies ?? {}
    if (size && lat[`${label}.${size}`] !== undefined) return lat[`${label}.${size}`]
    return lat[label] ?? lat[label.split('.')[0]] ?? 1
  }
  // without a size, the latency applies to every operation and size of the label
  function setLatency(label, value, size = '') {
    const lat = simState.simulatedProcess.latencies ??= {}
    if (size) { lat[`${label}.${size}`] = value; return }
    for (const key of latencyKeys(label)) lat[key] = value
    for (const key of Object.keys(lat)) if (key.startsWith(`${label}.`)) lat[key] = value
  }

  const currentConfig = computed(() => {
    if (activeField.value === 'op' && selectedOp.value) {
      const { label } = selectedOp.value
      const size = selectedSize.value
      const name = size ? `${label}.${size}` : label
      return { label: t('{name} latency:', { name }), min: 1, max: 99, get: () => latencyOf(label, size), set: (v) => setLatency(label, v, size),
               title: size
                 ? t('Latency of {op} on {size} data in cycles (1 to 99), in every port that executes {op}', { op: label, size })
                 : t('Latency of {op} in cycles (1 to 99), for every data size and in every port that executes {op}', { op: label }) }
    }
    if (activeField.value === 'port' && selectedPort.value !== null)
      return { label: `P${selectedPort.value}:`, min: 0, max: 0, get: () => '', port: true,
               title: t('Port P{p}: insert an operation type, or remove the port', { p: selectedPort.value }) }
    const config = FIELD_CONFIG[activeField.value] ?? FIELD_CONFIG.rob
    return { ...config, label: t(config.label), title: t(config.title) }
  });
  const fieldValue = () => (currentConfig.value.get ? currentConfig.value.get() : simState.simulatedProcess[currentConfig.value.model])

  // ---- Ports and operation types ----
  const portIds = computed(() => Object.keys(simState.simulatedProcess.ports ?? {}))
  const allOperations = computed(() => allOperationNames())
  const insertableOps = computed(() => {
    const list = simState.simulatedProcess.ports?.[selectedPort.value] ?? []
    return allOperations.value.filter(op => !list.includes(op) && !list.includes(op.split('.')[0]))
  })
  const opToInsert = ref('')
  const moveTarget = ref('')

  function insertOperation() {
    const list = simState.simulatedProcess.ports?.[selectedPort.value]
    if (!list || !opToInsert.value) return
    list.push(opToInsert.value)
    if (!(opToInsert.value in (simState.simulatedProcess.latencies ?? {})))
      setLatency(opToInsert.value, latencyOf(opToInsert.value))
    opToInsert.value = ''
  }
  function removeOperation() {
    const { port, label } = selectedOp.value ?? {}
    const list = simState.simulatedProcess.ports?.[port]
    if (!list) return
    simState.simulatedProcess.ports[port] = list.filter(op => !opsOfLabel(label, [op]).length)
    selectedOp.value = null
    activeField.value = 'rob'
  }
  function moveOperation() {
    const { port, label } = selectedOp.value ?? {}
    const from = simState.simulatedProcess.ports?.[port], to = simState.simulatedProcess.ports?.[moveTarget.value]
    if (!from || !to || moveTarget.value === port) return
    const moved = opsOfLabel(label, from)
    simState.simulatedProcess.ports[port] = from.filter(op => !moved.includes(op))
    for (const op of moved) if (!to.includes(op)) to.push(op)
    selectedOp.value = { port: moveTarget.value, label }
    moveTarget.value = ''
  }
  function addPort() {
    if (portIds.value.length >= MAX_PORTS) return showTemporaryError(t('At most {n} execution ports', { n: MAX_PORTS }))
    const ids = portIds.value.map(Number)
    const id = String(ids.length ? Math.max(...ids) + 1 : 0)
    simState.simulatedProcess.ports = { ...simState.simulatedProcess.ports, [id]: [] }
    selectedPort.value = id
    activeField.value = 'port'
  }
  function removePort() {
    const id = selectedPort.value
    if (id === null || portIds.value.length <= 1) return
    const ops = simState.simulatedProcess.ports[id] ?? []
    if (ops.length && !confirm(t('Remove port P{p}? The operation types that only P{p} executes move to the first remaining port, and the ports are renumbered P0, P1, ...', { p: id })))
      return
    const { ports, moved } = removePortFrom(simState.simulatedProcess.ports, id)
    simState.simulatedProcess.ports = ports
    if (moved.length) showTemporaryError(t('Moved to P0: {ops}', { ops: moved.join(', ') }))   // P0 after renumbering
    selectedPort.value = null
    activeField.value = 'rob'
  }
  const largestMemoryAccessSize = computed(() =>
    getLargestMemoryAccessSize(simState.simulatedProcess.instruction_list ?? [])
  )
  const allowedCacheBlockSizes = computed(() =>
    getAllowedCacheBlockSizes(simState.simulatedProcess.instruction_list ?? [])
  )
  const minimumCacheBlockSize = computed(() => allowedCacheBlockSizes.value[0] ?? null)
  const currentMinimum = computed(() =>
    activeField.value === 'cache_BlkSz'
      ? minimumCacheBlockSize.value ?? CACHE_BLOCK_SIZES[0]
      : activeField.value === 'cache_mPenalty'
        ? Math.max(Number(simState.simulatedProcess.mIssueTime) || 1, currentConfig.value.min)
        : currentConfig.value.min
  )
  const currentTitle = computed(() => {
    if (activeField.value === 'cache_mPenalty') {
      return t('Cache miss penalty ({min} to 99; must be at least mIssueTime)', { min: currentMinimum.value })
    }
    if (activeField.value !== 'cache_BlkSz') return currentConfig.value.title
    if (minimumCacheBlockSize.value === null) {
      return t("No supported cache block can hold this program's largest {size}-byte memory access", { size: largestMemoryAccessSize.value })
    }
    return t('Cache block size ({sizes} bytes); minimum access size: {size} bytes',
             { sizes: allowedCacheBlockSizes.value.join(', '), size: largestMemoryAccessSize.value })
  })

  const inputValue   = ref('');
  const isInvalid    = ref(false);
  const validationMessage = ref('')
  let   errorTimeout = null;

  const validateField = () => {
    const min = currentMinimum.value;
    const max = currentConfig.value.max;
    let rawValue = inputValue.value;

    if (errorTimeout) clearTimeout(errorTimeout);

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      const lastValidValue = fieldValue();
      inputValue.value = lastValidValue ?? min;
      isInvalid.value = false;
      validationMessage.value = ''
      return;
    }

    let numValue = Number(rawValue);

    if (isNaN(numValue)) {
      const lastValidValue = fieldValue();
      inputValue.value = lastValidValue ?? min;
      isInvalid.value = false;
      validationMessage.value = ''
      return;
    }

    if (activeField.value === 'cache_BlkSz') {
      if (!allowedCacheBlockSizes.value.includes(numValue)) {
        const lastValidValue = simState.simulatedProcess.blkSize
        inputValue.value = lastValidValue
        const requirement = minimumCacheBlockSize.value === null
          ? t('This program needs a {size}-byte block, larger than the 128-byte maximum.', { size: largestMemoryAccessSize.value })
          : t('Choose one of these cache block sizes (bytes): {sizes}.', { sizes: allowedCacheBlockSizes.value.join(', ') })
        showTemporaryError(requirement)
        return
      }
    }

    if (numValue < min) {
      numValue = min;
      inputValue.value = numValue;
      showTemporaryError(activeField.value === 'cache_mPenalty'
        ? t('MissPenalty cannot be less than mIssueTime ({min})', { min })
        : t('The minimum value is {min}', { min }))
    } else if (numValue > max) {
      numValue = max;
      inputValue.value = numValue;
      showTemporaryError(t('The maximum value is {max}', { max }));
    }

    setParameterValue(numValue)
  }

  function setParameterValue(value) {
    if (activeField.value === 'op' && locked('processor.latencies')) return lockedMessage()
    if (currentConfig.value.set) return currentConfig.value.set(value)
    const model = currentConfig.value.model
    simState.simulatedProcess[model] = value
    if (model === 'mIssueTime' &&
        Number(simState.simulatedProcess.mPenalty) < value) {
      simState.simulatedProcess.mPenalty = value
      showTemporaryError(t('MissPenalty raised to {value}; it cannot be below mIssueTime', { value }))
    }
  }

  const showTemporaryError = (message) => {
    isInvalid.value = true;
    validationMessage.value = message
    errorTimeout = setTimeout(() => {
      isInvalid.value = false;
      validationMessage.value = ''
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
      validationMessage.value = ''
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

      if (newName && simState.state > 1 && !initializingProcessor) {  // Processor already initialized
         if (newName !== simState.processorName) {
           console.log(`💻✅ Processor changed from "${oldName}" to "${newName}"`);
           processorOptions.opsCollapsed = true
           saveOptions()
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

  watch(() => fieldValue(),
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
    removeClickListeners()
  });

// ============================================================================
// PROCESSOR ACTIONS: initProcessor, reloadProcessor, editProcessor, removeProcessor,
//     drawProcessor
// ============================================================================

  const initProcessor = async () => {
    initializingProcessor = true
    try {
      await initResource('processor', processorOptions, 'processorName', 'availableProcessors');
      reloadProcessor()
    } finally {
      initializingProcessor = false
    }
  };

  const reloadProcessor = async () => {
    console.log('💻🔄 Reloading processor with:', processorOptions.processorName);
    try {
      const jsonString = localStorage.getItem(`processor.${processorOptions.processorName}`)
      const data       = JSON.parse(jsonString)
      normalizeCacheSettings(data)

      if (simState.state == 1) {  // This is an initialization step
        simState.state = 2;       // Change to next initialization step
        console.log('💻✅ Initialization step (2): processor configuration loaded')
      }
      savedSignature.value = processorSignature(data)
      data.name = simState.simulatedProcess.name || 'unknown'
      Object.assign(simState.simulatedProcess, data)
      simState.processorName= processorOptions.processorName
      drawProcessor()
    } catch (error) {
      console.error('💻❌ Failed to set processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function normalizeCacheSettings(data) {
    if (!Number.isInteger(data.mIssueTime) || data.mIssueTime < 1 || data.mIssueTime > 99)
      data.mIssueTime = 1
    if (!Number.isInteger(data.mPenalty) || data.mPenalty < 1 || data.mPenalty > 99)
      data.mPenalty = data.mIssueTime
    if (!Number.isInteger(data.nFillBuffers) || data.nFillBuffers < 1 || data.nFillBuffers > 32)
      data.nFillBuffers = 2
    if (!Number.isInteger(data.nWriteBuffers) || data.nWriteBuffers < 1 || data.nWriteBuffers > 32)
      data.nWriteBuffers = 2
    if (!Number.isInteger(data.rThru) || data.rThru < 1 || data.rThru > 32)
      data.rThru = 1
    if (!Number.isInteger(data.bPenalty) || data.bPenalty < 0 || data.bPenalty > 99)
      data.bPenalty = 5
    if (Number(data.mPenalty) < Number(data.mIssueTime)) {
      data.mPenalty = Number(data.mIssueTime)
      console.warn('💻⚠️ MissPenalty was raised to mIssueTime.')
    }
  }

// ---- Changes made in the panel: save with a name (local list + JSON file), or revert ----
  const savedSignature = ref('')     // configuration of the processor as stored in the list
  const modified = computed(() => simState.state > 1 && !!savedSignature.value &&
    processorSignature(simState.simulatedProcess) !== savedSignature.value)

  const showSave = ref(false)
  const saveName = ref('')
  const saveNameError = computed(() => {
    const name = saveName.value.trim()
    if (!name) return t('Write a name')
    if (!/^[\w.\- ]+$/.test(name)) return t('Use letters, digits, spaces, "_", "-" or "."')
    return ''
  })
  const overwrites = computed(() => {
    const name = saveName.value.trim()
    return name !== processorOptions.processorName && processorOptions.availableProcessors.includes(name)
  })

  function openSave() {
    saveName.value = processorOptions.processorName || ''
    showSave.value = true
  }

  async function confirmSave(download) {
    if (saveNameError.value) return
    const name = saveName.value.trim()
    const data = processorDraftFrom(simState.simulatedProcess)
    data.name  = name
    saveToLocalStorage('processor', name, data, processorOptions.availableProcessors)
    simState.processorName         = name     // already loaded: selecting it does not reload it
    processorOptions.processorName = name
    savedSignature.value = processorSignature(data)
    showSave.value = false
    if (download) await downloadJSON(data, name, 'processor')
  }

  function revertProcessor() {
    reloadProcessor()
  }

  function removeProcessor () {
    removeFromLocalStorage('processor', processorOptions.processorName, processorOptions.availableProcessors)
    if ( processorOptions.availableProcessors.length > 0)
      processorOptions.processorName = processorOptions.availableProcessors[0]
    else {
      processorOptions.availableProcessors = []
      processorOptions.processorName = ''
      alert(t('Removing all processor configurations forces to load the original processors provided in the distribution'))
      initProcessor()
    }
  }

  const drawProcessor = async () => {
    try {
      const dotCode      = get_processor_dot (simState.simulatedProcess, true, simState.highlightedPort,
                                              { collapsed: processorOptions.opsCollapsed })
      const svg          = await createGraphVizGraph(dotCode);
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

            // locked by the lesson: the cell only shows its explanation
            const field = action.startsWith('op:') ? null : action.startsWith('port:') ? 'ports' : CELL_FIELD[action]
            if (action.startsWith('op:') && locked('processor.latencies') && locked('processor.ports')) return lockedMessage()
            if (field && locked(`processor.${field}`)) return lockedMessage()

            if (action.startsWith('op:')) {       // op:<port>:<row>:<label>
              const [, port, , label] = action.split(':')
              selectedOp.value = { port, label }
              selectedSize.value = ''
              moveTarget.value = ''
              activeField.value = 'op'
              return
            }
            if (action.startsWith('port:')) {
              selectedPort.value = action.slice(5)
              opToInsert.value = ''
              activeField.value = 'port'
              return
            }
            switch (action) {
              case 'toggleops':
                processorOptions.opsCollapsed = !processorOptions.opsCollapsed
                saveOptions()
                drawProcessor()
                break
              case 'addport':
                addPort()
                break
              case 'dispatch':
              case 'rob':
              case 'retire':
              case 'bpenalty':
                activeField.value = action
                break

              case 'port':
                console.log('Port clicked:', g.id.slice(2))
                break

              case 'cache':
                activeField.value  = cacheConfigOptions[currentCacheOption];
                currentCacheOption = (currentCacheOption + 1) % cacheConfigOptions.length;
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

  function lockedMessage() {
    showTemporaryError(t('This parameter cannot be changed in this lesson'))
  }

  // The diagram has texts: redrawn in the new language
  watch(locale, () => { if (simState.state > 1) drawProcessor() })

  // Reload the current processor (its stored version may have changed: lessons)
  // (a processor that is no longer stored, e.g. one of a lesson that ended, is selected again by the caller)
  watch(() => simState.reloadNonce, () => {
    if (simState.state > 1 && localStorage.getItem(`processor.${processorOptions.processorName}`)) reloadProcessor()
  })

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
        normalizeCacheSettings(data)
        const exists = processorOptions.availableProcessors.includes(data.name)
        if (exists && !confirm(t('A processor with the name "{name}" is already loaded. Do you want to overwrite it?', { name: data.name }))) {
          alert(t('Upload cancelled.'))
          processorOptions.processorName = oldProcessor
          return
        }
        saveToLocalStorage('processor', data.name, data, processorOptions.availableProcessors)
        savedSignature.value   = processorSignature(data)
        processorOptions.opsCollapsed = true
        saveOptions()
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
  const helpPosition = ref({ top: '0%', left: '35%' });

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
    if (activeField.value === 'cache_BlkSz') {
      const currentValue = simState.simulatedProcess.blkSize
      const nextValue = allowedCacheBlockSizes.value.find(size => size > currentValue)
      if (nextValue !== undefined)
        simState.simulatedProcess.blkSize = nextValue
      return
    }
    const max    = currentConfig.value.max
    let newValue = fieldValue()
    setParameterValue(Math.min(newValue+1, max))
  }

  function decreaseParameter() {
    if (activeField.value === 'cache_BlkSz') {
      const values = allowedCacheBlockSizes.value
      const currentValue = simState.simulatedProcess.blkSize
      const previousValues = values.filter(size => size < currentValue)
      simState.simulatedProcess.blkSize = previousValues.length
        ? previousValues[previousValues.length - 1]
        : values[0] ?? currentValue
      return
    }
    const min    = currentMinimum.value
    let newValue = fieldValue()
    setParameterValue(Math.max(newValue-1, min))
  }

</script>

<template>
  <div class="header processor-part">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" :title="t('Show help')">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">{{ t('Processor') }}</span>
      </div>
      <div class="settings-container">
        <select v-model="processorOptions.processorName" class="form-select"
            id="processors-list" :title="t('Select Processor Configuration')">
          <option value="" disabled>{{ t('Select') }}</option>
          <option v-for="processor in visibleProcessors" :key="processor" :value="processor" >
            {{ processor }}
          </option>
          <option v-if="!locked('upload')" value="_add_new_">{{ t('Add new') }}</option>
        </select>
        <button v-if="!editLocked" class="blue-button small-btn" @click="openSave"
          id="save-processor-button"
          :title="t('Save the processor with a name: it is added to the list (local storage) and can be downloaded as a JSON file')">
        💾
        </button>
        <button v-if="modified" class="blue-button small-btn modified-btn" @click="revertProcessor"
          id="revert-processor-button"
          :title="t('Modified: the processor differs from the saved \'{name}\'. Click to discard the changes', { name: processorOptions.processorName })">
        ✱ ↶
        </button>
        <button v-if="!locked('remove')" class="blue-button small-btn" @click="removeProcessor"
          id="remove-processor-button"
          :title="t('Remove processor configuration from list (and local storage)')">
        🧹
        </button>
        <template v-if="currentConfig.port">
          <span class="iters-label highlight-static" :title="currentConfig.title">{{ currentConfig.label }}</span>
          <select v-model="opToInsert" id="port-insert-op" :title="t('Operation type to insert in this port')">
            <option value="">{{ t('insert type…') }}</option>
            <option v-for="op in insertableOps" :key="op" :value="op">{{ op }}</option>
          </select>
          <button class="blue-button small-btn" id="port-insert-button" :disabled="!opToInsert" @click="insertOperation"
                  :title="t('Insert the selected operation type in this port')">＋</button>
          <button class="blue-button small-btn" id="port-remove-button" :disabled="portIds.length <= 1" @click="removePort"
                  :title="t('Remove this port')">✕ port</button>
        </template>
        <template v-else>
        <div class="iters-group rob-group">
          <span class="iters-label"
            :class="{ 'highlight': labelHighlighted }"
            :title="currentTitle">
            {{ currentConfig.label }}
          </span>
          <input
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            :placeholder="currentMinimum.toString()"
            v-model="inputValue"
            @blur="validateField"
            @keypress="handleKeyPress"
            @input="handleInput"
            :class="{ 'invalid': isInvalid }"
            :title="validationMessage || currentTitle"
            :aria-invalid="isInvalid"
          />
        </div>
        <button
          class="blue-button small-btn"
          @mousedown="startHold(increaseParameter)"
          @mouseup="stopHold"
          @mouseleave="stopHold"
          @touchstart.prevent="startHold(increaseParameter)"
          @touchend="stopHold"
          :title="t('Increase parameter (press and hold for faster incrementing)')"
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
          :title="t('Decrease parameter (press and hold for faster decrementing)')"
        >
          ▼
        </button>
        <template v-if="activeField === 'op' && selectedOp && !locked('processor.ports')">
          <select v-if="sizesOf(selectedOp.label).length" v-model="selectedSize" id="op-size-select"
                  :title="t('Edit the latency of {op} for every data size, or for one size only', { op: selectedOp.label })">
            <option value="">{{ t('all sizes') }}</option>
            <option v-for="s in sizesOf(selectedOp.label)" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="moveTarget" @change="moveOperation" id="op-move-select"
                  :title="t('Move {op} from P{p} to another port', { op: selectedOp.label, p: selectedOp.port })">
            <option value="">{{ t('move to…') }}</option>
            <option v-for="p in portIds.filter(p => p !== selectedOp.port)" :key="p" :value="p">P{{ p }}</option>
          </select>
          <button class="blue-button small-btn" id="op-remove-button" @click="removeOperation"
                  :title="t('Remove {op} from port P{p}', { op: selectedOp.label, p: selectedOp.port })">✕</button>
        </template>
        </template>
      </div>
  </div>

  <div class="graph-section processor-part">
    <div class="processor-container">
      <div class="simProcessor-img" data-pin-twice="a_toggleops a_addport" v-html="simulatedSvg" v-if="simulatedSvg"></div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    :text="t('help.processor')"
    :title="t('Processor MicroArchitecture Description')"
    @close="closeHelp" />
  </Teleport>

  <div v-if="showSave" class="modal-overlay" @click.self="showSave = false">
    <div class="modal">
      <h4>{{ t('Save processor as') }}</h4>
      <label for="save-processor-name">{{ t('Name:') }}</label>
      <input v-model="saveName" type="text" id="save-processor-name" @keyup.enter="confirmSave(true)"
             :title="t('Name of the processor in the list, and of the downloaded JSON file')"/>
      <div v-if="saveNameError" class="error">{{ saveNameError }}</div>
      <div v-else-if="overwrites" class="warning">{{ t('A processor named "{name}" already exists: it will be replaced.', { name: saveName.trim() }) }}</div>
      <div class="modal-actions">
        <button class="blue-button" id="save-processor-download" :disabled="!!saveNameError" @click="confirmSave(true)"
                :title="t('Add the processor to the list and download it as a JSON file')">{{ t('Save and download') }}</button>
        <button class="blue-button" id="save-processor-only" :disabled="!!saveNameError" @click="confirmSave(false)"
                :title="t('Add the processor to the list (local storage of this browser)')">{{ t('Save') }}</button>
        <button class="blue-button" @click="showSave = false" :title="t('Cancel')">{{ t('Cancel') }}</button>
      </div>
    </div>
  </div>

</template>

<style scoped>
  .modal-overlay {
    position: fixed; inset: 0; display: flex; z-index: 1000;
    background: rgba(0, 0, 0, 0.5); justify-content: center; align-items: center;
  }
  .modal {
    background: white; padding: 25px; border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); min-width: min(400px, 90vw);
  }
  .modal h4 { margin: 0 0 15px 0; color: #007acc; }
  .modal label { display: block; margin-bottom: 5px; font-weight: bold; }
  .modal input {
    width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid #ccc;
    border-radius: 4px; box-sizing: border-box; font-size: 14px;
  }
  .modal .error   { color: #c62828; font-size: 0.9em; }
  .modal .warning { color: #8a5a00; font-size: 0.9em; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  .modified-btn { background: #f0ad4e; }
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
