<script setup>
  import { ref, computed, onMounted, onUnmounted, nextTick, inject, reactive, watch } from "vue"
  import HelpComponent                                     from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                                     from '@/rvcatAPI'
  import {  modalState, resourceConfig, openSaveModal, closeAllModals, validateResourceName,
          downloadJSON, uploadJSON, 
          loadFromLocalStorage, saveToLocalStorage, removeFromLocalStorage,
          initResource, createGraphVizGraph                                   } from '@/common'

  const { setProgram, showProgram } = useRVCAT_Api();
  const { registerHandler }         = inject('worker');
  const simState                    = inject('simulationState');

// Instruction type definitions with subtypes
const instructionTypes = {
  'INT': ['ARITH', 'LOGIC', 'SHIFT'],
  'BRANCH': [],
  'MEM': ['STR.SP', 'STR.DP', 'LOAD.SP', 'LOAD.DP', 'VLOAD', 'VSTR'],
  'FLOAT': ['ADD.SP', 'ADD.DP', 'MUL.SP', 'MUL.DP', 'FMA.SP', 'FMA.DP', 'DIV.SP', 'DIV.DP', 'SQRT.SP', 'SQRT.DP'],
  'VFLOAT': ['ADD', 'MUL', 'FMA', 'DIV']
};
  
  // Usando Composition API con setup
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
    availablePrograms: []
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

  const programOptions  = reactive({ ...defaultOptions, ...savedOptions })
  const programText     = ref('LOADING ...')

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
        text:     inst.text || '',
        type:     inst.type || '',
        mainType: mainType || '',
        subType:  subType || '',
        destin:   inst.destin || '',
        source1:  inst.source1 || '',
        source2:  inst.source2 || '',
        source3:  inst.source3 || '',
        constant: inst.constant || ''
      };
    });
    if (editedProgram.value.length === 0) addInstruction();
  } catch (e) {
    console.error('📄❌ Failed to load edited program from localStorage:', e);
  }
}

// ============================================================================
// Program handling: addInstruction, removeInstruction, moveInstructionUp, moveInstructionDown
//       onMainTypeChange, onSubTypeChange, getSubTypes, normalizeInstruction, snapshotProgram
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
// WATCHES: program, globalStat  HANDLERS: setProgram, showProgram
// ============================================================================
 const ADD_NEW_OPTION = '__add_new__'

  // Watch for program changes
  watch(() => programOptions.currentProgram, (newProgram, oldProgram) => {
    if (newProgram === ADD_NEW_OPTION)
      return uploadProgram(oldProgram)

    console.log(`📄✅ Program changed from "${oldProgram}" to "${newProgram}"`);
    saveOptions()
    if (simState.state > 1 && newProgram !== oldProgram)
      reloadProgram()
  });

  // Auto-save edits to localStorage
  watch(
    () => snapshotProgram(),
    (val) => {
      try {
        localStorage.setItem('programTemp', JSON.stringify(val));
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
    if (newValue != oldValue && simState.RVCAT_state > 2 && simState.selectedProgram != '') {
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
// PROGRAM ACTIONS: InitProgram, ReloadProgram
// ============================================================================
  let uploadedProgramObject = null
  
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
      programText.value = '❌ Failed to set program';
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

  // straightforward version: no modal
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
        saveToLocalStorage('program', data.name, uploadedProgramObject, programOptions.availablePrograms)
        programOptions.currentProgram = data.name;
        reloadProgram()
        return;
      }
    }
    programOptions.currentProgram = oldProgram;       
  } catch (error) {
    programOptions.currentProgram = oldProgram;
  }
};
  
// ============================================================================
// DownLoad / UpLoad + Modal logic
// ============================================================================
  const showModalUp = ref(false)
  const modalName   = ref("")
  let   nameOld     = ''
  const nameError   = ref("")
 
  const showSaveModal  = ref(false);
  const saveModalName  = ref('');
  const saveModalError = ref('');
  const saveToFile     = ref(true);

  // Change confirmation state (for load/clear when modified)
  const showChangeModal = ref(false);
  const pendingAction   = ref(null); // 'load' | 'clear'

  const uploadProgram2 = (oldProgram) => {
    uploadJSON((data) => {
      if (data) {
        uploadedProgramObject = data;
        modalName.value       = data.name;
        showModalUp.value     = true;
      }
      else
        programOptions.currentProgram = oldProgram;
    }, 'program');
  };

  function copySelected () {
    if (uploadedProgramObject) {
      localStorage.setItem('programTemp', JSON.stringify(uploadedProgramObject));
      loadEditedProgram()
    }
  }
  
  async function confirmModal() {
    const name = modalName.value.trim();
    if (programOptions.availablePrograms.includes(name)) {
      nameError.value = "A program with this name already exists. Please, choose another one.";
      return;
    }

    nameError.value   = "";
    uploadedProgramObject.name   = name;
    showModalUp.value            = false;
    saveToLocalStorage('program', name, uploadedProgramObject, programOptions.availablePrograms)
    programOptions.currentProgram = name;
    reloadProgram()
  }

  function cancelModal() {
    showModalUp.value = false;
    modalName.value   = "";
    nameError.value   = "";
    programOptions.currentProgram = oldProgram;
  }

function clearProgram() {
  editedProgram.value = [];
  addInstruction();
  showChangeModal.value = false;
}
  
function cancelClear() {
  showChangeModal.value = false;
  saveModalError.value = '';
}
  
// Handle clear with modification/unsaved check
function requestClearProgram() {
  pendingAction.value   = 'clear';
  showChangeModal.value = true;
}

function cancelSave() {
  showSaveModal.value = false;
  saveModalError.value = '';
}
 
async function proceedPendingAction() {
  if (pendingAction.value === 'load') {
    await performLoadProgram();
  } else if (pendingAction.value === 'clear') {
    clearProgram();
  } else if (pendingAction.value === 'upload') {
    uploadProgram(true);
  }
  showChangeModal.value = false;
  pendingAction.value   = null;
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
           <option value="__add_new__">Add new</option>
        </select>
        <button class="blue-button" @click="removeProgram" title="Remove program from list (and local storage)">
            Remove
        </button>
      </div>
    </div>
    
    <section v-if="!isFullscreen" class="main-box code-block"> <pre><code>{{ programText }}</code></pre> </section>
    
    <div v-if="isFullscreen" class="header fullscreen-header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program Editor</span>
      </div>
      
      <div class="settings-container fullscreen-settings">
        <div class="section-header">
          <button class="blue-button small add-btn" @click="addInstruction">+ Add Instruction</button>
        </div>
        <div class="buttons">
          <button class="blue-button" @click="downloadProgram"
               title="Save current edited program" 
               id="program-download-button"> 
            Download 
          </button>
          <button class="blue-button" @click="uploadProgram2"
               title="Load new program from file system for edition"     
               id="program-upload-button">  
            Upload  
          </button>
        </div>
        <div class="buttons">
          <button class="blue-button" @click="copySelected"
                title="Edit current selected program as new program" 
                id="edit-program-button">
            Edit selected
          </button>
          <button class="blue-button"   @click="requestClearProgram"
                title="Clear edition and start new program from scratch" 
                id="clear-program-button"
            >Clear</button>
        </div>
      </div>
    </div>

    <div v-if="isFullscreen" class="instructions-section">
      <div class="table-container">
        <table class="instructions-table">
          <thead>
            <tr>
              <th style="width: 20px;">#</th>
              <th style="width: 240px;">Text</th>
              <th style="width: 100px;">Type</th>
              <th style="width: 120px;">Subtype</th>
              <th style="width: 80px;">Destin</th>
              <th style="width: 80px;">Source1</th>
              <th style="width: 80px;">Source2</th>
              <th style="width: 80px;">Source3</th>
              <th style="width: 80px;">Constant</th>
              <th style="width: 100px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(inst, index) in editedProgram" :key="index">
              <td>{{ index }}</td>
              <td>
                <input type="text" v-model="inst.text" class="table-input" />
              </td>
              <td>
                <select v-model="inst.mainType" @change="onMainTypeChange(inst)" class="table-select">
                  <option value="">Select...</option>
                  <option v-for="type in Object.keys(instructionTypes)" :key="type" :value="type">
                    {{ type }}
                  </option>
                </select>
              </td>
              <td>
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
              <td>
                <input type="text" v-model="inst.destin" class="table-input" />
              </td>
              <td>
                <input type="text" v-model="inst.source1" class="table-input" />
              </td>
              <td>
                <input type="text" v-model="inst.source2" class="table-input" />
              </td>
              <td>
                <input type="text" v-model="inst.source3" class="table-input" />
              </td>
              <td>
                <input type="text" v-model="inst.constant" class="table-input" />
              </td>
              <td class="actions-cell">
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
  </div>
  
  <div v-if="showModalUp" class="modal-overlay">
    <div class="modal">
      <h4>Load Program As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" v-model="modalName" />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Accept Load" @click="confirmModal">Load</button>
        <button class="blue-button" title="Cancel Load" @click="cancelModal">Cancel</button>
      </div>
    </div>
  </div>

    <div v-if="showSaveModal" class="modal-overlay">
      <div class="modal">
        <h4>Save Program As</h4>
        <label for="save-name">Name:</label>
        <input id="save-name" type="text" v-model="saveModalName" />
        <label class="checkbox-row">
          <input type="checkbox" v-model="saveToFile" />
          <span>Save JSON file</span>
        </label>
        <div v-if="saveModalError" class="error">{{ saveModalError }}</div>
        <div class="modal-actions">
          <button class="blue-button" @click="confirmSave">Save</button>
          <button class="blue-button" @click="cancelSave">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="showChangeModal" class="modal-overlay">
      <div class="modal">
        <p>You may have unsaved changes. Do you want to continue?</p>
        <div class="modal-actions">
          <button class="blue-button" @click="clearProgram">Continue</button>
          <button class="blue-button" @click="showChangeModal = false">Cancel</button>
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

.instructions-section {
  flex:           1;
  display:        flex;
  flex-direction: column;
  overflow:       hidden;
}
  
#programs-list {
  font-size: larger;
}

.settings-container {
  display:     flex;
  align-items: center;
  gap:         10px;
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

.table-container {
  flex:          1;
  overflow:      auto;
  border:        1px solid #ddd;
  border-radius: 5px;
  margin-right:  2px;
  max-height:    2000px;
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

.add-btn {
  margin-right: 50px;
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

.form-select option[value="__add_new__"] {
  color:            #4a6cf7;
  font-weight:      bold;
  background-color: #f0f5ff;
}
  
</style>
