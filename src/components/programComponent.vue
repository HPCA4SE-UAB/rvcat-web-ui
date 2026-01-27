<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, reactive, watch } from "vue";
  import HelpComponent  from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

  const { setProgram, showProgram } = useRVCAT_Api();
  const { registerHandler }         = inject('worker');
  const simState                    = inject('simulationState');

  // Usando Composition API con setup
  const props = defineProps({
    isFullscreen: {
      type: Boolean,
      default: false
    }
  })
  
 /* ------------------------------------------------------------------ 
   * Program options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'programOptions'

  const defaultOptions = {
    currentProgram:    '',
    availablePrograms: []
  }
  
  const savedOptions = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : defaultOptions
    } catch {
      return defaultOptions
    }
  })()

  const programOptions  = reactive({ ...defaultOptions, ...savedOptions })
  const programText     = ref('LOADING ...')
  let cleanupHandleSet  = null
  let cleanupHandleShow = null

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(programOptions))
    } catch (error) {
      console.error('❌ Failed to save:', error)
    }
  }

  // Watch for program changes
  watch(() => programOptions.currentProgram, (newProgram, oldProgram) => {
    console.log(`✅ Program changed from "${oldProgram}" to "${newProgram}"`);
    saveOptions()
    if (simState.RVCAT_state > 1 && newProgram !== oldProgram) {
      reloadProgram();
    }
  });

  // Watch for changes on RVCAT state
  watch(() => simState.RVCAT_state, (newValue, oldValue) => {
    if (newValue == 2) {
      console.log('✅ RVCAT imported and processor set: look for programs and select current');
      initProgram();
    }
  });

  // Watch for changes on processor configuration
  watch(() => simState.selectedProcessor, (newValue, oldValue) => {
    if (newValue != oldValue) {
      console.log('🔄 Refresh program visualization for modified processor configuration');
      showProgram()
    }
  });
  
   // Handler for 'set_program' message (fired by this component)
  const handleSetProgram = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('❌ Failed to set program:', data);
      return;
    }
    try {    
      simState.selectedProgram = programOptions.currentProgram;  // fire other components, watching for a change
      simState.RVCAT_state = 3;                                  // program loaded
      if (simState.selectedProgram != '')
        showProgram()  // obtain text from RVCAT API (id= 'show_program')
    } catch (error) {
      console.error('Failed to set program:', error)
      programText.value = '❌ Failed to get program description'
    }
  }

   // Handler for 'show_program' message (fired by this component)
  const handleShowProgram = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('❌ Failed to show program:', data)
      return;
    }
    try {
      programText.value = data
    } catch (error) {
      console.error('❌ Failed to show program:', error)
      programText.value = 'Failed to show program'
    }
  }

  onMounted(() => {
    console.log('🎯 ProgramComponent mounted')
    cleanupHandleSet = registerHandler('set_program',  handleSetProgram)
    cleanupHandleShow= registerHandler('show_program', handleShowProgram)
    try {    // Load from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(programOptions, JSON.parse(saved))
      }
      if (simState.RVCAT_state == 2) {
        console.log('✅ RVCAT imported and processor set: look for programs and select current');
        initProgram();
      }
    } catch (error) {
      console.error('❌ Failed to load:', error)
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

  const initProgram = async () => {
    console.log('🔄 Loading programs...');
    try {
      let programKeys = getKeys('program') // from localStorage
      if (programKeys.length == 0) { // load programs from distribution files
        console.log('Load programs from distribution files')
        const response = await fetch('./index.json')
        const data     = await response.json()
        for (let i = 0; i < data.programs.length; i += 1) {
          const filedata = await loadJSONfile(`./programs/${data.programs[i]}.json`)
          localStorage.setItem(`program.${data.programs[i]}`, JSON.stringify(filedata))
        }
        programKeys = getKeys('program')
        console.log(`✅ Loaded ${programKeys.length} programs from distribution files`)
      }
      else {
        console.log(`✅ Loaded ${programKeys.length} programs from localStorage`)
      }
      programOptions.availablePrograms = programKeys   // fires reaction to reloadProgram
      if (!programKeys.includes(programOptions.currentProgram))
        programOptions.currentProgram = programKeys[0]  
    } catch (error) {
      console.error('❌ Failed to load programs:', error)
      programText.value = 'Failed to set program';
    }      
  }
  
  const reloadProgram = async () => {
    console.log('🔄 Reloading program with:', programOptions.currentProgram);
    try {
      const jsonString  = localStorage.getItem(`program.${programOptions.currentProgram}`)
      setProgram( jsonString ) // Call Python RVCAT to load new program --> id= 'set-program'
    } catch (error) {
      console.error('❌ Failed to set program:', error)
      programText.value = 'Failed to set program';
    }      
  }
  
  // Modal logic
  const showModalUp = ref(false)
  const modalName   = ref("")
  const nameError   = ref("")
  let uploadedProgramObject = null

  async function confirmModal() {
    const name = modalName.value.trim();
    if (programOptions.availablePrograms.includes(name)) {
      nameError.value = "A program with this name already exists. Please, choose another one.";
      return;
    }

    nameError.value   = "";
    showModalUp.value = false;

    console.log('Modal confirmed')
    uploadedProgramObject.name = name;
    const jsonText = JSON.stringify(uploadedProgramObject, null, 2);
    localStorage.setItem(`program.${name}`, jsonText)
    const programKeys = getKeys('program')
    programOptions.availablePrograms = programKeys
    programOptions.currentProgram = name
    reloadProgram()
  }

  function cancelModal() {
    showModalUp.value = false;
    modalName.value   = "";
    nameError.value   = "";
    uploadedProgramObject = null;
  }

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
        console.log('Uploaded program:', uploadedProgramObject)
      } catch (err) {
        console.error("❌ Failed to parse JSON file:", err);
        alert("Could not load program file.");
      }
    };
    input.click();
    input.remove();
  }

/* ------------------------------------------------------------------ 
 * Help support 
 * ------------------------------------------------------------------ */
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
        <select v-model="programOptions.currentProgram" title="Select Program">
          <option value="" disabled>Select</option>
          <option v-for="program in programOptions.availablePrograms" :key="program" :value="program">
            {{ program }}
          </option>
        </select>
      </div>
    </div>
    
    <div v-else class="header fullscreen-header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program - <strong>{{ programOptions.currentProgram }}</strong></span>
      </div>
      
      <div class="settings-container fullscreen-settings">
        <select v-model="programOptions.currentProgram" title="Select Program">
          <option value="" disabled>Select</option>
          <option v-for="program in programOptions.availablePrograms" :key="program" :value="program">
            {{ program }}
          </option>
        </select>
        <div class="buttons">
          <button class="blue-button" title="Save current Program" @click="downloadProgram"> Download </button>
          <button class="blue-button" title="Load new Program"     @click="uploadProgram">   Upload   </button>
        </div>
      </div>
    </div>

    <section class="main-box code-block"> <pre><code>{{ programText }}</code></pre> </section>
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
#settings-div {
  display: flex;
  gap:     5px;
}
#programs-list {
  font-size:2.2vh;
}

.settings-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fullscreen-settings {
  display: flex;
  align-items: center;
  gap: 10px;
}
  
</style>
