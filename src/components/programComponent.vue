<script setup>
  import { ref, toRef, toRaw, onMounted, onUnmounted, nextTick, inject, reactive, watch }  from "vue"
  import { useDraggable, useResizeObserver}                                       from '@vueuse/core'
  import HelpComponent                                          from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                                           from '@/rvcatAPI'
  import { downloadJSON, uploadJSON, initResource, createGraphVizGraph,
           saveToLocalStorage, removeFromLocalStorage, updateProcess,
           instructionTypes, typeOperations, typeSizes                             }  from '@/common'

  const { getProgGraph }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  const props = defineProps({
    isFullscreen: {
      type:    Boolean,
      default: false
    },
    activeView: String
  })

// ============================================================================
// Program options & localStorage
// ============================================================================

const STORAGE_KEY = 'programOptions'

  const defaultOptions = {
    currentProgram:    '',
    availablePrograms: [],
    showInOut:         true,
    showActions:       true,
    showGraph:         false,
    showLat:           true,
    windowWidth:       500,
    windowHeight:      300,
    x_pos:             10,
    y_pos:             10,
    visibleCols: {
      text:     true,
      type:     true,
      oper:     true,
      size:     true,
      name:     true,
      pattern:  true
    }
  }

  const savedOptions = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      console.log('📄load options')
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const programOptions = reactive({ ...defaultOptions, ...savedOptions })
  const programSvg     = ref('')
  const showFullScreen = ref(false)
  let   graphTimeout   = null

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(programOptions))
    } catch (error) {
      console.error('📄❌ Failed to save:', error)
    }
  }

// ============================================================================
// Draggable & resizable full-screen graph container
// ============================================================================

  const HEADER_HEIGHT = 48
  const MIN_W = 200
  const MIN_H = 200

  const headerRef  = ref(null)
  const contentRef = ref(null)

  const x = toRef(programOptions, 'x_pos')
  const y = toRef(programOptions, 'y_pos')

  const { isDragging } = useDraggable(headerRef, {
    initialValue: { x: programOptions.x_pos, y: programOptions.y_pos },

    onMove(pos) {

      const w = programOptions.windowWidth
      const h = programOptions.windowHeight

      const maxX = window.innerWidth  - w
      const maxY = window.innerHeight - HEADER_HEIGHT

      x.value = Math.min(Math.max(pos.x, 0), maxX)
      y.value = Math.min(Math.max(pos.y, 0), maxY)
    }
  })

  useResizeObserver(contentRef, (entries) => {
    const { width: w, height: h } = entries[0].contentRect

    const maxWidth  = window.innerWidth  - programOptions.x_pos
    const maxHeight = window.innerHeight - programOptions.y_pos

    programOptions.windowWidth  = Math.max(MIN_W, Math.min(w, maxWidth))
    programOptions.windowHeight = Math.max(MIN_H, Math.min(h, maxHeight))
  })

  window.addEventListener("resize", () => {

    const w = programOptions.windowWidth
    const h = programOptions.windowHeight

    x.value = Math.min(x.value, window.innerWidth - w)
    y.value = Math.min(y.value, window.innerHeight - HEADER_HEIGHT)
  })

// ============================================================================
// Temporal in-edition program
// ============================================================================

const editedProgram = ref([]);
const editedMemory  = ref([]);

function loadEditedProgram() {
  const stored = localStorage.getItem('programTemp');
  if (!stored) return;
  try {
    const data = JSON.parse(stored);
    editedProgram.value = (data.instruction_list || []).map(inst => {
      return {
        text:    inst.text    || '', type:    inst.type    || '',  oper:     inst.oper     || '',
        size:    inst.size    || '', destin:  inst.destin  || '',  source1:  inst.source1  || '',
        source2: inst.source2 || '', source3: inst.source3 || '',  constant: inst.constant || '',
        percentage: null
      };
    });
  } catch (e) {
    console.error('📄❌ Failed to load edited program from localStorage:', e);
  }
}

function loadEditedMemory() {
  const stored = localStorage.getItem('memoryTemp');
  if (!stored) return;
  try {
    const data = JSON.parse(stored);
    editedMemory.value = (data.memory_list || []).map(mem => {
      return {
        name:    mem.name || '',    pattern:    mem.pattern    || ''
      };
    });
  } catch (e) {
    console.error('📄❌ Failed to load edited memory from localStorage:', e);
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

  watch( () => [programOptions.showInOut, programOptions.showActions, programOptions.showGraph,
           programOptions.showLat,   programOptions.windowWidth, programOptions.windowHeight],
    () => { saveOptions() }
  )

  watch( () => snapshotProgram(), (val) => {
      try {
        localStorage.setItem('programTemp', JSON.stringify(val));
        console.log('📄✅ Saved edited program')
      } catch (e) {
        console.error('📄❌ Failed to persist program to localStorage:', e);
      }
    },
    { deep: true }
  )

  watch( () => snapshotMemory(), (val) => {
      try {
        localStorage.setItem('memoryTemp', JSON.stringify(val));
        console.log('📄✅ Saved edited memory')
      } catch (e) {
        console.error('📄❌ Failed to persist memory to localStorage:', e);
      }
    },
    { deep: true }
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
        simState.programName = programOptions.currentProgram
      }
    },
    { deep: true, immediate: false }
  )

  watch( () => simState.executionResults, () => {
    if (simState.state > 2)
      updateCriticalInfo()
  },
  { deep: true, immediate: true })

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleGraph= null

  onMounted(() => {
    console.log('📄🎯 ProgramComponent mounted')
    cleanupHandleGraph = registerHandler('get_prog_graph', handleGraph);
    loadEditedProgram()
    loadEditedMemory()
  });

  onUnmounted(() => {
    if (cleanupHandleGraph) {
       cleanupHandleGraph();
       cleanupHandleGraph= null
    }
    console.log('📄👋 ProgramComponent unmounted')
    localStorage.removeItem('programTemp')
  });


// ============================================================================
// PROGRAM ACTIONS: InitProgram, reloadProgram, editProgram, removeProgram,
//               uploadForEdition
// ============================================================================

  const initProgram = async () => {
    const savedProgram = programOptions.currentProgram
    await initResource('program', programOptions, 'currentProgram', 'availablePrograms')
    if (savedProgram === programOptions.currentProgram)
      reloadProgram()   // On initialization, if currentProgram not modified, force program reloading
  };

  const reloadProgram = async () => {
    console.log('📄🔄 Reloading program with:', programOptions.currentProgram);
    try {
      const jsonString = localStorage.getItem(`program.${programOptions.currentProgram}`)
      const data       = JSON.parse(jsonString)
      Object.assign(simState.simulatedProcess, data)
      simState.programName  = programOptions.currentProgram;  // fire other components
      if (simState.state == 2) {  // This is an initialization step
        simState.state = 3;       // Change to next initialization step
        console.log('📄✅ Initialization step (3): program loaded')
      }
    } catch (error) {
      console.error('📄❌ Failed to set program:', error)
    }
  }

  const emit = defineEmits(['requestSwitchFull'])

  function editProgram () {
    if (simState.simulatedProcess) {

      const cleanProgram = {
        name: simState.simulatedProcess.name,
        instruction_list: JSON.parse(
          JSON.stringify(simState.simulatedProcess.instruction_list)
        )
      }

      localStorage.setItem('programTemp', JSON.stringify(cleanProgram));
      loadEditedProgram()
      if (editedProgram.value.length > 0)
        editedProgram.value.pop()
      localStorage.setItem('programTemp', JSON.stringify(editedProgram.value));
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

  const uploadForEdition = async () => {
    try {
      const data = await uploadJSON(null, 'program');
      if (data) {
        // TODO: Check here if it is a valid program
        localStorage.setItem('programTemp', JSON.stringify(data));
        loadEditedProgram()
        if (editedProgram.value.length > 0)
          editedProgram.value.pop()
        localStorage.setItem('programTemp', JSON.stringify(editedProgram.value));
      }
    } catch (error) {
      console.error('📄❌ Failed to upload program for edition:', error)
    }
  };

// ============================================================================
// Program handling:
//        addInstruction,       removeInstruction,
//        moveInstructionUp,    moveInstructionDown,
//        normalizeInstruction, snapshotProgram,
//        normalizeMemory,      snapshotMemory
// ============================================================================

// Add just at index position
function addInstruction( index ) {
  editedProgram.value.splice( index, 0, {
      text:    '',
      type:    '',
      oper:    '',
      size:    '',
      destin:  '',
      source1: '',
      source2: '',
      source3: '',
      constant: '',
      percentage: null
    }
  );
}

function removeInstruction(index) {
  if (editedProgram.value.length > 1) {
    editedProgram.value.splice(index, 1);
  }
}

function moveInstructionUp(index) {
  if (index > 0) {
    const temp = editedProgram.value[index];
    editedProgram.value[index]     = editedProgram.value[index - 1];
    editedProgram.value[index - 1] = temp;
  }
}

function moveInstructionDown(index) {
  if (index < editedProgram.value.length - 1) {
    const temp = editedProgram.value[index];
    editedProgram.value[index]     = editedProgram.value[index + 1];
    editedProgram.value[index + 1] = temp;
  }
}

function normalizeInstruction(inst) {
  return {
    text:     (inst.text     || '').trim(),
    type:     (inst.type     || '').trim(),
    oper:     (inst.oper     || '').trim(),
    size:     (inst.size     || '').trim(),
    destin:   (inst.destin   || '').trim(),
    source1:  (inst.source1  || '').trim(),
    source2:  (inst.source2  || '').trim(),
    source3:  (inst.source3  || '').trim(),
    constant: (inst.constant || '').trim(),
    percentage: inst.percentage
  };
}

function snapshotProgram() {
  return {
    name:             'programTemp',
    instruction_list: editedProgram.value.map(inst => normalizeInstruction(inst))
  };
}

function normalizeMemory(mem) {
  return {
    name:     (mem.name    || '').trim(),
    pattern:  (mem.pattern || '').trim()
  };
}

function snapshotMemory() {
  return {
    name:       'memoryTemp',
    memory_list: editedMemory.value.map(mem => normalizeMemory(mem))
  };
}

// ============================================================================
// viewColumns
// ============================================================================

  function toggleInOut  () { programOptions.showInOut   = !programOptions.showInOut }
  function toggleActions() { programOptions.showActions = !programOptions.showActions }
  function toggleLatency() { programOptions.showLat     = !programOptions.showLat }

  // Handler for 'get_prog_graph' message (fired by RVCAT getProgGraph function)
  const handleGraph = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('📄❌Failed to get dependence graph:', data);
      return;
    }
    try {
       const svg        = await createGraphVizGraph(data);
       programSvg.value = svg.outerHTML;
       console.log('📄✅ generate dependence graph of edited program')
    } catch (error) {
      console.error('📄❌Failed to generate SVG for graphviz Dependence Graph:', error)
      programSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function updateCriticalInfo() {
    const res = simState.executionResults?.critical_path?.instructions
    const instr_list = simState.simulatedProcess?.instruction_list

    if (!instr_list) return

    if (!res) {
      instr_list.forEach((inst, index) => {
        delete inst.percentage
      })
      return
    }

    const resMap = new Map(res.map(r => [r.id, r.percentage]))

    instr_list.forEach((inst, index) => {
      inst.percentage = (resMap.get(index) ?? 0).toFixed(0)
    })
  }

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

  function openFullScreen() {
    showFullScreen.value = true;
    console.log('📄🔄Drawing edited program');
    clearTimeout(graphTimeout)
    try {
      graphTimeout = setTimeout(() => {

        editedProgram.value.push( {
          text:    'if c go back',
          type:    'BRANCH',
          oper:    '',
          size:    '',
          destin:  '',
          source1: 'c',
          source2: '',
          source3: '',
          constant: ''
        } );

        getProgGraph(
          JSON.stringify( toRaw(editedProgram.value), null, 2),
          1, true, false, false, true
        )
        editedProgram.value.pop()
      }, 75)
      console.log('📄✅ Graph drawn')
      programOptions.showGraph = true
    } catch (error) {
      console.error('📄❌Failed to generate program graph:', error)
    }
  }

  function closeFullScreen()   { showFullScreen.value = false;  programOptions.showGraph = false}

// ============================================================================
// confirmDownload, uploadProgram, clearProgram
// ============================================================================
  const showModalDownload = ref(false)
  const showModalClear    = ref(false);
  const modalName         = ref("")
  const nameError         = ref("")

  async function confirmDownload() {
    const name   = modalName.value.trim();
    const stored = localStorage.getItem('programTemp');
    if (stored) {
      const data = JSON.parse(stored)
      data.name = name
      data.instruction_list.push( {
        text:    'if c go back',
        type:    'BRANCH',
        oper:    '',
        size:    '',
        destin:  '',
        source1: 'c',
        source2: '',
        source3: '',
        constant: ''
      } );
      await downloadJSON(data, name, 'program')
    }
    showModalDownload.value = false;
  }

  const uploadProgram = async (oldProgram) => {
    try {
      const data = await uploadJSON(null, 'program');
      if (data) {
        if (programOptions.availablePrograms.includes(data.name)) {
          if (confirm(`A program with name: "${data.name}" has been already loaded.`)) {
            saveToLocalStorage('program', data.name, data, programOptions.availablePrograms)
            programOptions.currentProgram = data.name;
            Object.assign(simState.simulatedProcess, data)
            return;
          }
        }
        else {
          // TODO: Check here if it is a valid program
          saveToLocalStorage('program', data.name, data, programOptions.availablePrograms)
          programOptions.currentProgram = data.name;
          Object.assign(simState.simulatedProcess, data)
          return;
        }
      }
      programOptions.currentProgram = oldProgram;
    } catch (error) {
      programOptions.currentProgram = oldProgram;
    }
  };

  function clearProgram() {
    editedProgram.value  = [];
    editedMemory.value   = [];
    showModalClear.value = false;
    addInstruction(0);
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

  function rowStyle(inst) {
    return {
      backgroundColor: percentageToColor(inst.percentage),
      color: inst.percentage > 50 ? 'white' : 'black'
    }
  }

</script>

<template>
  <div class="main">

    <div v-if="!isFullscreen" class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program</span>
      </div>

      <div class="settings-container">
        <button class="blue-button add-prev-margin" :class="{ active: programOptions.showLat }"
            title="Show/Hide instruction Input/Output operands"
            id="show-inout-operands"
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
        <!--
        <button class="blue-button small-btn" @click="editProgram"
            id="edit-program-button"
            title="Edit current program on full-screen as a new program">
          📝
        </button>
        <button class="blue-button small-btn" @click="removeProgram"
            id="remove-program-button"
            title="Remove program from list (and local storage)">
          🧹
        </button>
        -->
      </div>
    </div>

    <section v-if="!isFullscreen" class="main-box">
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
              :style="activeView === 'simulationComponent' ? rowStyle(inst) : {}"
              :class="{ highlighted: index === simState.instrHighlightedIdx }"
            >
              <td>
                <section v-if="activeView === 'simulationComponent' && inst?.percentage != null">
                  {{ inst.percentage }}%
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

    <div v-if="isFullscreen" class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Program Editor</span>
      </div>

      <button class="blue-button add-prev-margin" :class="{ active: programOptions.showInOut }"
          title="Show/Hide instruction Input/Output operands"
          id="show-inout-operands"
        @click="toggleInOut">
        <span v-if="programOptions.showInOut">✔ </span>
        InOut
      </button>

      <button class="blue-button add-margin" :class="{ active: programOptions.showActions }"
          title="Show/Hide column with buttons for moving/adding/removing instructions"
          id="show-instruction-actions"
          @click="toggleActions">
        <span v-if="programOptions.showActions">✔ </span>
        Actions
      </button>

      <button class="blue-button add-prev-margin" :class="{ active: programOptions.showGraph }"
          title="View/Update program's dependence graph on full-screen"
          id="open-edited-program-graph"
          @click="openFullScreen">
        <span v-if="programOptions.showGraph">✔ </span>
        View Graph
      </button>

      <div class="settings-container fullscreen-settings">
        <div class="buttons">
          <button class="blue-button" @click="showModalDownload = true"
               title="Save current edited program"
               id="program-download-button">
            Download
          </button>
          <button class="blue-button" @click="uploadForEdition"
               title="Load new program from file system for edition"
               id="program-upload-button">
            Upload
          </button>
        </div>
        <div class="buttons">
          <button class="blue-button  add-margin" @click="showModalClear = true"
                title="Clear edition and start new program from scratch"
                id="clear-program-button">
            Clear
          </button>

        </div>
      </div>
    </div>

    <div v-if="isFullscreen" class="instructions-section">
      <div class="horizontal-layout">

        <div class="instruction-side-container">

          <div class="table-container">
            <table class="instructions-table">
              <thead>
                <tr>
                  <th style="width: 20px;">  # </th>
                  <th v-if="programOptions.visibleCols.text"     style="width: 600px;"> Text    </th>
                  <th v-if="programOptions.visibleCols.type"     style="width: 100px;"> Type    </th>
                  <th v-if="programOptions.visibleCols.oper"     style="width: 100px;"> Oper    </th>
                  <th v-if="programOptions.visibleCols.size"     style="width: 100px;"> Size    </th>
                  <th v-if="programOptions.showInOut"   style="width: 80px;">  Destin  </th>
                  <th v-if="programOptions.showInOut"   style="width: 80px;">  Source1 </th>
                  <th v-if="programOptions.showInOut"   style="width: 80px;">  Source2 </th>
                  <th v-if="programOptions.showInOut"   style="width: 80px;">  Source3 </th>
                  <th v-if="programOptions.showInOut"   style="width: 80px;">  Constant</th>
                  <th v-if="programOptions.showActions" style="width: 100px;"> Actions </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(inst, index) in editedProgram" :key="index">
                  <td>{{ index }}</td>

                  <td v-if="programOptions.visibleCols.text">
                    <input type="text" v-model="inst.text" class="table-input" title="Free text describing instruction" />
                  </td>

                  <td v-if="programOptions.visibleCols.type">
                    <select v-model="inst.type" class="table-select" title="Select instruction type">
                      <option value="">Select...</option>
                      <option v-for="type in instructionTypes" :key="type" :value="type">
                        {{ type }}
                      </option>
                    </select>
                  </td>

                  <td v-if="programOptions.visibleCols.oper">
                    <select v-model="inst.oper" :disabled="!inst.type || typeOperations[inst.type].length === 0"
                      class="table-select" title="Select operation for this type"
                    >
                      <option value="">Select...</option>
                      <option
                        v-for="operation in typeOperations[inst.type]"
                        :key="operation"
                        :value="operation"
                      >
                        {{ operation }}
                      </option>
                    </select>
                  </td>

                  <td v-if="programOptions.visibleCols.size">
                    <select v-model="inst.size" :disabled="!inst.type || !inst.oper || typeSizes[inst.type].length === 0"
                      class="table-select" title="Select size for this instruction type & operations"
                    >
                      <option value="">Select...</option>
                      <option
                        v-for="size in typeSizes[inst.type]"
                        :key="size"
                        :value="size"
                      >
                        {{ size }}
                      </option>
                    </select>
                  </td>

                  <td v-if="programOptions.showInOut">
                    <input type="text" v-model="inst.destin" class="table-input" />
                  </td>

                  <td v-if="programOptions.showInOut">
                    <input type="text" v-model="inst.source1" class="table-input" />
                  </td>

                  <td v-if="programOptions.showInOut">
                    <input type="text" v-model="inst.source2" class="table-input" />
                  </td>

                  <td v-if="programOptions.showInOut">
                    <input type="text" v-model="inst.source3" class="table-input" />
                  </td>

                  <td v-if="programOptions.showInOut">
                    <input type="text" v-model="inst.constant" class="table-input" />
                  </td>

                  <td v-if="programOptions.showActions" class="actions-cell">

                    <button
                      @click="moveInstructionUp(index)"
                      :disabled="index === 0"
                      class="action-btn"
                      title="Move up"
                    >
                      ▲
                    </button>

                    <button
                      @click="moveInstructionDown(index)"
                      :disabled="index === editedProgram.length - 1"
                      class="action-btn"
                      title="Move down"
                    >
                      ▼
                    </button>

                    <button
                      @click="removeInstruction(index)"
                      :disabled="editedProgram.length === 1"
                      class="action-btn delete"
                      title="Delete"
                    >
                      ✕
                    </button>

                    <button
                      @click="addInstruction(index)"
                      :disabled="editedProgram.length === 1"
                      class="action-btn"
                      title="Insert new instruction before this one"
                    >
                      ▶️
                    </button>

                  </td>
                </tr>

                <!-- 🔒 Fila fija final -->
                <tr class="fixed-row">
                  <td> {{editedProgram.length}} </td>

                  <td v-if="programOptions.visibleCols.text" title="This final conditional branch is fixed">
                    <span class="table-input readonly">if c go back</span>
                  </td>

                  <td v-if="programOptions.visibleCols.type">
                    <span class="table-select readonly">BRANCH</span>
                  </td>

                  <td v-if="programOptions.visibleCols.oper">
                    <span class="table-select readonly"> </span>
                  </td>

                  <td v-if="programOptions.visibleCols.size">
                    <span class="table-select readonly"> </span>
                  </td>

                  <td v-if="programOptions.showInOut">
                    <span class="table-input readonly"> </span>
                  </td>

                  <td v-if="programOptions.showInOut">
                    <span class="table-input readonly">c</span>
                  </td>

                  <td v-if="programOptions.showInOut">
                    <span class="table-input readonly"> </span>
                  </td>

                  <td v-if="programOptions.showInOut">
                    <span class="table-input readonly"> </span>
                  </td>

                  <td v-if="programOptions.showInOut">
                    <span class="table-input readonly"> </span>
                  </td>

                  <td v-if="programOptions.showActions" class="actions-cell">
                    <span class="table-input readonly"> 🔒 </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="memory-side-container">

          <div class="table-container">
            <table class="instructions-table">
              <thead>
                <tr>
                  <th v-if="programOptions.visibleCols.name"     style="width: 60px;">  Name </th>
                  <th v-if="programOptions.visibleCols.pattern"  style="width: 200px;"> Memory Pattern </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(mem, index) in editedMemory" :key="index">

                  <td v-if="programOptions.visibleCols.name"
                      title="Memory array name">
                    <input type="text" v-model="mem.name" class="table-input" />
                  </td>
                  <td v-if="programOptions.visibleCols.pattern"
                      title="Memory access pattern for this array">
                    <input type="text" v-model="mem.pattern" class="table-input" />
                  </td>

                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  </div>

  <div v-if="showFullScreen && isFullscreen" class="fullscreen-overlay" @click.self="closeFullScreen">
    <div
      class="fullscreen-content"
      ref="contentRef"
      :style="{
        left: x + 'px',
        top: y + 'px',
        width: programOptions.windowWidth + 'px',
        height: programOptions.windowHeight + 'px'
      }"
    >
      <div class="fullscreen-header" ref="headerRef">
        <span>Dependence Graph of Edited program (circular paths in red)</span>
        <button class="close-btn" @click="closeFullScreen">×</button>
      </div>
      <div class="graph-container">
        <div class="graph-wrapper"
            v-if="programSvg" v-html="programSvg">
        </div>
      </div>
    </div>
  </div>

  <div v-if="showModalDownload" class="modal-overlay">
    <div class="modal">
      <h4>Save Program As</h4>
      <label for="config-name">Name:</label>
      <input id="save-program-name" type="text" v-model="modalName"
          title="file name of new program" />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Accept Download" @click="confirmDownload">Save</button>
        <button class="blue-button" title="Cancel Upload"   @click="showModalDownload=false">Cancel</button>
      </div>
    </div>
  </div>

  <div v-if="showModalClear" class="modal-overlay">
    <div class="modal">
      <p>You may have unsaved changes. Do you want to clear current edited program?</p>
      <div class="modal-actions">
        <button class="blue-button" title="Yes, clear!" @click="clearProgram">Continue</button>
        <button class="blue-button" title="No, cancel!" @click="showModalClear = false">Cancel</button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    text="The simulated program consists of a <em>fixed-iteration</em> loop executing a sequence of <strong>machine instructions</strong>, each described in a high-level,
       informal language. The <em>type</em>, execution <em>latency</em> and eligible <em>execution ports</em> are shown for each instruction.
        <p>The simulation tracks <strong>data dependencies</strong> but omits detailed architectural state: it <strong>does not</strong> model processor registers, memory states,
      branch outcomes, or memory dependencies (e.g., store-load interactions).</p>
        Programs can be uploaded or downloaded in JSON format."
      title="Program Loop"
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

  .horizontal-layout {
    display:     flex;
    gap:         6px; /* Espacio entre tabla e imagen */
    margin-top:  2px;
    align-items: stretch;
    height:      auto;
  }

  .instructions-section {
    flex:           1;
    display:        flex;
    flex-direction: column;
    overflow:       hidden;
  }

  .settings-container {
    display:     flex;
    align-items: center;
    gap:         3px;
  }

  .fullscreen-settings {
    display:     flex;
    align-items: center;
    gap:         10px;
  }

  .section-header {
    display:         flex;
    justify-content: space-between;
    align-items:     center;
    margin-bottom:   2px;
    margin-right:    20px;
  }
  .section-header h4 {
    margin: 0;
    color:  #333;
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

  .table-input,
  .table-select {
    width:      100%;
    padding:    2px 4px;
    border:     1px solid #ccc;
    font-size:  medium;
    box-sizing: border-box;
    text-align: center;
    border-radius: 3px;
  }
  .table-select:disabled {
    background: #f0f0f0;
    cursor:     not-allowed;
  }

  .actions-cell {
    text-align:  center;
    white-space: nowrap;
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

  .readonly {
    display:    inline-block;
    width:      100%;
    padding:    4px 6px;
    box-sizing: border-box;
    color:      #555;
  }

  .fixed-row .actions-cell {
    pointer-events: none;
    opacity:        0.4;
  }
  .fixed-row {
    font-weight: bold;
    color:       #0b2e5c; /* azul oscuro */
  }
  .fixed-row .table-input,
  .fixed-row .table-select,
  .fixed-row .readonly {
    color:       inherit;
    font-weight: inherit;
  }

  .add-margin {
    margin-right: 50px;
  }
  .add-prev-margin {
    margin-left: 100px;
  }

  .modal-overlay {
    position: fixed;
    top:      0;
    left:     0;
    width:    100%;
    height:   100%;
    display:  flex;
    z-index:  1000;
    background:      rgba(0, 0, 0, 0.5);
    justify-content: center;
    align-items:     center;
  }
  .modal {
    background:    white;
    padding:       25px;
    border-radius: 8px;
    box-shadow:    0 4px 20px rgba(0, 0, 0, 0.3);
    min-width:     400px;
  }
  .modal input {
    width:         100%;
    padding:       8px;
    margin-bottom: 10px;
    border:        1px solid #ccc;
    border-radius: 4px;
    box-sizing:    border-box;
    font-size:     14px;
  }
  .modal-actions {
    display:         flex;
    justify-content: flex-end;
    gap:             10px;
    margin-top:      20px;
  }
  .modal h4 {
    margin: 0 0 15px 0;
    color:  #007acc;
  }
  .modal label {
    display:       block;
    margin-bottom: 5px;
    font-weight:   bold;
  }

  .checkbox-row {
    display:     flex;
    align-items: center;
    gap:         8px;
    margin:      10px 0;
    font-weight: normal;
  }
  .checkbox-row input[type="checkbox"] {
    width:  16px;
    height: 16px;
  }

  .error {
    color:         #d32f2f;
    font-size:     13px;
    margin-bottom: 10px;
    padding:       8px;
    background:    #ffebee;
    border-radius: 4px;
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

  .instruction-side-container {
    display:        flex;
    min-width:      0;
    box-sizing:     border-box;
    flex-direction: column;
    align-items:    center;
    border:         1px solid #ccc;
    border-radius:  8px;
    padding:        0.3rem;
    background:     #fafafa;
    flex:           1 1 70%;
  }

  .memory-side-container {
    flex:       1 1 30%;
    min-width:  0;
    box-sizing: border-box;
    display:    flex;
    padding:    3px;
    flex-direction: column;
    border:        1px solid #ddd;
    background:    #f8f9fa;
    border-radius: 8px;
  }

  .instruction-side-container .table-container,
  .memory-side-container      .table-container {
    flex: 0 0 auto;
  }

  .fullscreen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent; /* Sin fondo para no ocultar nada */
    pointer-events: none; /* Permite clicks a través del overlay */
    z-index: 999;
  }
  .fullscreen-content {
    position: fixed;
    background: white;
    border: 1px solid #ccc;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
    min-width: 400px;
    min-height: 300px;
    width: 800px; /* Tamaño fijo inicial */
    height: 600px;
    resize: both;
    overflow: auto;
    pointer-events: auto; /* IMPORTANTE: el contenido puede recibir clicks */
    z-index: 1000;
  }
  .fullscreen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #2c3e50;
    color: white;
    font-weight: 600;
    border-radius: 8px 8px 0 0;
    cursor: grab;
    user-select: none;
    flex-shrink: 0; /* Evita que el header se encoja */
  }
  .fullscreen-header:active {
    cursor: grabbing;
  }
  .fullscreen-header span {
    flex: 1;
    text-align: center;
  }

  .close-btn {
    background: none;
    border: none;
    color: white;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0 8px;
    opacity: 0.8;
  }
  .close-btn:hover {
    opacity: 1;
  }

  .graph-container {
    flex: 1;
    padding: 10px;
    overflow: hidden;
    background: #f8f9fa;
    min-height: 0;
  }

  .graph-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .graph-wrapper svg {
    width: 100%;
    height: 100%;
    width: auto;
    height: auto;
    display: block;
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
