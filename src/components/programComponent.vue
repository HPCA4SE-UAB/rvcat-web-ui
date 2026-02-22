<script setup>
  import { ref, computed, onMounted, onUnmounted, nextTick, inject, reactive, watch } from "vue"
  import HelpComponent                                     from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                                     from '@/rvcatAPI'
  import {  modalState, resourceConfig, openSaveModal, closeAllModals, validateResourceName,
          downloadJSON, uploadJSON, 
          loadFromLocalStorage, saveToLocalStorage, removeFromLocalStorage,
          initResource, createGraphVizGraph                                   } from '@/common'

  const { getDependenceGraph, setProgram, showProgram } = useRVCAT_Api();
  const { registerHandler }         = inject('worker');
  const simState                    = inject('simulationState');

  // Instruction type definitions with subtypes
  const instructionTypes = {
    'BRANCH': [],
    'INT':    ['ARITH', 'LOGIC', 'SHIFT'],
    'VINT':   ['ARITH', 'LOGIC', 'SHIFT'],
    'MEM':    ['STR.SP', 'STR.DP', 'LOAD.SP', 'LOAD.DP'],
    'VMEM':   ['STR.SP', 'STR.DP', 'LOAD.SP', 'LOAD.DP'],
    'FLOAT':  ['ADD.SP', 'ADD.DP', 'MUL.SP', 'MUL.DP', 'FMA.SP', 'FMA.DP',
               'DIV.SP', 'DIV.DP', 'SQRT.SP', 'SQRT.DP'],
    'VFLOAT': ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT']
  };
  
  const props = defineProps({
    isFullscreen: {
      type: Boolean,
      default: false
    }
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
    visibleCols: {
      index:    true,
      text:     true,
      type:     true,
      subtype:  true,
      destin:   true,
      source1:  true,
      source2:  true,
      source3:  true,
      constant: true,
      actions:  true
    }
  }

  let uploadedProgramObject = null

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
  const programText    = ref('LOADING ...')
  const programSvg     = ref('')
  const showFullScreen = ref(false);
  let graphTimeout     = null

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(programOptions))
    } catch (error) {
      console.error('📄❌ Failed to save:', error)
    }
  }


// ============================================================================
// Temporal in-edition program 
// ============================================================================

const editedProgram = ref([]);

function loadEditedProgram() {
  const stored = localStorage.getItem('programTemp');
  if (!stored) return;
  try {
    const data = JSON.parse(stored);
    editedProgram.value = (data.instruction_list || []).map(inst => {
      const [mainType, ...subTypeParts] = (inst.type || '').split('.');
      const subType = subTypeParts.join('.');
      return {
        text:     inst.text || '',    type:  inst.type || '',   mainType: mainType || '',   subType:  subType || '',
        destin:   inst.destin || '',  source1:  inst.source1 || '',  source2:  inst.source2 || '',   source3:  inst.source3 || '',
        constant: inst.constant || ''
      };
    });
    if (editedProgram.value.length === 0) addInstruction();
  } catch (e) {
    console.error('📄❌ Failed to load edited program from localStorage:', e);
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
  });

  watch(
    () => [programOptions.showInOut, programOptions.showActions],
    () => { saveOptions() }
  )

  // Auto-save edits to localStorage
  watch(
    () => snapshotProgram(),
    (val) => {
      try {
        localStorage.setItem('programTemp', JSON.stringify(val));
        console.log('📄✅ Saved edited program')
      } catch (e) {
        console.error('📄❌ Failed to persist program to localStorage:', e);
      }
    },
    { deep: true }
  );

  // Watch for changes on RVCAT state
  watch(() => simState.state, (newValue, oldValue) => {
    if (newValue == 2)   // This is an initialization step
       initProgram()  // --> generates reloadProgram
  });
  
  // Watch for changes on processor configuration
  watch(() => simState.selectedProcessor, (newValue, oldValue) => {
    if (simState.state > 2 && simState.selectedProgram != '') {
      console.log('📄🔄 Refreshing program visualization...');
      showProgram()
    }
  });
  
   // Handler for 'set_program' message (fired by this component)
  const handleSetProgram = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('📄❌ Failed to set program:', data);
      return;
    }
    try {    
      simState.selectedProgram = programOptions.currentProgram;  // fire other components, watching for a change
      if (simState.state == 2) {  // This is an initialization step
        simState.state = 3;       // Change to next initialization step
        console.log('📄✅ Initialization step (3): program provided to RVCAT')
      } 
      if (simState.selectedProgram != '')
        showProgram()  // obtain text from RVCAT API (id= 'show_program')
      
    } catch (error) {
      console.error('📄❌ Failed to set program:', error)
    }
  }

   // Handler for 'show_program' message (fired by this component)
  const handleShowProgram = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('📄❌ Failed to show program:', data)
      return;
    }
    try {
      programText.value = data
        console.log('📄🔄 Program visualization updated');
    } catch (error) {
      console.error('📄❌ Failed to show program:', error)
    }
  }

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleSet  = null
  let cleanupHandleShow = null

  onMounted(() => {
    console.log('📄🎯 ProgramComponent mounted')
    cleanupHandleSet = registerHandler('set_program',  handleSetProgram)
    cleanupHandleShow= registerHandler('show_program', handleShowProgram)
    loadEditedProgram()
  });

  onUnmounted(() => {
    if (cleanupHandleSet) {
      cleanupHandleSet()
      cleanupHandleShow()
      cleanupHandleSet = null
      cleanupHandleShow= null
  }
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
      const jsonString      = localStorage.getItem(`program.${programOptions.currentProgram}`)
      uploadedProgramObject = JSON.parse(jsonString)
      setProgram( jsonString ) // Call Python RVCAT to load new program --> id= 'set-program'
    } catch (error) {
      console.error('📄❌ Failed to set program:', error)
    }      
  }

  const emit = defineEmits(['requestSwitchFull']) 

  function editProgram () {
    if (uploadedProgramObject) {
      localStorage.setItem('programTemp', JSON.stringify(uploadedProgramObject));
      loadEditedProgram()
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

// UpLOAD from Edition Panel: straightforward version (no modal)
const uploadForEdition = async () => { 
  try {
    const data = await uploadJSON(null, 'program');
    if (data) {
      // TODO: Check here if it is a valid program
      localStorage.setItem('programTemp', JSON.stringify(data));
      loadEditedProgram()
    }
  } catch (error) {
    console.error('📄❌ Failed to upload program for edition:', error)
  }
};

// ============================================================================
// Program handling: addInstruction, removeInstruction, 
//        moveInstructionUp, moveInstructionDown,
//        onMainTypeChange, onSubTypeChange, getSubTypes, 
//        normalizeInstruction, snapshotProgram
// ============================================================================

// Initialize with empty instruction
function addInstruction() {
  editedProgram.value.push({
    text: '',
    type: '',
    mainType: '',
    subType: '',
    destin: '',
    source1: '',
    source2: '',
    source3: '',
    constant: ''
  });
}

function removeInstruction(index) {
  if (editedProgram.value.length > 1) {
    editedProgram.value.splice(index, 1);
  }
}

function moveInstructionUp(index) {
  if (index > 0) {
    const temp = editedProgram.value[index];
    editedProgram.value[index] = editedProgram.value[index - 1];
    editedProgram.value[index - 1] = temp;
  }
}

function moveInstructionDown(index) {
  if (index < editedProgram.value.length - 1) {
    const temp = editedProgram.value[index];
    editedProgram.value[index] = editedProgram.value[index + 1];
    editedProgram.value[index + 1] = temp;
  }
}

// Handle type selection
function onMainTypeChange(instruction) {
  instruction.subType = '';
  // If the type has no subtypes (like BRANCH), set type directly
  const subtypes = getSubTypes(instruction.mainType);
  if (instruction.mainType && subtypes.length === 0) {
    instruction.type = instruction.mainType;
  } else {
    instruction.type = '';
  }
}

function onSubTypeChange(instruction) {
  if (instruction.mainType && instruction.subType) {
    instruction.type = `${instruction.mainType}.${instruction.subType}`;
  } else if (instruction.mainType) {
    // Subtype was cleared, clear the full type too
    instruction.type = '';
  }
}

// Get subtypes for selected main type
function getSubTypes(mainType) {
  return instructionTypes[mainType] || [];
}

function normalizeInstruction(inst) {
  return {
    text:     (inst.text || '').trim(),
    type:     (inst.type || '').trim(),
    mainType: (inst.mainType || '').trim(),
    subType:  (inst.subType || '').trim(),
    destin:   (inst.destin || '').trim(),
    source1:  (inst.source1 || '').trim(),
    source2:  (inst.source2 || '').trim(),
    source3:  (inst.source3 || '').trim(),
    constant: (inst.constant || '').trim()
  };
}

function snapshotProgram() {
  return {
    name:             'programTemp',
    instruction_list: editedProgram.value.map(inst => normalizeInstruction(inst))
  };
}


// ============================================================================
// viewColumns
// ============================================================================

  function toggleInOut  () { 
    programOptions.showInOut           = !programOptions.showInOut
    programOptions.visibleCols.destin  = !programOptions.visibleCols.destin
    programOptions.visibleCols.source1 = !programOptions.visibleCols.source1
    programOptions.visibleCols.source2 = !programOptions.visibleCols.source2
    programOptions.visibleCols.source3 = !programOptions.visibleCols.source3
    programOptions.visibleCols.constant= !programOptions.visibleCols.constant
  }

  function toggleActions() { 
    programOptions.showActions         = !programOptions.showActions
    programOptions.visibleCols.actions = !programOptions.visibleCols.actions   
  }

  // Handler for 'get_dependence_graph' message (fired by RVCAT getDependenceGraph function)
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


  function openFullScreen() {
    showFullScreen.value = true;
    console.log('📄🔄Drawing edited program');
    clearTimeout(graphTimeout)
    getDependenceGraph( 1, true, false, true, true )
  }

  function closeFullScreen()   { showFullScreen.value = false;  }


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
      await downloadJSON(data, name, 'program')
    }
    showModalDownload.value = false;
  }
 
  const uploadProgram = async (oldProgram) => {  
    try {
      const data = await uploadJSON(null, 'program');
      if (data) {
        if (programOptions.availablePrograms.includes(data.name)) {
          alert(`A program with name: "${data.name}" has been already loaded.`)
        }
        else {
          // TODO: Check here if it is a valid program
          uploadedProgramObject = data
          saveToLocalStorage('program', data.name, uploadedProgramObject, 
                                        programOptions.availablePrograms)
          programOptions.currentProgram = data.name;
          return;
        }
      }
      programOptions.currentProgram = oldProgram;       
    } catch (error) {
      programOptions.currentProgram = oldProgram;
    }
  };

  function clearProgram() {
    editedProgram.value = [];
    addInstruction();
    showModalClear.value = false;
  }

  

// ============================================================================
// Help support 
// ============================================================================
  const showHelp     = ref(false);
  const helpPosition = ref({ top: '0%', left: '40%' });
  const helpIcon     = ref(null);

  function openHelp()  { nextTick(() => { showHelp.value = true }) }
  function closeHelp() { showHelp.value  = false }

</script>

<template>
  <div class="main">
    
    <div v-if="!isFullscreen" class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program</span>
      </div>
      
      <div class="settings-container">
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
            title="Edit current program on full-screen as a new program">
          📝
        </button>
        <button class="blue-button small-btn" @click="removeProgram"
            id="remove-program-button"
            title="Remove program from list (and local storage)">
          🧹
        </button>
      </div>
    </div>
    
    <section v-if="!isFullscreen" class="main-box code-block"> <pre><code>{{ programText }}</code></pre> </section>
    
    <div v-if="isFullscreen" class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program Editor</span>
      </div>
      
      <div class="settings-container fullscreen-settings">
        <div class="section-header">

          <button class="blue-button add-margin" @click="addInstruction"
              title="Add new instruction at the end of program" 
              id="add-instruction-button">
            + Add Instruction
          </button>

          <button class="blue-button" :class="{ active: programOptions.showInOut }"  
              title="Show/Hide instruction Input/Output operands"
              id="show-inout-operands"
            @click="toggleInOut"> 
            <span v-if="programOptions.showInOut">✔ </span>
            InOut
          </button>

          <button class="blue-button add-margin" :class="{ active: programOptions.showActions }"  
              title="Show/Hide column for instruction actions"
              id="show-instruction-actions"
            @click="toggleActions"> 
            <span v-if="programOptions.showActions">✔ </span>
            Actions
          </button>

          <button class="icon-button" @click="openFullScreen" 
             title="Open fullscreen"
             id="open-full-dependence-graph"
            >
             <img src="/img/fullscreen.png" class="bt-img">
          </button>


        </div>
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

          <button class="blue-button"   @click="showModalClear = true"
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
                  <th v-if="programOptions.visibleCols.index"    style="width: 20px;">  #        </th>
                  <th v-if="programOptions.visibleCols.text"     style="width: 240px;"> Text     </th>
                  <th v-if="programOptions.visibleCols.type"     style="width: 100px;"> Type     </th>
                  <th v-if="programOptions.visibleCols.subtype"  style="width: 120px;"> Subtype  </th>
                  <th v-if="programOptions.visibleCols.destin"   style="width: 80px;">  Destin   </th>
                  <th v-if="programOptions.visibleCols.source1"  style="width: 80px;">  Source1  </th>
                  <th v-if="programOptions.visibleCols.source2"  style="width: 80px;">  Source2  </th>
                  <th v-if="programOptions.visibleCols.source3"  style="width: 80px;">  Source3  </th>
                  <th v-if="programOptions.visibleCols.constant" style="width: 80px;">  Constant </th>
                  <th v-if="programOptions.visibleCols.actions"  style="width: 100px;"> Actions  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(inst, index) in editedProgram" :key="index">
                  <td v-if="programOptions.visibleCols.index">{{ index }}</td>

                  <td v-if="programOptions.visibleCols.text">
                    <input type="text" v-model="inst.text" class="table-input" />
                  </td>

                  <td v-if="programOptions.visibleCols.type">
                    <select v-model="inst.mainType" @change="onMainTypeChange(inst)" class="table-select">
                      <option value="">Select...</option>
                      <option v-for="type in Object.keys(instructionTypes)" :key="type" :value="type">
                        {{ type }}
                      </option>
                    </select>
                  </td>

                  <td v-if="programOptions.visibleCols.subtype">
                    <select 
                      v-model="inst.subType" 
                      @change="onSubTypeChange(inst)" 
                      :disabled="!inst.mainType || getSubTypes(inst.mainType).length === 0"
                      class="table-select"
                    >
                      <option value="">Select...</option>
                      <option 
                        v-for="subtype in getSubTypes(inst.mainType)" 
                        :key="subtype" 
                        :value="subtype"
                      >
                        {{ subtype }}
                      </option>
                    </select>
                  </td>

                  <td v-if="programOptions.visibleCols.destin">
                    <input type="text" v-model="inst.destin" class="table-input" />
                  </td>

                  <td v-if="programOptions.visibleCols.source1">
                    <input type="text" v-model="inst.source1" class="table-input" />
                  </td>

                  <td v-if="programOptions.visibleCols.source2">
                    <input type="text" v-model="inst.source2" class="table-input" />
                  </td>

                  <td v-if="programOptions.visibleCols.source3">
                    <input type="text" v-model="inst.source3" class="table-input" />
                  </td>

                  <td v-if="programOptions.visibleCols.constant">
                    <input type="text" v-model="inst.constant" class="table-input" />
                  </td>

                  <td v-if="programOptions.visibleCols.actions" class="actions-cell">
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
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="program-side-container">

          <div class="table-container">
            <table class="instructions-table">
              <thead>
                <tr>
                  <th v-if="programOptions.visibleCols.index"  style="width: 20px;">  #    </th>
                  <th v-if="programOptions.visibleCols.text"   style="width: 240px;"> Text </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(inst, index) in editedProgram" :key="index">

                  <td v-if="programOptions.visibleCols.index">{{ index }}</td>

                  <td v-if="programOptions.visibleCols.text">
                    <input type="text" v-model="inst.text" class="table-input" />
                  </td>

                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  </div>

  <div v-if="showFullScreen" class="fullscreen-overlay" @click.self="closeFullScreen">
    <div class="fullscreen-content">
      <div class="fullscreen-header">
        <span>Data Dependence Graph (circular paths in red)</span>
        <button class="close-btn" @click="closeFullScreen">×</button>
      </div>
      <div class="graph-container">
        <div class="graph-wrapper" ref="graphContainer">
          <div v-html="programSvg" v-if="programSvg" class="svg-content"></div>
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
  margin-top:    5px;
  background:    #f0f0f0;
  padding:       5px;
  font-size:     2.2vh;
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
  display: flex;
  justify-content: space-between;
  align-items:   center;
  margin-bottom: 2px;
  margin-right:  20px;
}

.section-header h4 {
  margin: 0;
  color: #333;
}

/*
.table-container {
  flex:          1;
  overflow:      auto;
  border:        1px solid #ddd;
  border-radius: 5px;
  margin-right:  2px;
  max-height:    2000px;
}*/

  .table-container {
     width:      auto; /* Se ajusta al contenido */
     max-width:  100%; /* Pero no más ancho que el contenedor */
     overflow-x: auto; /* Scroll si es necesario */
     overflow-y: auto; /* Scroll vertical si es necesario */
     padding-bottom: 30px; /* permite mover el contenedor y verlo completo */
     border:        1px solid #ddd;
     border-radius: 5px;
     margin-right:  2px;
  }



.instructions-table {
  width:           100%;
  border-collapse: collapse;
  font-size:       small;
}

.instructions-table thead {
  position: sticky;
  top: 0;
  background: #007acc;
  color: white;
  z-index: 1;
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
  text-align: center;
  font-size:  medium;
}

.instructions-table tbody tr:nth-child(even) {
  background: #f9f9f9;
}

.instructions-table tbody tr:hover {
  background: #e8f4fd;
}

.table-input,
.table-select {
  width:   100%;
  padding: 2px 4px;
  border:  1px solid #ccc;
  border-radius: 3px;
  font-size:  medium;
  box-sizing: border-box;
  text-align: center;
}

.table-select:disabled {
  background: #f0f0f0;
  cursor: not-allowed;
}

.actions-cell {
  text-align: center;
  white-space: nowrap;
}

.action-btn {
  padding: 1px 8px;
  margin: 0 2px;
  border: 1px solid #ccc;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-size: medium;
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

.add-margin {
  margin-right: 20px;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal {
  background: white;
  padding: 25px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 400px;
}

.modal h4 {
  margin: 0 0 15px 0;
  color: #007acc;
}

.modal label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  font-weight: normal;
}

.checkbox-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
}

.modal input {
  width: 100%;
  padding: 8px;
  margin-bottom: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 14px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.error {
  color: #d32f2f;
  font-size: 13px;
  margin-bottom: 10px;
  padding: 8px;
  background: #ffebee;
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
    flex:           1 1 45%;
  }
  
  /* Para que la tabla no se expanda más allá de lo necesario */
  .instruction-side-container .table-container {
    flex: 0 0 auto; /* No crece, se ajusta al contenido */
  }

 .program-side-container {
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

  .fullscreen-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .fullscreen-content {
    background: white;
    margin:     10px;
    padding:    10px;
    border:     1px solid #ccc;
    width:      95%;
    height:     95%;
    resize:     both;
    overflow:   auto;
    min-width:  300px;
    min-height: 200px;
    max-width:  99%;
    max-height: 99%;
    display:    flex;
    border-radius:  8px;
    flex-direction: column;
    box-shadow:     0 4px 12px rgba(0,0,0,0.25);
  }
 
  .fullscreen-content .close-btn {
    align-self: flex-end;
    background: none;
    border:     none;
    font-size:  3vh;
    cursor:     pointer;
    margin-bottom: 8px;
  }
  
  .fullscreen-header {
    display:         flex;
    justify-content: space-between;
    align-items:     center;
    margin-bottom:   10px;
    background: #2c3e50;
    color: white;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 1;
  }

 .fullscreen-title {
    font-size:   1.5rem;
    font-weight: 600;
    margin:      0;
  }

  .close-btn {
    background:  none;
    border:      none;
    font-size:   1.5em;
    line-height: 1;
    cursor:      pointer;
    padding:     4px;
  }

.graph-container {
  flex: 1;
  overflow: auto;
  padding: 10px;
}

.graph-wrapper {
  width: 100%;
  height: 100%;
  min-height: 200px;
}

.graph-wrapper svg {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: block;
}

  .icon-button {
    border:      none;
    cursor:      pointer;
    padding:     6px;
    display:     inline-flex;
    align-items: center;
    background:  #b0b0b0;
    transition:  background 0.2s;
    justify-content: center;
    border-radius:   6px;
    margin-left:     auto;
  }
  .icon-button img,
  .icon-button svg {
    width:  1.2em;
    height: 1.2em;
  }
  .icon-button:hover {
    background: #a0a0a0;      /* darker at hover */  
  }
  .icon-button:active {
    background: #909090;      /* still darker */
  }
  .icon-button:focus {
    outline:        2px solid #1a4fb3;  /* keypad */
    outline-offset: 2px;
  }

  .btn-img {
    height:2.5vh;
  }

</style>
