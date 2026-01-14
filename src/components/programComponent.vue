<script setup>
  import { ref, onMounted, onUnmounted, nextTick, inject, watch } from "vue";
  import HelpComponent  from '@/components/helpComponent.vue';
  import { useRVCAT_Api } from '@/rvcatAPI';

  const { setProgram, showProgram } = useRVCAT_Api();
  const { registerHandler }         = inject('worker');
  const simState                    = inject('simulationState');
  
  const programText       = ref('LOADING ...');
  const currentProgram    = ref('');
  const availablePrograms = ref([]);

  // Watch for program changes
  watch(() => currentProgram, (newProgram, oldProgram) => {
    console.log(`Program changed from "${oldProgram}" to "${newProgram}"`);
    if (newProgram && newProgram !== oldProgram) {
      reloadProgram();
    }
  });

  // Watch for changes on RVCAT import
  watch(() => simState.RVCAT_imported, (newValue, oldValue) => {
    if (newValue) {
      console.log('RVCAT imported: look for programs and select current');
      initProgram();
    }
  });
  
   // Handler for 'set_program' message (fired by this component)
  const handleSetProgram = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to set program:', data);
      return;
    }
    try {    
      simState.selectedProgram = currentProgram.value;  // fire other components, watching for a change
      showProgram();  // obtain text from RVCAT API (id= 'show_program')
    } catch (error) {
      console.error('Failed to set program:', error)
      programText.value = 'Failed to get program description';
    }
  }

   // Handler for 'show_program' message (fired by this component)
  const handleShowProgram = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('Failed to show program:', data);
      return;
    }
    try {
      programText.value = data;
    } catch (error) {
      console.error('Failed to show program:', error)
      programText.value = 'Failed to show program';
    }
  }

  onMounted(() => {
    const cleanupHandleSet = registerHandler('set_program',  handleSetProgram);
    const cleanupHandleShow= registerHandler('show_program', handleShowProgram);
  });

  onUnmounted(() => {
    cleanupHandleSet();
    cleanupHandleShow();
  });

  
  const initProgram = async () => {
    console.log('Init program list');
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
      }
      availablePrograms.value = programKeys
      currentProgram.value = programKeys[0]
      reloadProgram()
    } catch (error) {
      console.error('Failed to set program:', error)
      programText.value = 'Failed to set program';
    }      
  }
  
  const reloadProgram = async () => {
    console.log('Reloading program with:', currentProgram.value);
    try {
      const jsonString  = localStorage.getItem(`program.${currentProgram.value}`)
      setProgram( jsonString ) // Call Python RVCAT to load new program --> id= 'set-program'
    } catch (error) {
      console.error('Failed to set program:', error)
      programText.value = 'Failed to set program';
    }      
  }
  
  // Modal logic
  const showModalUp = ref(false);
  const modalName   = ref("");
  const nameError   = ref("");

  async function confirmModal() {
    const name     = modalName.value.trim();
    const selectEl = document.getElementById("programs-list");

    if (name == simState.selectedProgram) {
      nameError.value = "A program with this name already exists. Please, choose another one.";
      return;
    }

    nameError.value   = "";
    showModalUp.value = false;

    uploadedProgramObject.name = name;
    const jsonText = JSON.stringify(uploadedProgramObject, null, 2);
    saveProgram(jsonText);
  }

  function cancelModal() {
    showModalUp.value = false;
    modalName.value   = "";
    nameError.value   = "";
    uploadedProgramObject = null;
  }

  async function downloadProgram() {
    const jsonText = JSON.stringify(programJSON.value, null, 2);
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${simState.selectedProgram}.json`,
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
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${simState.selectedProgram}.json`;
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
      } catch (err) {
        console.error("Failed to parse JSON file:", err);
        alert("Could not load program file.");
      }
    };
    document.body.appendChild(input);
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
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program</span>
      </div>
      
      <div id="settings-div">
        <button id="download-button" title="Save current Program"  class="blue-button" @click="downloadProgram">Download</button>
        <button id="upload-button"   title="Load new Program"      class="blue-button" @click="uploadProgram">Upload</button>
        <select v-model="currentProgram" title="Select Program">
          <option value="" disabled>Select</option>
          <option v-for="program in availablePrograms" :key="program" :value="program">
            {{ program }}
          </option>
        </select>
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
</style>
