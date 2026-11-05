<script setup>
  import { ref, watch, watchEffect, onMounted, onUnmounted, nextTick, inject, computed, reactive } from 'vue'
  import HelpComponent                                                  from '@/components/helpComponent.vue'
  import { downloadJSON, uploadJSON, createGraphVizGraph,
           instructionTypes, typeOperations, typeSizes, get_processor_dot,
           normalizeLatencyKeys                                                         } from '@/common'
  import { processorDraftFrom }                                          from '@/editDrafts'

  const simState = inject('simulationState');

  // Opened with no draft, or with the untouched default one: start from the current processor
  function seedDraftFromCurrentProcessor() {
    let draft = null
    try { draft = JSON.parse(localStorage.getItem('processorTemp')) } catch { /* invalid draft */ }
    if ((!draft || draft.name === 'default') && simState.simulatedProcess?.ports) {
      localStorage.setItem('processorTemp', JSON.stringify(processorDraftFrom(simState.simulatedProcess)))
    }
  }

  const props = defineProps({
    isFullscreen: {
      type: Boolean,
      default: false
    }
  })

// ============================================================================
// Processor options & localStorage
// ============================================================================

  const STORAGE_KEY = 'procEditOptions'
  const MIN_CACHE_BLOCK_SIZE = 4

  const defaultOptions = {
    expandedTypes:       Object.fromEntries( instructionTypes.map(type => [ type, false])),
    expandedOperations:  Object.fromEntries( instructionTypes.flatMap(type =>
                                                typeOperations[type].map(op => [`${type}.${op}`, false])
                                              )
                                            )
  }

  const procEditOptions = reactive(defaultOptions)

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(procEditOptions, JSON.parse(saved))
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(procEditOptions))
    } catch (error) {
      console.error('💻❌ Failed to save processor options:', error)
    }
  }


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
      blkSize:    MIN_CACHE_BLOCK_SIZE,
      mPenalty:   1,
      mIssueTime: 1,
      nFillBuffers: 2,
      nWriteBuffers: 2,
      rThru:      1,
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
  const bufferValidationMessage = ref('')
  const cacheTimingMessage = ref('')

  function validateCacheTiming() {
    if (!Number.isInteger(procConfig.mIssueTime) ||
        procConfig.mIssueTime < 1 || procConfig.mIssueTime > 99) {
      procConfig.mIssueTime = 1
      cacheTimingMessage.value = 'Miss Issue Time must be an integer from 1 to 99.'
      return
    }
    if (!Number.isInteger(procConfig.mPenalty) ||
        procConfig.mPenalty < 1 || procConfig.mPenalty > 99) {
      procConfig.mPenalty = procConfig.mIssueTime
      cacheTimingMessage.value = 'Miss Penalty must be an integer from 1 to 99.'
      return
    }
    if (procConfig.mPenalty < procConfig.mIssueTime) {
      procConfig.mPenalty = procConfig.mIssueTime
      cacheTimingMessage.value = 'Miss Penalty was raised to mIssueTime.'
      return
    }
    cacheTimingMessage.value = ''
  }

  function validateBufferCount(field, label) {
    const value = procConfig[field]
    if (Number.isInteger(value) && value >= 1 && value <= 32) {
      bufferValidationMessage.value = ''
      return
    }
    bufferValidationMessage.value = `${label} must be an integer from 1 to 32.`
    procConfig[field] = field === 'rThru' ? 1 : 2
  }

  const portList = computed(() =>
    Object.keys(procConfig.ports)
      .map(k => Number(k))
      .sort((a, b) => a - b)
  );

  const updateProcessorSettings = async (procInfo) => {
    try {
      Object.assign(procConfig, JSON.parse(JSON.stringify(procInfo)))   // deep copy & fire draw-update
      normalizeLatencyKeys(procConfig.latencies)                         // old "TYPE-OPER-size" keys
      procConfig.rThru = procInfo.rThru ?? 1
      if (!Number.isInteger(procConfig.mIssueTime) ||
          procConfig.mIssueTime < 1 || procConfig.mIssueTime > 99) {
        procConfig.mIssueTime = 1
      }
      if (!Number.isInteger(procConfig.mPenalty) ||
          procConfig.mPenalty < 1 || procConfig.mPenalty > 99) {
        procConfig.mPenalty = procConfig.mIssueTime
      }
      if (Number(procConfig.mPenalty) < Number(procConfig.mIssueTime)) {
        procConfig.mPenalty = Number(procConfig.mIssueTime)
        console.warn('💻⚠️ MissPenalty was raised to mIssueTime.')
      }
      if (Number.isFinite(procConfig.blkSize) && procConfig.blkSize < MIN_CACHE_BLOCK_SIZE) {
        console.warn(`💻⚠️ Cache block size ${procConfig.blkSize} is below the minimum; using ${MIN_CACHE_BLOCK_SIZE}.`)
        procConfig.blkSize = MIN_CACHE_BLOCK_SIZE
      }
      if (!Number.isInteger(procConfig.nFillBuffers) ||
          procConfig.nFillBuffers < 1 || procConfig.nFillBuffers > 32) {
        procConfig.nFillBuffers = 2
      }
      if (!Number.isInteger(procConfig.nWriteBuffers) ||
          procConfig.nWriteBuffers < 1 || procConfig.nWriteBuffers > 32) {
        procConfig.nWriteBuffers = 2
      }
      if (!Number.isInteger(procConfig.rThru) ||
          procConfig.rThru < 1 || procConfig.rThru > 32) {
        procConfig.rThru = 1
      }
      if (!procConfig.ports || typeof procConfig.ports !== 'object') {
        Object.assign(procConfig, createDefaultConfig())
        console.warn('💻⚠️ Invalid processor configuration: missing or malformed "ports" property. Resetting to default configuration.')
      }
    } catch(e) {
      console.error("💻❌ Failed to update processor settings:", e);
    }
  };

// ============================================================================
// WATCHES
// ============================================================================

  watch( [ () => procEditOptions.expandedTypes, () => procEditOptions.expandedOperations], () => {
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

  watchEffect(() => { // Dependences: re-evaluated when they change
    const fullscreen = props.isFullscreen;

    if (fullscreen) { // maybe edited program has changed
      nextTick(() => {
        seedDraftFromCurrentProcessor();
        loadEditedProcessor();
      })
    }
  })

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  onMounted(() => {
    loadOptions()
    loadEditedProcessor()
    console.log('💻🎯 Processor Editor Component mounted')
  });

  onUnmounted(() => {
    console.log('💻👋 Processor Editor Component unmounted')
    localStorage.removeItem('processorTemp')
  });

// ============================================================================
// PROCESSOR ACTIONS
// ============================================================================

  function loadEditedProcessor() {
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

  const drawEditedProcessor = async () => {
    console.log('💻🔄Redrawing edited processor');
    try {
      const dotCode   = get_processor_dot (procConfig, false, -1)
      const svg       = await createGraphVizGraph(dotCode);
      editedSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('💻❌ Failed to draw edited processor:', error)
      editedSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

// ============================================================================
// Processor Edition LOGIC:      addPort, removePort, toggleTypeExpand,
//    toggleTypeForPor, togglePortOperation, toggleScheduler, noPortAssigned
// ============================================================================

  function toggleTypeExpand(type) {
    procEditOptions.expandedTypes[type] = ! procEditOptions.expandedTypes[type];
  }

  function toggleOperationExpand(type, oper) {
    procEditOptions.expandedOperations[`${type}.${oper}`] = ! procEditOptions.expandedOperations[`${type}.${oper}`];
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
    ports.forEach(([, portArr], newIdx) => {
      procConfig.ports[newIdx] = portArr;
    });

    instructionTypes.forEach(type => {
      ensureTypeOperationsAssigned(type);
    });
  }

// ============================================================================
// confirmDownload, clearProcessor
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

  function clearProcessor() {
    updateProcessorSettings(createDefaultConfig())
    showModalClear.value = false;
  }

/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp1 = ref(false); const showHelp2 = ref(false); const showHelp3 = ref(false); const showHelp4 = ref(false);
  const helpIcon1 = ref(null);  const helpIcon2 = ref(null);  const helpIcon3 = ref(null);  const helpIcon4 = ref(null);
  const helpPosition = ref({ top: '10%', left: '20%' });

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
  <div>
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Processor Settings - Editor</span>
      </div>

      <div class="settings-container">
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

    <div class="settings-sections">
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
          <div class="cache-fields">
            <label class="cache-field">
              <span>Number of Blocks:</span>
              <input type="number" v-model.number="procConfig.nBlocks" min="0" max="32"
                   id="cache-blocks"
                   title="Memory blocks stored into cache (0 => no cache; up to 32)"/>
            </label>

            <span class="cache-field">
              <span>Block Size:</span>
              <span class="button-group">
                <button @click="procConfig.blkSize = Math.max(MIN_CACHE_BLOCK_SIZE, procConfig.blkSize / 2)">−</button>
                <input type="number" v-model.number="procConfig.blkSize" readonly
                     id="block-size"
                    min="4"
                    title="Size of Memory block: must be a power of two (4 to 128)"
                 />
                <button @click="procConfig.blkSize = Math.min(128, procConfig.blkSize * 2)">+</button>
              </span>
            </span>

            <label class="cache-field">
              <span>Miss Penalty:</span>
              <input type="number" v-model.number="procConfig.mPenalty" :min="procConfig.mIssueTime" max="99"
                   id="miss-penalty"
                   @change="validateCacheTiming"
                   title="Extra latency due to cache miss; must be at least Miss Issue Time"/>
            </label>

            <label class="cache-field">
              <span>Miss Issue Time:</span>
              <input type="number" v-model.number="procConfig.mIssueTime" min="1" max="99"
                   id="miss-issue-time"
                   @change="validateCacheTiming"
                   title="Minimum time between Memory accesses (1 to 99)"/>
            </label>

            <label class="cache-field">
              <span>Fill Buffers:</span>
              <input type="number" v-model.number="procConfig.nFillBuffers" min="1" max="32"
                   id="fill-buffer-count"
                   @change="validateBufferCount('nFillBuffers', 'Fill buffer count')"
                   title="Maximum number of distinct cache-block fills in progress (1 to 32)"/>
            </label>

            <label class="cache-field">
              <span>Write Buffers:</span>
              <input type="number" v-model.number="procConfig.nWriteBuffers" min="1" max="32"
                   id="write-buffer-count"
                   @change="validateBufferCount('nWriteBuffers', 'Write buffer count')"
                   title="Maximum number of dirty cache blocks waiting for Main Memory writes (1 to 32)"/>
            </label>

            <label class="cache-field">
              <span>Return Throughput:</span>
              <input type="number" v-model.number="procConfig.rThru" min="1" max="32"
                   id="return-throughput"
                   @change="validateBufferCount('rThru', 'Return throughput')"
                   title="Maximum number of cache-miss waiters served per cycle (1 to 32)"/>
            </label>

            <small v-if="cacheTimingMessage" class="validation-message">
              {{ cacheTimingMessage }}
            </small>
            <small v-if="bufferValidationMessage" class="validation-message">
              {{ bufferValidationMessage }}
            </small>
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
                          {{ procEditOptions.expandedTypes[type] ? '▼' : '▶' }}
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
                  <template v-if="hasOperations(type) && procEditOptions.expandedTypes[type]">
                  <template
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
                            {{ procEditOptions.expandedOperations[`${type}.${op}`] ? '▼' : '▶' }}
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
                        v-if="!procEditOptions.expandedOperations[`${type}.${op}`]"
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
                    <template v-if="procEditOptions.expandedOperations[`${type}.${op}`] && hasSizes(type)">
                    <tr
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
                          v-model.number="procConfig.latencies[`${type}.${op}.${size}`]"
                          min="1" max="99"
                          class="latency-input"
                          :id="`${type}-${op}-${size}-latency`"
                          :title="`Execution latency in clock cycles for ${type}.${op}.${size} (1 to 99)`" />
                      </td>
                      <td v-for="port in portList" :key="port" class="port-checkbox">
                        -
                      </td>
                    </tr>
                    </template>
                  </template>
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
    <HelpComponent v-if="showHelp1" :position="helpPosition"
    text="Modify the simulated processor’s <strong>configuration settings</strong>, including: (1) <em>Dispatch & Retire</em> widths;
      (2) <em>ROB</em> size; (3) <em>Cache Memory and miss buffers</em>; (4) <em>Execution Ports</em> (add or remove execution ports, up to a maximum of 10); and
      (5) <em>Execution Latencies</em>"
    title="Processor Settings"
    @close="closeHelp1"/>

    <HelpComponent v-if="showHelp2" :position="helpPosition"
    text="Modify the <strong>Dispatch</strong> and/or <strong>Retire</strong> widths.
       They indicate the maximum number of instructions per clock cycle that can be dispatched into or retired from the Execution Engine.
       They may impose a throughput-bound performace limit.
       <p>Modify the <strong>ROB</strong> (ReOrder Buffer) size, which indicates the maximum number of instructions simultaneously on the <strong>Execution Engine</strong>.
      This parameter limits the maximum instruction-level parallelism that can be exploited by the processor,
      and may impose (<strong><em>latency-bound</em></strong>) performance limits.</p>
      <p>The policy of the instruction scheduler may be set to <em>greedy</em> or <em>optimal</em>.
        A greedy scheduler always issues ready instructions in program order.
        An optimal scheduler always issues the best combination of ready instructions to maximize performance.</p>"
    title="Dispatch/Retire Width & ROB Settings. Instruction Scheduler Policy"
    @close="closeHelp2"/>

    <HelpComponent v-if="showHelp3" :position="helpPosition"
    text="Modify the <strong>Cache Memory</strong> settings. Setting a Number of Blocks = 0 means all data accesses
      will always hit in the cache, and, therefore, the latency of memory loads and stores is constant.
      <p>The cache miss latency indicates the extra time required to execute load and store instructions when they miss in the cache.
      The cache miss issue time (<strong>m</strong>) is the minimum time required to issue consecutive memory block read/write requests to the Main Memory.
      It determines the maximum Main Memory bandwidth (one memory block every <strong>m</strong> clock cycles).</p>
      <p><strong>Fill Buffers</strong> limit the number of distinct cache blocks being fetched. Misses to the same block share one fill.
      <strong>Write Buffers</strong> hold dirty blocks evicted while a fill waits for its writeback to finish. A fill waits when either buffer capacity is exhausted.
      Both capacities must be at least one.</p>
      <p><strong>Return Throughput</strong> sets how many LOAD/STORE instructions waiting on completed cache fills can receive data per cycle.
      They are served in program age order by an independent queue and do not pay their execution latency again. Its default is one instruction per cycle.</p>"
    title="Cache and Miss Buffer Settings"
    @close="closeHelp3"/>

  <HelpComponent v-if="showHelp4" :position="helpPosition"
    text="Modify the <strong>Latency</strong> and the maximum <strong>Execution Throughput</strong> of instruction types.
      <p>Each instruction type can be assigned a fixed execution latency and a set of eligible execution ports
         (only one is used for executing each instruction). A given execution port, named <em>Px</em>, can start executing one instruction every clock cycle.
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
  .validation-message {
    color: #a12622;
    grid-column: 2;
  }


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

  /* Cache settings: each label stays on one line next to its input; pairs wrap as a unit */
  .cache-fields {
    display:         flex;
    flex-wrap:       wrap;
    justify-content: center;
    align-items:     center;
    gap:             4px 14px;
    padding:         2px 6px;
  }
  .cache-field {
    display:     inline-flex;
    align-items: center;
    gap:         4px;
    white-space: nowrap;
  }
  .cache-field input {
    width:         34px;
    padding:       2px 4px;
    border:        1px solid #ccc;
    border-radius: 4px;
  }
  .cache-fields .validation-message {
    flex-basis: 100%;
    text-align: center;
  }

  .settings-group.latency-group .table-container {
    flex: 0 0 auto;
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

  /* The SVG scales with its container: cap the width so the text keeps a normal size */
  .processor-img {
    width:        100%;
    max-width:    36rem;
    margin:       0 auto;
  }

  .processor-img svg text {
    font-size:   12px;
    font-family: Arial, sans-serif;
  }

  .processor-img svg polygon,
  .processor-img svg path {
    stroke-width: 2px;
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
