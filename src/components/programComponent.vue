<script setup>
  import { ref, onMounted, onUnmounted, nextTick } from "vue";
  import TutorialComponent                         from '@/components/tutorialComponent.vue';

  let processorsListHandler = null;

  onMounted(() => {
    nextTick(() => {
      const list = document.getElementById("processors-list");
      if (list) {
        processorsListHandler = () => setTimeout(() => { programShow(); }, 100);
        list.addEventListener("change", processorsListHandler);
      }
      reloadRvcat();
    });
  });
  onUnmounted(() => {
    const list = document.getElementById("processors-list");
    if (list && processorsListHandler) {
      list.removeEventListener("change", processorsListHandler);
    }
  });

  // Modal logic
  const showModalUp = ref(false);
  const modalName   = ref("");
  const nameError   = ref("");
  let uploadedProgramObject = null;

  async function confirmModal() {
    const name     = modalName.value.trim();
    const selectEl = document.getElementById("programs-list");

    const nameExists = Array.from(selectEl.options).some(opt => opt.value === name);
    if (nameExists) {
      nameError.value = "A program with this name already exists. Please, choose another one.";
      return;
    }

    nameError.value   = "";
    showModalUp.value = false;

    uploadedProgramObject.name = name;
    const jsonText = JSON.stringify(uploadedProgramObject, null, 2);
    await saveNewProgram(jsonText);

    const observer = new MutationObserver((mutations, obs) => {
      const justAdded = Array.from(selectEl.options).some(opt => opt.value === name);
      if (justAdded) {
        selectEl.value = name;
        reloadRvcat();
        obs.disconnect();
      }
    });
    observer.observe(selectEl, { childList: true });
    reloadRvcat();
  }

  function cancelModal() {
    showModalUp.value = false;
    modalName.value   = "";
    nameError.value   = "";
    uploadedProgramObject = null;
  }

  async function downloadProgram() {
    let data = await getProgramJSON();
    const jsonText = JSON.stringify(data, null, 2);
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${document.getElementById('programs-list').value}.json`,
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
      a.download = `${document.getElementById('programs-list').value}.json`;
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

  const showTutorial     = ref(false)
  const tutorialPosition = ref({ top: '0%', left: '40%' })
  const infoIcon         = ref(null)

  function openTutorial() {
    nextTick(() => {
      const el = infoIcon.value
      if (el) {
        const r = el.getBoundingClientRect()
        showTutorial.value = true
      }
    })
  }

  function closeTutorial() {
    showTutorial.value = false
  }
</script>

<template>
  <div class="program_info">
    <div class="program-header">
      <div class="section-title-and-info">
        <span ref="infoIcon" class="info-icon" @click="openTutorial" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Program</span>
      </div>
      <div id="settings-div">
        <button id="download-button" class="blue-button" @click="downloadProgram">Download</button>
        <button id="upload-button"   class="blue-button" @click="uploadProgram">Upload</button>
        <select id="programs-list" name="assembly-code" onchange="reloadRvcat();"></select>
      </div>
    </div>
    <section class="main-box code-block">
        <pre><code id="rvcat-asm-code">LOADING ...</code></pre>
    </section>
  </div>
  <div v-if="showModalUp" class="modal-overlay">
    <div class="modal">
      <h4>Load Program As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" v-model="modalName" />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" @click="confirmModal">Load</button>
        <button class="blue-button" @click="cancelModal">Cancel</button>
      </div>
    </div>
  </div>

  <TutorialComponent v-if="showTutorial" :position="tutorialPosition"
  text="The simulated program consists of a <em>fixed-iteration</em> loop executing a sequence of <strong>machine instructions</strong>, each described in a high-level, 
       informal language. The <em>type</em>, execution <em>latency</em> and eligible <em>execution ports</em> are shown for each instruction.
        <p>The simulation tracks <strong>data dependencies</strong> but omits detailed architectural state: it <strong>does not</strong> model processor registers, memory states, 
    branch outcomes, or memory dependencies (e.g., store-load interactions).</p>
        Programs can be uploaded or downloaded in JSON format."
  title="Program Loop"
  @close="closeTutorial"
  />
</template>

<style scoped>
.program_info{
  height:100%;
  width:100%;
  background: white;
  overflow:hidden;
  padding:5px;
  border-radius: 10px;
}
.header-title {
    font-size: 1.1rem;
    margin-right: 0.75rem;
    font-weight: 600
 }
.program-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  position:sticky;
  left:0;
}
.main-box{
  overflow:auto;
  max-height:70%;
  margin-top:5px;
  background: #f0f0f0;
  border-radius:10px;
  padding:5px;
  font-size:2.2vh;
}
#settings-div{
  display:flex;
  gap:5px;
}
#programs-list{
  font-size:2.2vh;
}
</style>
