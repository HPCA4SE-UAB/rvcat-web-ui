<script setup>
  import { t } from '@/i18n'
  import { ref, watch, onMounted, onUnmounted, nextTick, inject, computed, reactive } from 'vue'
  import HelpComponent                                                  from '@/components/helpComponent.vue'
  import CacheConfigWindow                                              from '@/components/CacheConfigWindow.vue'
  import ProcessorDiagram                                               from '@/components/ProcessorDiagram.vue'
  import { uploadJSON, downloadJSON, saveToLocalStorage, removeFromLocalStorage, initResource,
           resourceUsage }                                                              from '@/common'
  import { processorDraftFrom, processorSignature }                                     from '@/editDrafts'
  import { uiLocked }                                                                   from '@/authorMode'

  const simState = inject('simulationState');

  // ---- Lessons: only the processors of the lesson, and its locks ----
  const visibleProcessors = computed(() => simState.lesson ? simState.lesson.processors : processorOptions.availableProcessors)
  const locked = (what) => uiLocked(simState.lesson, what, simState.lessonAllow ?? [])
  const editLocked = computed(() => ['dispatch', 'retire', 'rob', 'cache', 'bPenalty', 'ports', 'latencies']
    .every(f => locked(`processor.${f}`)))

// ============================================================================
// Processor options & localStorage
// ============================================================================

  const STORAGE_KEY = 'processorOptions'

  const defaultOptions = {
    processorName:       '',
    availableProcessors: [],
  }

  const processorOptions = reactive(defaultOptions)

  // ---- The panel can be folded to its header and a summary line (more room for the program).
  //      A card of a lesson can forbid unfolding it or folding it ("lock": ["processorPanel"]) ----
  const foldLocked = computed(() => !!simState.lesson && (simState.lessonLock ?? []).includes('processorPanel'))
  watch(() => simState.processorFolded, (v) => {
    try { localStorage.setItem('processorFolded', v ? '1' : '0') } catch { /* storage not available */ }
  })
  const processorSummary = computed(() => {
    const p = simState.simulatedProcess
    if (!p) return ''
    const parts = [
      `dispatch ${p.dispatch}`, `retire ${p.retire}`, `ROB ${p.ROBsize}`,
      t('{n} ports', { n: Object.keys(p.ports ?? {}).length }),
      Number(p.nBlocks) > 0 ? t('cache {n}×{b} B', { n: p.nBlocks, b: p.blkSize }) : t('no cache'),
      t('branch penalty {n}', { n: p.bPenalty ?? 5 }),
    ]
    return parts.join(' · ')
  })
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

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  onMounted(() => {
    loadOptions()
    console.log('💻🎯 Processor Component mounted')
  });

  onUnmounted(() => {
    console.log('💻👋 Processor Component unmounted')
  });

// ============================================================================
// PROCESSOR ACTIONS: initProcessor, reloadProcessor, editProcessor, removeProcessor,
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
    } catch (error) {
      console.error('💻❌ Failed to set processor:', error)
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
    if (!Number.isInteger(data.nStoreBuffers) || data.nStoreBuffers < 1 || data.nStoreBuffers > 256)
      data.nStoreBuffers = 16
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

  // ports pointed in the timeline: one port (highlightedPort) or a list (highlightedPorts)
  const highlightedPorts = computed(() => (simState.highlightedPorts?.length ? simState.highlightedPorts
    : [simState.highlightedPort].filter(x => x !== null && x !== undefined && x !== -1)).map(String))

  // ---- Window of the cache: every parameter, checked; the simulator waits until it is closed ----
  const showCacheWindow = ref(false)
  const cacheConfig = computed(() => {
    const p = simState.simulatedProcess ?? {}
    return { nBlocks: p.nBlocks ?? 0, blkSize: p.blkSize ?? 64, mPenalty: p.mPenalty ?? 10, mIssueTime: p.mIssueTime ?? 1,
             nFillBuffers: p.nFillBuffers ?? 2, nWriteBuffers: p.nWriteBuffers ?? 2, rThru: p.rThru ?? 1,
             nStoreBuffers: p.nStoreBuffers ?? 16 }
  })
  function applyCache(values) {
    Object.assign(simState.simulatedProcess, values)
    showCacheWindow.value = false
  }

  // Usage of the resources in the last simulation (valid for the current processor and program:
  // the results are cleared when something changes), unless the lesson hides it
  // Usage of the resources in the last simulation (valid for the current processor and program:
  // the results are cleared when something changes), unless the lesson hides it
  const shownUsage = computed(() => simState.lesson?.hidden?.includes('usage') ? null
    : resourceUsage(simState.simulatedProcess, simState.executionResults))

  // Reload the current processor (its stored version may have changed: lessons)
  // (a processor that is no longer stored, e.g. one of a lesson that ended, is selected again by the caller)
  watch(() => simState.reloadNonce, () => {
    if (simState.state > 1 && localStorage.getItem(`processor.${processorOptions.processorName}`)) reloadProcessor()
  })

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
  // another panel asks for the help of the cache (the timeline): it opens at its section
  watch(() => simState.helpRequest?.nonce, () => {
    if (simState.helpRequest?.topic !== 'cache') return
    openHelp()
    setTimeout(() => {
      const section = document.getElementById('help-cache')
      if (!section) return
      section.open = true
      section.scrollIntoView({ block: 'start' })
    }, 200)
  })

</script>

<template>
  <div class="header processor-part">
      <div class="section-title-and-info">
        <button v-if="!foldLocked" class="fold-toggle" id="processor-fold-toggle"
                :aria-expanded="!simState.processorFolded"
                :title="simState.processorFolded ? t('Show the diagram of the processor') : t('Fold the processor to one line: more room for the program')"
                @click="simState.processorFolded = !simState.processorFolded">{{ simState.processorFolded ? '▸' : '▾' }}</button>
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
        <button v-if="!editLocked && !locked('processorSave')" class="blue-button small-btn" @click="openSave"
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
        🗑
        </button>
      </div>
  </div>

  <div v-if="simState.processorFolded" class="processor-summary processor-part" id="processor-summary"
       :title="t('Folded processor. Unfold it (▸) to see its diagram and, after a simulation, the usage of each resource')">
    {{ processorSummary }}
  </div>
  <div v-show="!simState.processorFolded" class="graph-section processor-part">
    <div class="processor-container">
      <ProcessorDiagram v-if="simState.simulatedProcess?.ports" :process="simState.simulatedProcess" :usage="shownUsage"
                        :highlight-ports="highlightedPorts" :stage="simState.highlightedStage ?? ''" :locked="locked"
                        :in-lesson="!!simState.lesson" @open-cache="showCacheWindow = true" />
    </div>
  </div>

  <CacheConfigWindow v-if="showCacheWindow" :config="cacheConfig"
                     :instruction-list="simState.simulatedProcess?.instruction_list ?? []"
                     :ports="simState.simulatedProcess?.ports ?? {}"
                     @apply="applyCache" @cancel="showCacheWindow = false" />

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
    border-radius: 4px; box-sizing: border-box; font-size: 0.875rem;
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

  .fold-toggle {
    border: none; background: none; padding: 0 4px 0 0; margin: 0; cursor: pointer;
    font-size: 0.9rem; color: #1a4fb3; line-height: 1;
  }
  .fold-toggle:hover { color: #0b2e5c; }
  .processor-summary {
    margin: 2px 4px 6px; padding: 3px 8px; border-radius: 4px; background: #eef2f7;
    font-size: 0.8rem; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
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
    font-size:        1rem;
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
    font-size:   0.875rem;
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
