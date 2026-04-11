<script setup>
  import { ref, watch, watchEffect, onMounted, onUnmounted, nextTick, inject, computed, reactive } from 'vue'
  import HelpComponent                                                  from '@/components/helpComponent.vue'
  import { downloadJSON, uploadJSON, saveToLocalStorage, removeFromLocalStorage, initResource,
            createGraphVizGraph, instructionTypes, typeOperations, typeSizes                } from '@/common'

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
    availableProcessors: [],
    expandedTypes:       Object.fromEntries( instructionTypes.map(type => [ type, false])),
    expandedOperations:  Object.fromEntries( instructionTypes.flatMap(type =>
                                                typeOperations[type].map(op => [`${type}.${op}`, false])
                                              )
                                            )
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

  const saveSimState = () => {
    try {
      localStorage.setItem('SimulationState', JSON.stringify(simState))
      console.log('🚀✅ SimulationState saved');
    } catch (error) {
      console.error('🚀❌ Failed to save SimulationState:', error)
    }
  }

  const activeField = ref("rob");

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
    retire: {
      label: "Retire:",
      title: "Retire width (1 to 9)",
      min: 1,
      max: 9,
      model: "retire"
    }
  };

  const currentConfig = computed(() => FIELD_CONFIG[activeField.value]);

  const currentValue = computed({
    get() {
      return simState.simulatedProcess[currentConfig.value.model];
    },
    set(val) {
      if (val === "" || val == null) return;
      if (val >= currentConfig.value.min && val <= currentConfig.value.max) {
        simState.simulatedProcess[currentConfig.value.model] = val;
      }
    }
  });

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
// Temporal in-edition processor:  createDefaultConfig, updateProcessorSettings
// ============================================================================

  function createDefaultConfig() {
    return {
      name:       'default',
      sched:      'optimal',
      dispatch:   1,
      retire:     1,
      ROBsize:    20,
      nBlocks:    0,
      blkSize:    1,
      mPenalty:   1,
      mIssueTime: 1,
      latencies:  Object.fromEntries(
                    instructionTypes.flatMap(type => { return [[type, 1]]; })
                  ),
      ports:      { 0:  instructionTypes.flatMap(type => {
                          const ops = typeOperations[type] || [];
                          return ops.length > 0
                            ? ops.map(op => `${type}.${op}`)
                            : [type];    // 👈 tipos sin operaciones
                        })
                  }
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

  watch( [ () => processorOptions.availableProcessors, () => processorOptions.expandedTypes,
    () => processorOptions.expandedOperations], () => {
    try {
      saveOptions()
    } catch (error) {
      console.error('💻❌ Failed to handle changes on processor:', error)
    }
  },
  { deep: true, immediate: true })

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

  watch( () => ({ state: simState.state,
      processorName:     simState.processorName,
      programName:       simState.programName,
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
    const svg        = simulatedSvg.value;
    const fullscreen = props.isFullscreen;

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
    console.log('💻🎯 ProcessorComponent mounted')

    // load Edited Processor
    const stored = localStorage.getItem('processorTemp');
    if (stored) {
      try {
        const data = JSON.parse(stored)
        updateProcessorSettings(data)
        return
      } catch (e) {
        console.error('📄❌ Failed to load edited processor from localStorage:', e);
      }
    }
    if (currentConfig.value?.label) highlightLabel()
  });

  onUnmounted(() => {
    console.log('💻👋 ProcessorComponent unmounted')
    localStorage.removeItem('processorTemp')
    removeClickListeners()
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
      const jsonString = localStorage.getItem(`processor.${processorOptions.processorName}`)
      const data       = JSON.parse(jsonString)

      if (simState.state == 1) {  // This is an initialization step
        simState.state = 2;       // Change to next initialization step
        console.log('💻✅ Initialization step (2): processor configuration loaded')
        drawEditedProcessor()
      }
      Object.assign(simState.simulatedProcess, data)
      simState.processorName= processorOptions.processorName;
      drawProcessor()
    } catch (error) {
      console.error('💻❌ Failed to set processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  const emit = defineEmits(['requestSwitchFull'])

  function editProcessor () {
    if (simState.simulatedProcess) {
      emit('requestSwitchFull', 'processor')
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
      updateProcessorSettings(cleanProcConfig)
      console.log('💻📄 Emit requestSwitchFull for processor edition')
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

  const uploadForEdition = async () => {
    try {
      const data = await uploadJSON(null, 'processor');
      if (data) {
        updateProcessorSettings(data)
      }
    } catch (error) {
      console.error('📄❌ Failed to upload processor for edition:', error)
    }
  };

  const drawProcessor = async () => {
    try {
      const dotCode      = get_processor_dot (simState.simulatedProcess, simState.highlightedPort, simState.executionResults)
      // console.log('💻🔄Redrawing simulated processor', dotCode);
      const svg          = await createGraphVizGraph(dotCode);
      // console.log('💻🔄Redrawing SVG', svg);
      simulatedSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw processor:', error)
      simulatedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  const drawEditedProcessor = async () => {
    console.log('💻🔄Redrawing edited processor');
    try {
      const dotCode   = get_processor_dot (procConfig, -1)
      const svg       = await createGraphVizGraph(dotCode);
      editedSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw edited processor:', error)
      editedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function get_processor_dot(process, highlightPort = -1) {

    const ports    = process.ports
    const lat      = process.latencies
    const port_ids = Object.keys(ports)
    const ROBsize  = process.ROBsize || 20
    const sched    = process.sched
    const dispatch = process.dispatch || 1
    const retire   = process.retire || 1

    function type_color(type) {
      if (type === "INT")    return "#d6e4ff"
      if (type === "MEM")    return "#d6ffd6"
      if (type === "FLOAT")  return "#fff2b3"
      if (type === "VINT")   return "#e6e4ff"
      if (type === "VMEM")   return "#e6ffd6"
      if (type === "VFLOAT") return "#eff2b3"
      if (type === "BRANCH") return "#ffd6d6"
      return "#f0f0f0"
    }

    function op_type(op) {
      return op.split(".")[0]
    }

    function latency_tooltip(op) {

      const base = lat[op]

      const variants = Object.keys(lat)
        .filter(k => k.startsWith(op + "."))

      if (variants.length === 0)
        return base !== undefined ? `${op} latency: ${base}` : ""

      let txt = `${op} latencies:\n`

      if (base !== undefined)
        txt += `base: ${base}\n`

      for (let v of variants)
        txt += `${v}: ${lat[v]}\n`

      return txt
    }

    function compress_ops(ops) {
      const grouped = {}
      for (let op of ops) {
        const [type, sub] = op.split(".")
        if (!grouped[type]) grouped[type] = new Set()
        if (sub) grouped[type].add(sub)
      }

      const result = []
      for (let type in grouped) {
        const all_ops = typeOperations[type] || []
        if (all_ops.length === 0 || grouped[type].size === all_ops.length) {
          result.push({
            label: type,
            big: true
          })
        } else {
          for (let sub of grouped[type]) {
            result.push({
              label: `${type}.${sub}`,
              big: false
            })
          }
        }
      }
      return result
    }

    const highlight = highlightPort !== null && highlightPort !== undefined
      ? String(highlightPort)
      : null

    const port_ops = {}
    for (let p of port_ids)
      port_ops[p] = compress_ops(ports[p])

    const total_rows = Math.max(...Object.values(port_ops).map(o => o.length))

    // ---- Dispatch + ROB ----
    let decode_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="dispatch" TITLE="Edit dispatch width"><FONT POINT-SIZE="20">🔄&nbsp;<B>Dispatch:&nbsp;</B>&nbsp;${dispatch}/cycle</FONT></TD>
      <TD ROWSPAN="${total_rows+4}" BGCOLOR="#f0f0f0" HREF="#" ID="rob" TITLE="Edit ROB size" ALIGN="CENTER" VALIGN="MIDDLE"><FONT POINT-SIZE="20">🔄<BR/><B>ROB</B><BR/><BR/><B>${ROBsize}</B></FONT><BR/><FONT POINT-SIZE="16">entries</FONT></TD>
    </TR>`

    // ---- Waiting Buffer ----
    let schedLabel = "❌optimal ✅greedy"
    if (sched !== "greedy"){
      schedLabel = "✅optimal ❌greedy"
    }
    let wb_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="sched" TITLE="Toggle scheduler"><FONT POINT-SIZE="20"><B>Waiting Buffer</B></FONT>&nbsp;&nbsp;&nbsp;<FONT POINT-SIZE="16">Scheduler:&nbsp;</FONT><FONT POINT-SIZE="18"><B>${schedLabel}</B></FONT></TD>
    </TR>`

    // ---- Port headers ----
    let port_header = "<TR>"

    for (let p of port_ids) {
      const isHighlighted = (p === highlight)
      const style = isHighlighted
        ? ' BGCOLOR="#ffcccc" BORDER="3" COLOR="red"'
        : ' BGCOLOR="#f5f5f5"'

      port_header += `<TD ${style} HREF="#" ID="port:${p}" TITLE="Select port ${p}"><FONT POINT-SIZE="20"><B>P${p}</B></FONT></TD>`
    }

    port_header += "</TR>"

    // ---- Operation rows ----
    let op_rows = ""

    for (let i = 0; i < total_rows; i++) {

      op_rows += "<TR>"

      for (let p of port_ids) {
        const isHighlighted = (p === highlight)
        const highlightAttr = isHighlighted
          ? ' BORDER="3" COLOR="red"'
          : ''

        const op = port_ops[p][i]

        if (!op) {
          op_rows += `<TD ${highlightAttr}></TD>`
          continue
        }

        const type    = op_type(op.label)
        const color   = type_color(type)
        const tooltip = latency_tooltip(op.label)

        op_rows += `
          <TD BGCOLOR="${color}" TITLE="${tooltip}" HREF="#" ID="op:${p}:${i}:${op.label}" ${highlightAttr}><FONT POINT-SIZE="${op.big ? 16 : 14}">${op.big ? `<B>${op.label}</B>` : op.label}</FONT></TD>`
      }

      op_rows += "</TR>"
    }

    // ---- Retire ----
    let reg_row = `<TR>
      <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="retire" TITLE="Edit retire width"><FONT POINT-SIZE="20">🔄&nbsp;<B>Retire:</B>&nbsp;${retire}/cycle&nbsp;&nbsp;<B>(Architected Registers)</B></FONT></TD>
    </TR>`

    const dot = `
      digraph CPU {
        node [shape=plain fontname="Arial" width=0 height=0 margin=0]
        pipeline [
          label=<
            <TABLE WIDTH="600" BORDER="2" CELLBORDER="1" CELLSPACING="2" CELLPADDING="1">
              ${decode_row}
              ${wb_row}
              ${port_header}
              ${op_rows}
              ${reg_row}
            </TABLE>
          >
        ]
      }`

    return dot
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
// Processor Edition LOGIC:      addPort, removePort, toggleTypeExpand,
//    toggleTypeForPor, togglePortOperation, toggleScheduler, noPortAssigned
// ============================================================================

  function toggleTypeExpand(type) {
    processorOptions.expandedTypes[type] = ! processorOptions.expandedTypes[type];
  }

  function toggleOperationExpand(type, oper) {
    processorOptions.expandedOperations[`${type}.${oper}`] = ! processorOptions.expandedOperations[`${type}.${oper}`];
  }

  function opsOfTypeAssigned(port, type) {
    return typeOperations[type]
      .map(op => `${type}.${op}`)
      .filter(tOp => procConfig.ports[port]?.includes(tOp));
  }

  function hasOperations(type) {
    return typeOperations[type] && typeOperations[type].length > 0;
  }

  function hasSizes(type) {
    return typeSizes[type] && typeSizes[type].length > 0;
  }

  function isAssignedElsewhere(type, port) {
    return portList.value.some(p =>
      p !== port && procConfig.ports[p]?.includes(type)
    );
  }

  function isTypeChecked(port, type) {
    // 🔹 Tipo sin operaciones → check directo
    if (!hasOperations(type)) {
      return procConfig.ports[port]?.includes(type) ?? false;
    }

    // 🔹 Tipo con operaciones
    const ops = opsOfTypeAssigned(port, type);
    return ops.length === typeOperations[type].length;
  }

  function isTypeIndeterminate(port, type) {
    const n = opsOfTypeAssigned(port, type).length;
    return n > 0 && n < typeOperations[type].length;
  }

  function ensureTypeOperationsAssigned(type) {
    const ops = typeOperations[type];

    if (!procConfig.ports[0]) {
      procConfig.ports[0] = [];
    }

    ops.forEach(op => {
      const key = `${type}.${op}`;

      // ¿Esta operación está en ALGÚN puerto?
      const assignedSomewhere = portList.value.some(port =>
        procConfig.ports[port]?.includes(key)
      );

      // Si no está en ningún puerto → asignarla al puerto 0
      if (!assignedSomewhere) {
        procConfig.ports[0].push(key);
      }
    });
  }

  function togglePortType(port, type, isChecked, event) {
    if (!procConfig.ports[port]) procConfig.ports[port] = [];

    // 🔹 BRANCH u otros tipos sin operaciones
    if (!hasOperations(type)) {
      if (isChecked) {
        if (!procConfig.ports[port].includes(type))
          procConfig.ports[port].push(type);
      } else {
        if (!isAssignedElsewhere(type, port)) {
          // ❌ NO se puede desmarcar → revertir checkbox
          event.target.checked = true;   // 🔥 clave
          return;
        }
        procConfig.ports[port] =
          procConfig.ports[port].filter(i => i !== type);
      }
      return;
    }

    // 🔹 Tipos con operaciones
    const ops = typeOperations[type].map(op => `${type}.${op}`);

    if (isChecked) {
      ops.forEach(op => {
        if (!procConfig.ports[port].includes(op))
          procConfig.ports[port].push(op);
      });
    } else {
      // ❌ desmarcar → solo si no deja operaciones huérfanas
      ops.forEach(op => {
        const assignedElsewhere = portList.value.some(p =>
          p !== port && procConfig.ports[p]?.includes(op)
        );

        if (assignedElsewhere) {
          procConfig.ports[port] =
            procConfig.ports[port].filter(x => x !== op);
        } else { // ❌ NO se puede desmarcar → revertir checkbox
          event.target.checked = true;   // 🔥 clave
          return;
        }
      });
    }
  }

  function isPortOperationChecked(port, type, op) {
    return procConfig.ports[port]?.includes(`${type}.${op}`) ?? false;
  }

  function onTogglePortOperation(port, type, op, event) {
    const checked = event.target.checked;

    const changed = togglePortOperation(port, type, op, checked);

    // 🔴 si NO se ha permitido el cambio, revertimos el checkbox
    if (!changed) {
      event.target.checked = !checked;
    }
  }

  function togglePortOperation(port, type, op, isChecked) {
    const key = `${type}.${op}`;

    if (!procConfig.ports[port]) procConfig.ports[port] = [];

    if (!isChecked) {
      // ❗ si la operación debe seguir estando en algún puerto
      if (!canUnassignOperation(type, op, port)) {
        return false;
      }
      procConfig.ports[port] =
        procConfig.ports[port].filter(i => i !== key);
    } else {
      if (!procConfig.ports[port].includes(key)) {
        procConfig.ports[port].push(key);
      }
    }

    return true;
  }

  function canUnassignOperation(type, op, excludingPort) {
    const key = `${type}.${op}`;
    return portList.value.some(port =>
      port !== excludingPort && procConfig.ports[port]?.includes(key)
    );
  }

  function toggleScheduler() {
    if (procConfig.sched === 'greedy') {
      procConfig.sched = 'optimal'
    } else {
      procConfig.sched = 'greedy'
    }
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

    instructionTypes.forEach(type => {
      ensureTypeOperationsAssigned(type);
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
      const data = await uploadJSON(null, 'processor')
      if (data) {
        const exists = processorOptions.availableProcessors.includes(data.name)
        if (exists && !confirm(`A processor with the name "${data.name}" is already loaded. Do you want to overwrite it?`)) {
          alert('Upload cancelled.')
          processorOptions.processorName = oldProcessor
          return
        }
        saveToLocalStorage('processor', data.name, data, processorOptions.availableProcessors)
        Object.assign(simState.simulatedProcess, data)
        simState.processorName = data.name
        processorOptions.processorName = data.name
        return
      }
    } catch (error) {
      console.error('💻❌ Failed to upload processor:', error)
    }
    processorOptions.processorName = oldProcessor
  }

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
              id="processors-list" title="Select Processor Configuration">
            <option value="" disabled>Select</option>
            <option v-for="processor in processorOptions.availableProcessors" :key="processor" :value="processor" >
              {{ processor }}
            </option>
            <option value="_add_new_">Add new</option>
          </select>
	  <!--
          <button class="blue-button small-btn" @click="editProcessor"
            id="edit-processor-button"
            title="Edit current processor on full-screen">
          📝
          </button>
          -->
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
              :title="`Rango: ${currentConfig.min} - ${currentConfig.max}`"
            />
          </div>
        </div>
      </div>

      <div class="graph-section">
        <div class="processor-container">
          <div class="simProcessor-img" v-html="simulatedSvg" v-if="simulatedSvg"></div>
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
            <span>ROB size:</span>
            <input type="number" v-model.number="procConfig.ROBsize" min="1" max="200"
                   id="rob-size"
                   title="max. number of instructions in ROB (1 to 200)"
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
                    <td class="type-cell">
                      <button
                        v-if="hasOperations(type)"
                        class="dropdown-header"
                        @click="toggleTypeExpand(type)"
                        :title="`Show operations of type ${type}`"
                        id="show-critical-button">
                        <span class="arrow" aria-hidden="true">
                          {{ processorOptions.expandedTypes[type] ? '▼' : '▶' }}
                        </span>
                        <span class="type-name">{{ type }}</span>
                      </button>

                      <span
                        v-else
                        class="type-label no-ops"
                        title="This instruction type has no sub-operations"
                      >
                        {{ type }}
                      </span>
                    </td>
                    <td></td>
                    <td></td>
                    <td>
                      <input type="number"
                          v-model.number="procConfig.latencies[type]"
                          class="latency-input"
                          min="1" max="99"
                          :id="`${type}-latency`"
                          :title="`Execution latency in clock cycles for the ${type} instruction type (1 to 99)`" />
                    </td>
                    <td v-for="port in portList" :key="port" class="port-checkbox">
                      <label class="port-label">

                        <input
                          type="checkbox"
                          :checked="isTypeChecked(port, type)"
                          :indeterminate="isTypeIndeterminate(port, type)"
                          @change="togglePortType(port, type, $event.target.checked, $event)"
                          :id="`Port${port}-${type}-check`"
                          :title="`Set if Port P${port} can execute ${type} instructions`"
                        />
                      </label>
                    </td>
                  </tr>
                  <template
                      v-if="hasOperations(type) && processorOptions.expandedTypes[type] && !isTypeChecked(port, type)"
                      v-for="op in typeOperations[type]"
                      :key="`${type}-${op}`"
                    >
                    <tr class="op-row">
                      <td></td>
                      <td class="op-cell">
                        <button
                          v-if="hasSizes(type)"
                          class="dropdown-header"
                          @click="toggleOperationExpand(type, op)"
                          :title="`Show data sizes of ${type}.${op} operation`"
                          >
                          <span class="arrow" aria-hidden="true">
                            {{ processorOptions.expandedOperations[`${type}.${op}`] ? '▼' : '▶' }}
                          </span>
                          <span class="op-name">{{ op }}</span>
                        </button>
                        <!-- Tipo SIN sizes (ej. VMEM) -->
                        <span
                          v-else
                          class="type-label no-ops"
                          :title="`Operations for instructions of type ${type} have no size`"
                        >
                          <span class="op-name">{{ op }}</span>
                        </span>
                      </td>

                      <td> - </td>
                      <td
                        v-if="!processorOptions.expandedOperations[`${type}.${op}`]"
                        >
                        <input type="number"
                          v-model.number="procConfig.latencies[`${type}.${op}`]"
                          min="1" max="99"
                          class="latency-input" />
                      </td>
                      <td v-else></td>
                      <td v-for="port in portList" :key="port" class="port-checkbox">
                        <label class="port-label">
                          <input
                            type="checkbox"
                            :checked="isPortOperationChecked(port, type, op)"
                            @change="onTogglePortOperation(port, type, op, $event)"
                            :id="`Port${port}-${type}-${op}-check`"
                            :title="`Set if Port P${port} can execute ${type}.${op} instructions`"
                          />
                        </label>
                      </td>
                    </tr>
                    <tr
                      v-if="processorOptions.expandedOperations[`${type}.${op}`] && hasSizes(type)"
                      v-for="size in typeSizes[type]"
                      :key="`${type}-${op}-${size}`"
                      class="op-row"
                    >
                      <td></td>
                      <td></td>
                      <td>
                        <span class="op-name">{{ size }}</span>
                      </td>
                      <td>
                        <input type="number"
                          v-model.number="procConfig.latencies[`${type}-${op}-${size}`]"
                          min="1" max="99"
                          class="latency-input"
                          :id="`${type}-${op}-latency`"
                          :title="`Execution latency in clock cycles for ${type}.${op}.${size} (1 to 99)`" />
                      </td>
                      <td v-for="port in portList" :key="port" class="port-checkbox">
                        -
                      </td>
                    </tr>
                  </template>
                </template>
              </tbody>
            </table>
          </div> <!--- Table Container -->
        </div> <!--- Latency & Port Settings Group -->

        <div class="processor-side-container">
          <div class="processor-img" v-html="editedSvg" v-if="editedSvg"></div>
        </div>

      </div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    text="The table describes the <strong>processor microarchitecture</strong> (pipeline) characteristics.
        <p>Click on the corresponding table cells to modify the <strong>Dispatch</strong> and/or <strong>Retire</strong> widths
          (maximum number of instructions dispatched into or retired from the <strong>Execution Engine</strong> per clock cycle),
          or the <strong>ROB</strong> (ReOrder Buffer) size (maximum number of instructions on the <strong>Execution Engine</strong>).
          All of them may impose a <strong><em>throughput-bound</em></strong> performance limit.</p>
        <p>Click on the <strong>Waiting Buffer</strong> row to toggle between a <em>greedy</em> scheduler
          (which issues older ready instructions as soon as possible) and an <em>optimal</em> scheduler
          (which always issues the best combination of ready instructions to maximize performance).</p>
        <p>A new <em>processor configuration</em> can be selected from the list (referring to a JSON file description stored in local storage).
         Click on the buttons on the right to <strong>edit</strong> all the microarchitectural parameters or
         to <strong>remove</strong> the file from local storage.</p>
        "
    title="Processor MicroArchitecture Description"
    @close="closeHelp" />

    <HelpComponent v-if="showHelp1" :position="helpPosition"
    text="Modify the simulated processor’s <strong>configuration settings</strong>, including: (1) <em>Dispatch & Retire</em> Widths;
      (2) <em>ROB</em> size; (3) <em>Cache Memory</em>; (4) <em>Execution Ports</em> (Add or remove execution ports, up to a maximum of 10); and
      (5) <em>Execution Latencies</em>"
    title="Processor Settings"
    @close="closeHelp1"/>

    <HelpComponent v-if="showHelp2" :position="helpPosition"
    text="Modify the <strong>Dispatch</strong> and/or <strong>Retire</strong> Widths.
       They indicate the maximum number of instructions per clock cycle that must be dispatched into or retired from the Execution Engine.
      <p>They may impose a throughput-bound performance limit.</p>"
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
        <button class="blue-button" title="Cancel Download" @click="showModalDownload=false">  Cancel </button>
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
    flex:           1 1 45%;
  }
  .settings-group.latency-group {
    flex:           1 1 45%;
  }
  .settings-group.cache-group {
    flex: 1 1 55%;
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
    flex: 1;
    justify-content: center;
  }
  .settings-container select,
  .settings-container button {
    flex-shrink: initial;
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
    font-size:   12px;
    font-family: Arial, sans-serif;
  }

  .processor-img svg polygon,
  .processor-img svg path {
    stroke-width: 2px;
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
    min-width:    70px;
    max-width:   100px;
    text-align:  center;
    font-size:   medium;
    padding:     0px;
  }

  .instr-table th:nth-child(2),  /* Columna Operation */
  .instr-table td:nth-child(2) {
    min-width: 74px;
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
    min-width: 66px;
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
    padding:       2px 4px;
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
    white-space: nowrap;
  }

  .dropdown-header {
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
  }

  .arrow {
    width: 1em;
    text-align: center;
    color: #444;
  }

  .type-name {
    font-weight: 600;
  }
  .type-label.no-ops {
    font-weight:  600;
    color:     #261515;
    cursor:     default;
    opacity:      0.9;
  }
  .op-name {
    font-weight: 600;
  }

</style>
