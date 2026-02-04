<script setup>
  import { ref, computed, onMounted, onUnmounted, nextTick, inject, reactive, watch } from "vue";
  import HelpComponent  from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

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
const programName  = ref('');
const instructions = ref([]);
const originalProgramName = ref('');
const originalProgram     = ref({ name: '', instruction_list: [] });

function loadFromLocalStorage() {
  const stored = localStorage.getItem('program_temp');
  if (!stored) return;
  try {
    const data = JSON.parse(stored);
    programName.value         = data.name || '';
    originalProgramName.value = programName.value;
    instructions.value        = (data.instruction_list || []).map(inst => {
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
    if (instructions.value.length === 0) addInstruction();
    syncOriginalWithCurrent();
  } catch (e) {
    console.error('📄❌ Failed to load edited program from localStorage:', e);
  }
}

// ============================================================================
// Computed values 
// ============================================================================
// Computed iterations based on instruction count
const iterations = computed(() => instructions.value.length);
  
const isProgramEmpty = computed(() => {
  const snap = snapshotProgram();
  const hasName = !!snap.name;
  const hasInstructionContent = snap.instruction_list.some(inst =>
    inst.text || inst.type || inst.destin || inst.source1 || inst.source2 || inst.source3 || inst.constant
  );
  return !hasName && !hasInstructionContent;
});

const isModified = computed(() => {
  const current = snapshotProgram();
  return JSON.stringify(current) !== JSON.stringify(originalProgram.value);
});

const canSave = computed(() => !isProgramEmpty.value && isModified.value);

// ============================================================================
// Program handling: addInstruction, removeInstruction, moveInstructionUp, moveInstructionDown
//       onMainTypeChange, onSubTypeChange, getSubTypes, normalizeInstruction, snapshotProgram
// ============================================================================

// Initialize with empty instruction
function addInstruction() {
  instructions.value.push({
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
  if (instructions.value.length > 1) {
    instructions.value.splice(index, 1);
  }
}

function moveInstructionUp(index) {
  if (index > 0) {
    const temp = instructions.value[index];
    instructions.value[index] = instructions.value[index - 1];
    instructions.value[index - 1] = temp;
  }
}

function moveInstructionDown(index) {
  if (index < instructions.value.length - 1) {
    const temp = instructions.value[index];
    instructions.value[index] = instructions.value[index + 1];
    instructions.value[index + 1] = temp;
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
    name: (programName.value || '').trim(),
    instruction_list: instructions.value.map(inst => normalizeInstruction(inst))
  };
}


// ============================================================================
// WATCHES: program, globalStat  HANDLERS: setProgram, showProgram
// ============================================================================
  // Watch for program changes
  watch(() => programOptions.currentProgram, (newProgram, oldProgram) => {
    console.log(`📄✅ Program changed from "${oldProgram}" to "${newProgram}"`);
    saveOptions()
    if (simState.state > 1 && newProgram !== oldProgram) {
      reloadProgram();
    }
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
      
      if (instructions.value.length === 0)
        addInstruction()
      loadFromLocalStorage();
      syncOriginalWithCurrent();
      localStorage.setItem('programTemp', JSON.stringify(snapshotProgram()));
    } catch (error) {
      console.error('📄❌ Failed to set program:', error)
      programText.value = '❌ Failed to get program description'
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
      programText.value = '❌ Failed to show program'
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
    try {    // Load from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(programOptions, JSON.parse(saved))
      }
      if (simState.state > 1) {
        console.error('📄⚠️ RVCAT imported and processor configuration loaded before mounting program component')
      }
    } catch (error) {
      console.error('📄❌ Failed to mount:', error)
    }
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
  const initProgram = async () => {
    const savedProgram = programOptions.currentProgram
    initResource({
      resourceName: 'program',
      logPrefix:    '📄',
      optionsObj:    programOptions,
      currentKey:   'currentProgram',
      availableKey: 'availablePrograms',
      errorHandler: (error) => {
        programText.value = '❌ Failed to set program';
      }
    });
    if (savedProgram === programOptions.currentProgram)
      reloadProgram()   // On initialization, if currentProgram not modified, force program reloading
  };

  const reloadProgram = async () => {
    console.log('📄🔄 Reloading program with:', programOptions.currentProgram);
    try {
      const jsonString  = localStorage.getItem(`program.${programOptions.currentProgram}`)
      setProgram( jsonString ) // Call Python RVCAT to load new program --> id= 'set-program'
    } catch (error) {
      console.error('📄❌ Failed to set program:', error)
      programText.value = '❌ Failed to set program';
    }      
  }

// ============================================================================
// DownLoad / UpLoad + Modal logic
// ============================================================================
  const showModalUp = ref(false)
  const modalName   = ref("")
  const nameError   = ref("")
 
  const showSaveModal = ref(false);
  const saveModalName = ref('');
  const saveModalError = ref('');
  const saveToFile = ref(true);

  // Change confirmation state (for load/clear when modified)
  const showChangeModal = ref(false);
  const pendingAction   = ref(null); // 'load' | 'clear'

  let uploadedProgramObject = null

   async function downloadProgram() {
    const jsonString  = localStorage.getItem(`program.${programOptions.currentProgram}`)
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${programOptions.currentProgram}.json`,
        types: [{
          description: 'JSON files',
          accept: { 'application/json': ['.json'] }
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
      console.log('📄✅ Downloaded program');
    } else {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${programOptions.currentProgram}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('📄✅ Downloaded program');
    }
  }

  function uploadProgram() {
    const input  = document.createElement("input");
    input.type   = "file";
    input.accept = "application/json";
    input.style.display = "none";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text   = await file.text();
        const parsed = JSON.parse(text);

        if (!parsed.name) {
          alert("The JSON file must contain a 'name' field.");
          return;
        }

        uploadedProgramObject = parsed;
        modalName.value       = parsed.name;
        showModalUp.value     = true;
        console.log('📄✅ Uploaded program:', uploadedProgramObject)
      } catch (err) {
        console.error("📄❌ Failed to parse JSON file:", err);
        alert("Could not load program file.");
      }
    };
    input.click();
    input.remove();
  }

  async function confirmModal() {
    const name = modalName.value.trim();
    if (programOptions.availablePrograms.includes(name)) {
      nameError.value = "A program with this name already exists. Please, choose another one.";
      return;
    }

    nameError.value   = "";
    showModalUp.value = false;

    console.log('Modal confirmed')
    uploadedProgramObject.name       = name;
    const jsonText                   = JSON.stringify(uploadedProgramObject, null, 2);
    const programKeys                = getKeys('program')
    programOptions.availablePrograms = programKeys
    programOptions.currentProgram    = name
    localStorage.setItem(`program.${name}`, jsonText)
    reloadProgram()
  }

  function cancelModal() {
    showModalUp.value = false;
    modalName.value   = "";
    nameError.value   = "";
    uploadedProgramObject = null;
  }
  
function syncOriginalWithCurrent() {
  originalProgram.value = snapshotProgram();
  originalProgramName.value = programName.value;
}

// Clear current program
function clearProgram() {
  programName.value = '';
  instructions.value = [];
  addInstruction();
  syncOriginalWithCurrent();
  localStorage.setItem('rvcat_program_local', JSON.stringify(snapshotProgram()));
}

// Handle load with modification/unsaved check
async function requestLoadProgram() {
  if (!isProgramEmpty.value) {
    pendingAction.value = 'load';
    showChangeModal.value = true;
    return;
  }
  await performLoadProgram();
}

// Load existing program (actual action)
async function performLoadProgram() {
  const selectEl = document.getElementById('programs-list');
  if (!selectEl || !selectEl.value) {
    alert('No program selected');
    return;
  }

  try {
    const programData = await getProgramJSON();
    
    programName.value = programData.name || selectEl.value;
    originalProgramName.value = programName.value;
    
    instructions.value = (programData.instruction_list || []).map(inst => {
      const [mainType, ...subTypeParts] = inst.type.split('.');
      const subType = subTypeParts.join('.');
      
      return {
        text: inst.text || '',
        type: inst.type || '',
        mainType: mainType || '',
        subType: subType || '',
        destin: inst.destin || '',
        source1: inst.source1 || '',
        source2: inst.source2 || '',
        source3: inst.source3 || '',
        constant: inst.constant || ''
      };
    });
    
    if (instructions.value.length === 0) {
      addInstruction();
    }

    syncOriginalWithCurrent();
    localStorage.setItem('rvcat_program_local', JSON.stringify(snapshotProgram()));
  } catch (err) {
    console.error('Failed to load program:', err);
    alert('Failed to load program');
  }
}

// Handle clear with modification/unsaved check
function requestClearProgram() {
  if (!isProgramEmpty.value) {
    pendingAction.value = 'clear';
    showChangeModal.value = true;
    return;
  }
  clearProgram();
}

// Save program
function openSaveModal() {
  saveModalName.value = programName.value;
  saveModalError.value = '';
  saveToFile.value = true;
  showSaveModal.value = true;
}

async function confirmSave() {
  const name = saveModalName.value.trim();
  
  if (!name) {
    saveModalError.value = 'Program name is required';
    return;
  }

  // Check if name already exists (do not allow duplicates)
  const selectEl = document.getElementById('programs-list');
  if (selectEl) {
    const nameExists = Array.from(selectEl.options).some(
      opt => opt.value === name
    );
    
    if (nameExists) {
      saveModalError.value = 'A program with this name already exists. Please choose another one.';
      return;
    }
  }

  // Build the program JSON
  const programData = {
    name: name,
    n: instructions.value.length,
    instruction_list: instructions.value.map(inst => ({
      type: inst.type,
      text: inst.text,
      destin: inst.destin,
      source1: inst.source1,
      source2: inst.source2,
      source3: inst.source3,
      constant: inst.constant
    }))
  };

  try {
    const jsonText = JSON.stringify(programData, null, 2);
    await saveNewProgram(jsonText);
    if (saveToFile.value) {
      try {
        await saveProgramJsonToFile(programData, name);
      } catch (fileErr) {
        if (fileErr?.name !== 'AbortError') {
          console.error('File save failed:', fileErr);
          saveModalError.value = 'Saved in app, but file save failed.';
          return;
        }
      }
    }
    
    programName.value = name;
    originalProgramName.value = name;
    showSaveModal.value = false;
    saveModalError.value = '';
    syncOriginalWithCurrent();
    localStorage.setItem('rvcat_program_local', JSON.stringify(snapshotProgram()));
    
    // Wait for program list to update and select the new program
    if (selectEl) {
      setTimeout(() => {
        selectEl.value = name;
        reloadRvcat();
      }, 200);
    }
    
  } catch (err) {
    console.error('Failed to save program:', err);
    saveModalError.value = 'Failed to save program';
  }
}

function cancelSave() {
  showSaveModal.value = false;
  saveModalError.value = '';
}


// Download program as JSON
async function downloadProgram2() {
  const programData = {
    name: programName.value,
    n: instructions.value.length,
    instruction_list: instructions.value.map(inst => ({
      type: inst.type,
      text: inst.text,
      destin: inst.destin,
      source1: inst.source1,
      source2: inst.source2,
      source3: inst.source3,
      constant: inst.constant
    }))
  };

  try {
    await saveProgramJsonToFile(programData, programName.value || 'program');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Download failed:', err);
      alert('Could not save the JSON file.');
    }
  }
}

// Upload program from JSON
function uploadProgram2(force = false) {
  if (!force && !isProgramEmpty.value) {
    pendingAction.value = 'upload';
    showChangeModal.value = true;
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.style.display = 'none';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const programData = JSON.parse(text);

      if (!programData.name) {
        alert("The JSON file must contain a 'name' field.");
        return;
      }

      const selectEl = document.getElementById('programs-list');
      if (selectEl) {
        const nameExists = Array.from(selectEl.options).some(opt => opt.value === programData.name);
        if (nameExists) {
          alert('A program with this name already exists. Please choose another name.');
          return;
        }
      }
      
      programName.value = programData.name || 'imported_program';
      originalProgramName.value = '';
      
      instructions.value = (programData.instruction_list || []).map(inst => {
        const [mainType, ...subTypeParts] = inst.type.split('.');
        const subType = subTypeParts.join('.');
        
        return {
          text: inst.text || '',
          type: inst.type || '',
          mainType: mainType || '',
          subType: subType || '',
          destin: inst.destin || '',
          source1: inst.source1 || '',
          source2: inst.source2 || '',
          source3: inst.source3 || '',
          constant: inst.constant || ''
        };
      });
      
      if (instructions.value.length === 0) {
        addInstruction();
      }

      syncOriginalWithCurrent();
      localStorage.setItem('rvcat_program_local', JSON.stringify(snapshotProgram()));
    } catch (err) {
      console.error('Failed to parse JSON file:', err);
      alert('Could not load program file.');
    }
  };
  
  document.body.appendChild(input);
  input.click();
  input.remove();
}

async function saveProgramJsonToFile(programData, name) {
  const jsonText = JSON.stringify(programData, null, 2);
  const suggested = `${name || 'program'}.json`;

  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggested,
      types: [{
        description: 'JSON files',
        accept: { 'application/json': ['.json'] }
      }],
    });
    const writable = await handle.createWritable();
    await writable.write(jsonText);
    await writable.close();
  } else {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggested;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
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
  pendingAction.value = null;
}

function cancelPendingAction() {
  showChangeModal.value = false;
  pendingAction.value = null;
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
        <select v-model="programOptions.currentProgram" id="programs-list" title="Select Program">
          <option value="" disabled>Select</option>
          <option v-for="program in programOptions.availablePrograms" :key="program" :value="program">
            {{ program }}
          </option>
        </select>
      </div>

      <section class="main-box code-block"> <pre><code>{{ programText }}</code></pre> </section>
    </div>
    
    <div v-else class="header fullscreen-header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program - <strong>{{ programOptions.currentProgram }}</strong></span>
      </div>
      
      <div class="settings-container fullscreen-settings">
        <select v-model="programOptions.currentProgram" id="programs-list" title="Select Program">
          <option value="" disabled>Select</option>
          <option v-for="program in programOptions.availablePrograms" :key="program" :value="program">
            {{ program }}
          </option>
        </select>
        <div class="buttons">
          <button class="blue-button" @click="downloadProgram"
               title="Save current Program" 
               id="program-download-button"> 
            Download 
          </button>
          <button class="blue-button" @click="uploadProgram"
               title="Load new Program"     
               id="program-upload-button">  
            Upload  
          </button>

          <button class="blue-button" @click="requestLoadProgram">Load current program</button>
          <button class="blue-button" @click="uploadProgram">Upload</button>
          <button class="blue-button" :disabled="!canSave" @click="openSaveModal">Save</button>
          <button class="green-button" @click="downloadProgram">Download</button>
          <button class="red-button" @click="requestClearProgram">Clear</button>
          
        </div>
      </div>
    </div>

    <div v-if="isFullscreen" class="program-info">
      <div class="info-row">
        <label>Program Name:</label>
        <input type="text" v-model="programName" class="name-input" />
      </div>
      <div class="info-row">
        <label>Instructions:</label>
        <span class="instruction-count">{{ iterations }}</span>
      </div>
    </div>

    <div v-if="isFullscreen" class="instructions-section">
      <div class="section-header">
        <h4>Instructions</h4>
        <button class="blue-button small add-btn" @click="addInstruction">+ Add Instruction</button>
      </div>

      <div class="table-container">
        <table class="instructions-table">
          <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th style="width: 200px;">Text</th>
              <th style="width: 120px;">Type</th>
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
            <tr v-for="(inst, index) in instructions" :key="index">
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
                  :disabled="index === instructions.length - 1"
                  class="action-btn"
                  title="Move down"
                >
                  ▼
                </button>
                <button 
                  @click="removeInstruction(index)" 
                  :disabled="instructions.length === 1"
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
        <h4>Unsaved changes</h4>
        <p>You may have unsaved changes. Do you want to continue?</p>
        <div class="modal-actions">
          <button class="blue-button" @click="proceedPendingAction">Continue</button>
          <button class="red-button" @click="cancelPendingAction">Cancel</button>
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
  width: 8px;
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

.program-editor {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 15px 40px 35px 15px;
  background: white;
  overflow: hidden;
  border-radius: 10px;
}

.download-btn {
  margin-right: 20px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 2px solid #007acc;
}

.editor-header h3 {
  margin: 0;
  color: #333;
}

.header-actions {
  display: flex;
  gap: 8px;
  padding-right: 20px;
}

.program-info {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 5px;
  margin-right: 20px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.info-row label {
  font-weight: bold;
  white-space: nowrap;
}

.name-input {
  width: 200px;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 14px;
}

.instruction-count {
  font-weight: bold;
  color: #007acc;
  font-size: 16px;
  padding: 5px 8px;
}

.instructions-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  margin-right: 20px;
}

.section-header h4 {
  margin: 0;
  color: #333;
}

.table-container {
  flex: 1;
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 5px;
  margin-right: 20px;
  max-height: calc(100vh - 300px);
}

.instructions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.instructions-table thead {
  position: sticky;
  top: 0;
  background: #007acc;
  color: white;
  z-index: 1;
}

.instructions-table th {
  padding: 10px 5px;
  text-align: left;
  font-weight: bold;
  border: 1px solid #005a9e;
}

.instructions-table td {
  padding: 5px;
  border: 1px solid #ddd;
  vertical-align: middle;
}

.instructions-table tbody tr:nth-child(even) {
  background: #f9f9f9;
}

.instructions-table tbody tr:hover {
  background: #e8f4fd;
}

.table-input,
.table-select {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 13px;
  box-sizing: border-box;
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
  padding: 3px 8px;
  margin: 0 2px;
  border: 1px solid #ccc;
  background: white;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.action-btn:hover:not(:disabled) {
  background: #e8f4fd;
  border-color: #007acc;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.delete {
  color: #d32f2f;
}

.action-btn.delete:hover:not(:disabled) {
  background: #ffebee;
  border-color: #d32f2f;
}

.green-button {
  background-color: #28a745;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.green-button:hover:not(:disabled) {
  background-color: #218838;
}

.green-button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.6;
}

.red-button {
  background-color: #dc3545;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.red-button:hover:not(:disabled) {
  background-color: #c82333;
}

.red-button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.6;
}

.add-btn {
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

  
</style>
