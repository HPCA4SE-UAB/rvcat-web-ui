<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, reactive, watch }           from "vue"
  import HelpComponent                                     from '@/components/helpComponent.vue'
  import { uploadJSON, initResource, saveToLocalStorage, removeFromLocalStorage, updateProcess
                                                                              }  from '@/common'
  const simState            = inject('simulationState');

  const props = defineProps({
    activeView: String
  })

// ============================================================================
// Program options & localStorage
// ============================================================================

const STORAGE_KEY = 'programOptions'

  const defaultOptions = {
    currentProgram:    '',
    availablePrograms: [],
    showLat:           true
  }

  const programOptions = reactive(defaultOptions)

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(programOptions, JSON.parse(saved))
        console.log('📄load options')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('📄default load options')
      }
    } catch (error) {
      console.error('📄❌ Failed to load:', error)
    }
  }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(programOptions))
    } catch (error) {
      console.error('📄❌ Failed to save:', error)
    }
  }

// ============================================================================
// WATCHES: program, globalStat  HANDLERS: setProgram, showProgram
// ============================================================================
 const ADD_NEW_OPTION = '_add_new_'

  // Watch for program changes
  watch(() => programOptions.currentProgram, (newProgram, oldProgram) => {
    if (newProgram === ADD_NEW_OPTION)
      return uploadProgram(oldProgram)

    console.log(`📄✅ Program changed from "${oldProgram}" to "${newProgram}"`);
    saveOptions()
    if (simState.state > 1)
      reloadProgram()
  })

  watch( () => [programOptions.showLat],
    () => { saveOptions() }
  )

  watch( () => simState.state, (newValue, oldValue) => {
      if (newValue === 2 && oldValue !== 2) {
        initProgram()
      }
    }
  )

  watch( () => simState.simulatedProcess, () => {
      if (simState.state > 2) {
        console.log('📄🔄 Refreshing program latencies & ports on simulated process');
        updateProcess(simState.simulatedProcess) // recompute instruction latencies & ports
      }
    },
    { deep: true, immediate: false }
  )

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================

  onMounted(() => {
    loadOptions()
    console.log('📄🎯 Program Component mounted')
  });

  onUnmounted(() => {
    console.log('📄👋 Program Component unmounted')
  });

// ============================================================================
// PROGRAM ACTIONS: load, edit, remove, toggle latency/ports, upload
// ============================================================================

  const initProgram = async () => {
    const savedProgram = programOptions.currentProgram
    await initResource('program', programOptions, 'currentProgram', 'availablePrograms')
    if (savedProgram === programOptions.currentProgram)
      reloadProgram()   // On initialization, if currentProgram not modified, force program reloading
  };

  const reloadProgram = async () => { // reload program data from localStorage to simState.simulatedProcess, and trigger next initialization step if we are in the right state
    console.log('📄🔄 Reloading program with:', programOptions.currentProgram);
    try {
      const jsonString = localStorage.getItem(`program.${programOptions.currentProgram}`)
      const data       = JSON.parse(jsonString)
      Object.assign(simState.simulatedProcess, data)
      if (simState.state == 2) {  // This is an initialization step
        simState.state = 3;       // Change to next initialization step
        console.log('📄✅ Initialization step (3): program loaded')
      }
    } catch (error) {
      console.error('📄❌ Failed to set program:', error)
    }
  }

  const emit = defineEmits(['requestSwitchFull'])

  function editProgram () { // switch to full-screen program editor, sending current program data for edition
    if (simState.simulatedProcess) {

      let cleanProgram = {
        name: simState.simulatedProcess.name,
        instruction_list: JSON.parse(
          JSON.stringify(simState.simulatedProcess.instruction_list)
        )
      }

      if (cleanProgram.instruction_list.length > 0)
        cleanProgram.instruction_list.pop()

      localStorage.setItem('programTemp', JSON.stringify(cleanProgram));
      emit('requestSwitchFull', 'program')
      console.log('📄 Emit requestSwitchFull for program edition:')
    }
  }

  function removeProgram () {
    removeFromLocalStorage('program', programOptions.currentProgram, programOptions.availablePrograms)
    if ( programOptions.availablePrograms.length > 0)
      programOptions.currentProgram = programOptions.availablePrograms[0]
    else {
      programOptions.currentProgram = ''
      alert("Removing all programs forces to load the original programs provided in the distribution")
      initProgram()
    }
  }

  function toggleLatency() { programOptions.showLat = !programOptions.showLat }

  function portsMaskToString(mask) {
    const ports = []
    let   i     = 0
    while (mask > 0) {
      if (mask & 1)
        ports.push(`P${i}`)
      mask >>= 1
      i++
    }
    return ports.join(',')
  }

  const uploadProgram = async (oldProgram) => {
    try {
      const data = await uploadJSON(null, 'program')
      if (data) {

        const exists = programOptions.availablePrograms.includes(data.name)
        if (exists && !confirm(`A program with the name "${data.name}" is already loaded. Do you want to overwrite it?`)) {
          alert('Upload cancelled.')
          programOptions.currentProgram = oldProgram
          return
        }
        // TODO: Check here if it is a valid program
        saveToLocalStorage('program', data.name, data, programOptions.availablePrograms)
        programOptions.currentProgram = data.name;
        Object.assign(simState.simulatedProcess, data)
        return
      }
    } catch (error) {
      console.error('📄❌ Failed to upload program:', error)
    }
    programOptions.currentProgram = oldProgram
  }

// ============================================================================
// Help support
// ============================================================================
  const showHelp     = ref(false);
  const helpPosition = ref({ top: '0%', left: '40%' });
  const helpIcon     = ref(null);

  function openHelp()  { nextTick(() => { showHelp.value = true }) }
  function closeHelp() { showHelp.value  = false }

  function percentageToColor(p) {
    if (p == null || isNaN(p)) return ''
    p = Math.max(0, Math.min(100, p))

    // Colores originales más saturados
    const r = Math.round(Math.min(255, (p / 50) * 255))
    const g = Math.round(p < 50 ? (p / 50) * 255 : ((100 - p) / 50) * 255)
    const b = Math.round(Math.max(0, (1 - p / 50) * 255))

    // Mezclar con blanco (70% color original, 30% blanco)
    const mixWhite = 0.7 // Ajusta este valor (mayor = más claro)
    const r2 = Math.round(r + (255 - r) * mixWhite)
    const g2 = Math.round(g + (255 - g) * mixWhite)
    const b2 = Math.round(b + (255 - b) * mixWhite)

    return `rgb(${r2}, ${g2}, ${b2})`
  }

  function rowStyle(index) {
    if (simState.executionResults == null || !simState.executionResults?.critical_path?.instructions)
      return {}
    const percentage = simState.executionResults?.critical_path?.instructions?.[index]?.percentage;
    if (percentage == null || isNaN(percentage))
      return {}
    return {
      backgroundColor: percentageToColor(percentage),
      color: percentage > 50 ? 'white' : 'black'
    }
  }

</script>

<template>
  <div>
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program</span>
      </div>

      <div class="settings-container">
        <button class="blue-button" :class="{ active: programOptions.showLat }"
            title="Toggle between showing latency & Ports / Instruction type"
            id="show-latports-operands"
          @click="toggleLatency">
          <span v-if="programOptions.showLat">✔ </span>
          latency
        </button>
        <select v-model="programOptions.currentProgram" class="form-select"
            id="programs-list" title="Select Program">
          <option value="" disabled>Select</option>
          <option v-for="program in programOptions.availablePrograms" :key="program" :value="program">
            {{ program }}
          </option>
           <option value="_add_new_">Add new</option>
        </select>
        <button class="blue-button small-btn" @click="editProgram"
            id="edit-program-button"
            title="Edit current program on full-screen editor">
          📝
        </button>
        <button class="blue-button small-btn" @click="removeProgram"
            id="remove-program-button"
            title="Remove program from list (and local storage)">
          🧹
        </button>
      </div>
    </div>

    <section class="main-box">
      <div class="table-container">
        <table class="instructions-table">
          <thead>
            <tr>
              <th style="width: 100px;">  #    </th>
              <th style="width: 600px;"> Inst </th>
              <th v-if="!programOptions.showLat"  style="width: 100px;"> Type </th>
              <th v-if="!programOptions.showLat"  style="width: 100px;"> Oper </th>
              <th v-if="!programOptions.showLat"  style="width: 100px;"> Size </th>
              <th v-if="programOptions.showLat"   style="width: 100px;"> Lat </th>
              <th v-if="programOptions.showLat"   style="width: 200px;"> Ports </th>
            </tr>
          </thead>
          <tbody v-if="simState.simulatedProcess !== null">
            <tr
              v-for="(inst, index) in simState.simulatedProcess.instruction_list"
              :key="index"
              :style="activeView === 'simulationComponent' ? rowStyle(index) : {}"
              :class="{ highlighted: index === simState.instrHighlightedIdx }"
            >
              <td title="Instruction Number/Percentage of time aggregated to in critical path">
                <section v-if="activeView === 'simulationComponent' && simState.executionResults?.critical_path?.instructions?.[index]?.percentage != null">
                  {{ simState.executionResults.critical_path.instructions[index].percentage.toFixed(0) }}%
                </section>
                <section v-else>
                 {{ index }}
                </section>
              </td>

              <td title="Instruction description">
                 {{ inst.text }}
              </td>
              <td v-if="!programOptions.showLat" title="Instruction type">
                {{ inst.type }}
              </td>
              <td v-if="!programOptions.showLat" title="Operation type">
                {{ inst.oper }}
              </td>
              <td v-if="!programOptions.showLat" title="Operation size">
                {{ inst.size}}
              </td>
              <td v-if="programOptions.showLat" title="Latency">
                {{ inst.latency }}
              </td>
              <td v-if="programOptions.showLat" title="Available execution ports">
                {{ portsMaskToString(inst.ports) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    text="The simulated program consists of a <em>fixed-iteration</em> loop executing a sequence of <strong>machine instructions</strong>, each described in a high-level,
       informal language. The <em>type</em>, execution <em>latency</em> and eligible <em>execution ports</em> are shown for each instruction.
        <p>The simulation tracks <strong>data dependencies</strong> but omits detailed architectural state: it <strong>does not</strong> model processor registers, memory states,
      branch outcomes, or memory dependencies (e.g., store-load interactions).</p>
        Programs can be edited/uploaded/downloaded in JSON format."
      title="Program Description"
    @close="closeHelp"  />
  </Teleport>
</template>

<style scoped>
  .main-box {
    overflow:      auto;
    scroll-behavior: smooth;
    margin-top:    0px;
    background:    #f0f0f0;
    padding:       0px;
    font-size:     2.0vh;
    border-radius: 10px;
  }

  ::-webkit-scrollbar {
    width: 5px;
  }

  .settings-container {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1;
    justify-content: center;
  }
  .table-container {
     width:          auto;
     max-width:      100%;
     overflow-x:     auto;
     overflow-y:     auto;
     padding-bottom: 37px; /* move container and see it completely */
     border:         1px solid #ddd;
     border-radius:  5px;
     margin-right:   2px;
  }

  .instructions-table {
    width:           100%;
    border-collapse: collapse;
    font-size:       small;
    padding-bottom: 30px; /* permite mover el contenedor y verlo completo */
  }
  .instructions-table thead {
    position:   sticky;
    top:        0;
    background: #007acc;
    color:      white;
    z-index:    1;
  }
  .instructions-table th {
    padding:     3px 3px;
    text-align:  center;
    font-weight: bold;
    border:      1px solid #005a9e;
  }
  .instructions-table td {
    padding:        1px;
    border:         1px solid #ddd;
    vertical-align: middle;
    text-align:     center;
    font-size:      medium;
  }
  .instructions-table tbody tr:nth-child(even) {
    background: #f9f9f9;
  }
  .instructions-table tbody tr:hover {
    background: #e8f4fd;
  }

  .action-btn {
    padding:       1px 4px;
    margin:        0 1px;
    border:        1px solid #ccc;
    background:    white;
    border-radius: 8px;
    cursor:        pointer;
    font-size:     medium;
  }
  .action-btn:hover:not(:disabled) {
    background:   #e8f4fd;
    border-color: #007acc;
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor:  not-allowed;
  }
  .action-btn.delete {
    color:   #d32f2f;
  }
  .action-btn.delete:hover:not(:disabled) {
    background:   #ffebee;
    border-color: #d32f2f;
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

  .highlighted {
    background-color: rgba(255, 0, 0, 0.15);
    transition:       background-color 0.05s linear;
    outline:          2px solid red;
  }
  tr:hover {
    background-color: rgba(0,0,0,0.05);
  }
</style>
