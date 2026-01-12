<script setup>
  import { ref, reactive, computed, onMounted, onUnmounted, nextTick} from "vue";
  import HelpComponent from '@/components/helpComponent.vue';

  const dispatch        = ref(0);
  const retire          = ref(0);
  const resources       = reactive({});
  const name            = ref("");
  const ports           = ref({});
  const nBlocks         = ref(0);
  const blkSize         = ref(0);
  const mPenalty        = ref(0);
  const mIssueTime      = ref(0);
  const showTooltip     = ref(false);
  const showModalChange = ref(false);
  const prevProcessor   = ref(null);
  
  let prevProcessorHandler;
  let processorsListHandler;
  let lastRequestId         = 0;
  let modalConfirmOperation = null;

  const originalSettings = reactive({
    dispatch:   0,
    retire:     0,
    resources:  {},
    name:       "",
    ports:      {},
    rports:     {},
    cache:      null,
    nBlocks:    0,
    blkSize:    0,
    mPenalty:   0,
    mIssueTime: 0,
  });

  // --- computed lists ---
  const availableInstructions = computed(() => Object.keys(resources));
  const portList              = computed(() => Object.keys(ports.value));

  // --- modal state ---
  const showModalDown = ref(false);
  const showModalUp   = ref(false);
  const modalName     = ref("");
  const modalDownload = ref(true);
  const nameError     = ref("");

  // --- tutorial state ---
  const showTutorial1   = ref(false);
  const showTutorial2   = ref(false);
  const showTutorial3   = ref(false);
  const showTutorial4   = ref(false);
  const infoIcon1       = ref(null);
  const infoIcon2       = ref(null);
  const infoIcon3       = ref(null);
  const infoIcon4       = ref(null);
  const tutorialPosition= ref({ top: '0%', left: '0%' });

  // --- load & update processor settings ---
  const updateProcessorSettings = async () => {
    const thisId = ++lastRequestId;
    if (typeof getProcessorJSON !== "function") return;
    try {
      const cfg = await getProcessorJSON();
      if (thisId !== lastRequestId) return;

      dispatch.value   = cfg.stages.dispatch;
      retire.value     = cfg.stages.retire;
      name.value       = cfg.name;
      ports.value      = cfg.ports || {};
      nBlocks.value    = cfg.nBlocks;
      blkSize.value    = cfg.blkSize;
      mIssueTime.value = cfg.mIssueTime;
      mPenalty.value   = cfg.mPenalty;

      // refresh resources
      Object.keys(resources).forEach(k => delete resources[k]);
      Object.entries(cfg.resources || {}).forEach(([k,v]) => {
        resources[k] = v;
      });

      // stash original
      Object.assign(originalSettings, {
        dispatch:   cfg.stages.dispatch,
        retire:     cfg.stages.retire,
        name:       cfg.name,
        resources:  JSON.parse(JSON.stringify(cfg.resources || {})),
        ports:      JSON.parse(JSON.stringify(cfg.ports || {})),
        rports:     JSON.parse(JSON.stringify(cfg.rports || {})),
        cache:      cfg.cache,
        nBlocks:    cfg.nBlocks,
        blkSize:    cfg.blkSize,
        mPenalty:   cfg.mPenalty,
        mIssueTime: cfg.mIssueTime,
      });
    } catch(e) {
      console.error("Failed to load processor JSON:", e);
    }
  };

  onMounted(() => {
    nextTick(() => {
      const list = document.getElementById("processors-list");
      if (list) {
        prevProcessorHandler = () => {
          prevProcessor.value=list.value;
        }
        processorsListHandler = () => {
          if(isModified.value){
            showModalChange.value = true;
            modalConfirmOperation = 'change';
          }
          else {
            setTimeout( ()=> { updateProcessorSettings();},100);
          }
        }
        list.addEventListener("focus",  prevProcessorHandler);
        list.addEventListener("change", processorsListHandler);
      }
      updateProcessorSettings();
    });
  });

  onUnmounted(() => {
    const list = document.getElementById("processors-list");
    if (list && processorsListHandler) {
      list.removeEventListener("change", processorsListHandler);
    }
    list.removeEventListener("focus", prevProcessorHandler);
  });

  // --- detect modifications ---
  function shallowEq(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let k of ka) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
  
  function portsEq(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    
    if (ka.length !== kb.length) return false;
    
    for (let k of ka) {
      const arrA = a[k] || [], arrB = b[k] || [];
      if (arrA.length !== arrB.length) return false;

      // get frequencies as arrays could be in different order
      const freq = new Map();
      for (let v of arrA) {
        freq.set(v, (freq.get(v) || 0) + 1);
      }
      for (let v of arrB) {
        if (!freq.has(v)) return false;
        freq.set(v, freq.get(v) - 1);
        if (freq.get(v) === 0) freq.delete(v);
      }
      // after removing all arrB items, map should be empty
      if (freq.size !== 0) return false;
    }
    return true;
  }
  
  const isModified = computed(() => {
    if (dispatch.value !== originalSettings.dispatch)       return true;
    if (retire.value   !== originalSettings.retire)         return true;
    if (nBlocks.value   !== originalSettings.nBlocks)       return true;
    if (blkSize.value   !== originalSettings.blkSize)       return true;
    if (mPenalty.value   !== originalSettings.mPenalty)     return true;
    if (mIssueTime.value   !== originalSettings.mIssueTime) return true;
    if (!shallowEq(resources, originalSettings.resources))  return true;
    if (!portsEq(ports.value, originalSettings.ports))      return true;
    return false;
  });

  function canLeave() {
    return isModified.value;
  }

  defineExpose({ canLeave });

  // --- helpers and modal controls ---
  function getCurrentProcessorJSON() {
    const rports = {};
    Object.entries(ports.value).forEach(([port, instrs]) => {
      instrs.forEach(instr => {
        if (!rports[instr]) rports[instr] = [];
        rports[instr].push(port);
      });
    });
    return {
      name: modalName.value,
      stages: {
        dispatch: dispatch.value,
        execute:  Object.keys(ports.value).length,
        retire:   retire.value,
      },
      resources:  { ...resources },
      ports:      ports.value,
      rports:     rports,
      cache:      originalSettings.cache,
      nBlocks:    nBlocks.value,
      blkSize:    blkSize.value,
      mPenalty:   mPenalty.value,
      mIssueTime: mIssueTime.value,
    };
  }

  function openModal() {
    modalName.value     = name.value + "*";
    modalDownload.value = true;
    nameError.value     = "";
    showModalDown.value = true;
  }

  function closeModal() {
    showModalDown.value = false;
    showModalUp.value   = false;
  }

  async function confirmModal() {
    const list = document.getElementById("processors-list");
    if (list) {
      for (const opt of list.options) {
        if (opt.value === modalName.value) {
          nameError.value = "A processor configuration with this name already exists. Please, choose another one.";
          return;
        }
      }
    }
    const data = getCurrentProcessorJSON();
    await saveModifiedProcessor(data);

    Object.assign(originalSettings, {
      dispatch:   data.stages.dispatch,
      retire:     data.stages.retire,
      name:       data.name,
      resources:  JSON.parse(JSON.stringify(data.resources)),
      ports:      JSON.parse(JSON.stringify(data.ports)),
      rports:     JSON.parse(JSON.stringify(data.rports)),
      cache:      data.cache,
      nBlocks:    data.nBlocks,
      blkSize:    data.blkSize,
      mPenalty:   data.mPenalty,
      mIssueTime: data.mIssueTime,
    });

    //download JSON file
    if (modalDownload.value) {
      const jsonText = JSON.stringify(data, null, 2);

      // force a Save As... dialog if API is supported
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${modalName.value}.json`,
          types: [{
            description: 'JSON files',
            accept: { 'application/json': ['.json'] }
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
      } else {
        // fallback: traditional anchor download
        const blob = new Blob([jsonText], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `${modalName.value}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }
    name.value = modalName.value;
    showModalDown.value = false;
    showModalUp.value = false;

    setTimeout(()=>{
      list.value=modalName.value;
      reloadRvcat();
    },100);
  }

  // --- port add/delete ---
  function addPort() {
    const existing = portList.value.map(n => parseInt(n,10)).sort((a,b)=>a-b);
    let next = 0;
    for (; existing.includes(next); next++);
    ports.value[next] = [];
  }
  
  function removePort(port) {
    const idx = Number(port);
    delete ports.value[idx];

    //sort and reindex other ports
    const leftover = Object.entries(ports.value)
      .map(([k,v]) => [Number(k), v])
      .sort((a,b) => a[0] - b[0]);

    Object.keys(ports.value).forEach(k => delete ports.value[k]);
    leftover.forEach(([oldIdx, portArr], newIdx) => {
      ports.value[newIdx] = portArr;
    });
  }

  function togglePortInstruction(portNum, instruction, isChecked) {
    if (!ports.value[portNum]) ports.value[portNum] = [];
    if (isChecked) {
      if (!ports.value[portNum].includes(instruction))
        ports.value[portNum].push(instruction);
    } else {
      ports.value[portNum] = ports.value[portNum].filter(i => i !== instruction);
    }
  }

  function uploadProcessorConfig(event) {
    const inputEl = event.target;
    const file    = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        
        // === apply JSON to your reactive state ===
        dispatch.value   = data.stages?.dispatch ?? dispatch.value;
        retire.value     = data.stages?.retire   ?? retire.value;
        name.value       = data.name             ?? name.value;
        nBlocks.value    = data.nBlocks;
        blkSize.value    = data.blkSize;
        mIssueTime.value = data.mIssueTime;
        mPenalty.value   = data.mPenalty;

        // update resources
        Object.keys(resources).forEach(k => delete resources[k]);
        Object.entries(data.resources || {}).forEach(([k,v]) => {
          resources[k] = v;
        });

        // update ports
        ports.value = data.ports || {};

        // stash originalSettings if needed...
        Object.assign(originalSettings, {
          dispatch:   data.stages?.dispatch ?? 0,
          retire:     data.stages?.retire   ?? 0,
          name:       data.name             ?? "",
          resources:  JSON.parse(JSON.stringify(data.resources||{})),
          ports:      JSON.parse(JSON.stringify(data.ports||{})),
          rports:     JSON.parse(JSON.stringify(data.rports||{})),
          cache:      data.cache,
          nBlocks:    data.nBlocks,
          blkSize:    data.blkSize,
          mPenalty:   data.mPenalty,
          mIssueTime: data.mIssueTime,
        });

        // === now pop up the Save‐As dialog ===
        // strip extension from filename for default
        modalName.value     = file.name.replace(/\.[^.]+$/, "");
        modalDownload.value = false;
        nameError.value     = "";
        showModalUp.value   = true;

      } catch (err) {
        console.error("Invalid JSON:", err);
        alert("Failed to load processor config. Please, check the file.");
      }
      inputEl.value = "";
    };
    reader.readAsText(file);
  }

  function noPortAssigned(instr) {
    if (!portList.value.some(p => ports.value[p]?.includes(instr))) {
      ports.value[0].push(instr)
      showTooltip.value = true
      setTimeout(() => { showTooltip.value = false }, 2000)
    }
    return !portList.value.some(p => ports.value[p]?.includes(instr))
  }

  function confirmLeave(){
    showModalChange.value = false;
    if(modalConfirmOperation=='upload') {
      document.getElementById('file-upload').click();
    }
    else if(modalConfirmOperation=='change') {
      updateProcessorSettings();
    }
  }

  function cancelLeave() {
    if (modalConfirmOperation=='change') {
      document.getElementById('processors-list').value = prevProcessor.value;
      reloadRvcat();
    }
    showModalChange.value = false;
  }

  function openUploadModal() {
    if (isModified.value) {
      showModalChange.value = true;
      modalConfirmOperation = 'upload';
    }
    else {
      document.getElementById('file-upload').click();
    }
  }

/* ------------------------------------------------------------------ 
 * Help support 
 * ------------------------------------------------------------------ */
  const showHelp1    = ref(false);
  const showHelp2    = ref(false);
  const showHelp3    = ref(false);
  const showHelp4    = ref(false);
  const helpIcon1    = ref(null);
  const helpIcon2    = ref(null);
  const helpIcon3    = ref(null);
  const helpIcon4    = ref(null);
  const helpPosition = ref({ top: '0%', left: '0%' });

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
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Processor Settings - {{ name }}</span>
      </div>

      <div class="buttons">
        <button class="blue-button" @click="openModal" :disabled="!isModified">
          Apply Changes
        </button>
        <input id="file-upload" type="file" accept=".json" @change="uploadProcessorConfig" style="display: none;"/>
        <button class="blue-button" @click="openUploadModal">
          Upload
        </button>
      </div>
    </div>
    
    <div class="settings-sections">
      
      <!-- Widths Group -->
      <div class="settings-group">
        <div class="section-title-and-info">
        <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Stage Width Settings</span>
        </div>
        
        <div class="iters-group">
          <span>Dispatch:</span>
          <input type="number" v-model.number="dispatch" min="1" max="9" 
                 title="max. number of instructions dispatched per cycle"/>
        
          <span>Retire:</span>
          <input type="number" v-model.number="retire" min="1" max="9" 
                   title="max. number of instructions retired per cycle"/>
        </div>  
      </div> <!--- Widths Group -->

      <!-- Cache Settings Group -->
      <div class="settings-group">
        <div class="section-title-and-info">
        <span ref="helpIcon3" class="info-icon" @click="openHelp3" title="Show Help" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Cache Memory Settings</span>
        </div>
        
        <div class="iters-group">
          <span>Number of Blocks:</span>
          <input type="number" v-model.number="nBlocks" min="0" max="32" 
                 title="Memory blocks stored into cache (0 => no cache)"/>
        
          <span>Block Size:</span>
          <div class="button-group">
            <button @click="blkSize = Math.max(1, blkSize / 2)">−</button>
            <input type="number" v-model.number="blkSize" readonly
                   title="Size of Memory block: must be a power of two"
             />
            <button @click="blkSize = Math.min(128, blkSize * 2)">+</button>
          </div>

          <span>Miss Penalty:</span>
          <input type="number" v-model.number="mPenalty" min="1" max="99" 
                 title="Extra latency due to cache miss"/>

          <span>Miss Issue Time:</span>
          <input type="number" v-model.number="mIssueTime" min="1" max="99" 
                 title="Minimum time between Memory accesses"/>
        </div>
      </div> <!--- Cache Settings Group -->
      
      <!-- Latency and Port Settings Group -->
      <div class="settings-group">
        <div class="section-title-and-info">
          <span ref="helpIcon4" class="info-icon" @click="openHelp4" title="Show Help" >
            <img src="/img/info.png" class="info-img">
          </span>
          <span class="header-title">Instruction Latencies and Execution Ports</span>
        </div>
          
        <!-- Ports toolbar: show existing ports and add/delete -->
        <div class="ports-toolbar">
          <span v-for="port in portList" :key="port" class="port-tag">
            P{{ port }}
            <button v-if="portList.length > 1" class="delete-port" @click="removePort(port)" :title="`Remove port P${port}`">
              <img src="/img/delete.png" class="delete-icon" width="16px">
            </button>
          </span>
          <button v-if="portList.length < 10" class="add-port" @click="addPort">
            + Add Port
          </button>
        </div>

        <table class="instr-table" v-if="availableInstructions.length">
          <thead>
            <tr>
              <th>TYPE</th>
              <th>LATENCY</th>
              <!-- one TH per port -->
              <th v-for="port in portList" :key="port">P{{ port }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="instr in availableInstructions" :key="instr">
              <td>{{ instr }}</td>
              <td>
                <div class="latency-group">
                  <input type="number" v-model.number="resources[instr]" class="latency-input" min="1" max="99"
                         title="execution latency in clock cycles for the corresponding instruction type"/>
                </div>
              </td>
              <td v-for="port in portList" :key="port" class="port-checkbox">
                <label class="port-label">
                  <input
                    type="checkbox"
                    title="indicates if this port can execute the corresponding instruction type"
                    :checked="
                      (ports[port] || []).includes(instr)
                      || (port === portList[0] && noPortAssigned(instr))
                    "
                    @change="togglePortInstruction(port, instr, $event.target.checked)"
                  />
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div> <!--- Latency & Port Settings Group -->
    
    </div>
  </div>
  
  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition" 
    text="Modify the simulated processor’s <strong>configuration settings</strong>, including: (1) <em>Dispatch & Retire</em> Widths;
      (2) <em>Cache Memory</em> (Note: Setting Number of Blocks = 0 means all data accesses will always hit in the cache);
      (3) <em>Execution Ports</em> (Add or remove execution ports, up to a maximum of 10). 
      <p>Each instruction type can be assigned a latency and a set of eligible execution ports (only one is used per execution); 
         If a port is deleted, execution port P0 is automatically assigned to any instruction types left without a valid port.</p>"
    title="Processor Settings"
    @close="closeHelp1"/>

    <HelpComponent v-if="showHelp2" :position="helpPosition" 
    text="Modify the <strong>Dispatch</strong> and/or <strong>Retire</strong> Widths. 
       They indicate the maximum number of instructions per clock cycle that must be dispatched into or retired from the Execution Engine.
      <p>They may impose a throughput-bound performace limit.</p>"
    title="Dispatch/Retire Width Settings"
    @close="closeHelp2"/>

    <HelpComponent v-if="showHelp3" :position="helpPosition" 
    text="Modify the <strong>Cache Memory</strong> settings. Setting a Number of Blocks = 0 means all data accesses 
      will always hit in the cache, and, therefore, the latency of memory loads and stores will always be the same.
      <p>The cache miss latency indicates the extra time required to execute load and store instructions when they miss in the cache.
      The cache miss issue time (<strong>m</strong>) is the minimum time required to issue consecutive memory block read/write requests to the Main Memory. 
      It determines the maximum Main Memory bandwidth (one memory block every <strong>m</strong> clock cycles)</p>"
    title="Cache Memory Settings"
    @close="closeHelp3"/>

  <HelpComponent v-if="showHelp4" :position="helpPosition" 
    text="Modify the <strong>Latency</strong> and the maximum <strong>Execution Thorughput</strong> of instruction types.
      <p>Each instruction type can be assigned a fixed execution latency and a set of eligible execution ports 
         (only one is used for execution each instruction). A given execution port, named <em>Px</em>, can start executing one instruction every clock cycle.
        If a port is deleted, execution port P0 is automatically assigned to any instruction types left without a valid port.</p>"
    title="Instruction Latency and Throughput Settings"
    @close="closeHelp4"/>
    
  </Teleport>
  
  <!-- Modal Dialog -->
  <div v-if="showModalDown" class="modal-overlay">
    <div class="modal">
      <h4>Save Configuration As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" title="file name of new processor configuration" v-model="modalName"/>
      <div v-if="nameError" class="error">{{ nameError }}</div>

      <label class="download-checkbox">
        <input type="checkbox" v-model="modalDownload" />
        Download JSON file
        <span class="warning-wrapper" aria-label="Info">
          ⚠️
          <div class="tooltip-text">
            Saving a local copy is recommended as modified settings will not persist in your next session.
          </div>
        </span>
      </label>

      <div class="modal-actions">
        <button class="blue-button" title="Yes, I will save the current changes" @click="confirmModal">Apply</button>
        <button class="blue-button" title="No, I do not want to save the current changes" @click="closeModal">Cancel</button>
      </div>
    </div>
  </div>

  <div v-if="showModalUp" class="modal-overlay">
    <div class="modal">
      <h4>Load Configuration As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" title="name of loaded processor configuration" v-model="modalName"/>
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Yes, I want to load" @click="confirmModal">Load</button>
        <button class="blue-button" title="No, I want to cancel"  @click="closeModal">Cancel</button>
      </div>
    </div>
  </div>

  <div v-if="showModalChange" class="modal-overlay">
    <div class="modal">
      <p>The processor settings have been modified, but not saved. 
         Changes will be lost if you select or upload a new processor configuration.</p>
      <p><b>Do you want to continue?</b></p>
      <div class="modal-actions">
        <button class="blue-button" title="Yes, I want to continue" @click="confirmLeave">OK</button>
        <button class="blue-button" title="No, I want to cancel" @click="cancelLeave">Cancel</button>
      </div>
    </div>
  </div>

  <span id="auto-tooltip" ref="tooltip" class="auto-tooltip" :class="{ 'slide-in': showTooltip }">
    Each instruction type must have at least one assigned execution port; default is P0.
  </span>
</template>

<style scoped>

  .settings-sections {
    display:         flex;
    flex-direction:  column;
    justify-content: down;
    gap:             5px;
    width:           100%;
  }
  
  .settings-group {
    display:        flex;  /**/
    flex-direction: column;
    border:         1px solid #ccc;
    border-radius:  8px;
    padding:        1rem; /* 10px */
    background:     #fafafa;
  }

  .button-group {
    display:     inline-flex;
    align-items: center;
  }
  
  /* Chrome, Safari, Edge, Opera */
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button {
    -webkit-appearance: auto;
    width:      5ch;
    padding:    1px;
    margin:     0 2px;
    text-align: right;
  }

  /* Firefox */
  input[type=number] {
    appearance: auto;
    -moz-appearance: number-input;
    width:      5ch;
    padding:    1px;
    margin:     0 2px;
    text-align: right;
  }

  .ports-toolbar {
    margin: 8px 0;
  }
  .port-tag {
    display:       inline-block;
    background:    #e3e3e3;
    border-radius: 4px;
    padding:       2px;
    margin-right:  5px;
    margin-bottom: 5px;
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
    padding:       4px 8px;
    border-radius: 4px;
    cursor:        pointer;
    font-size:     0.9em;
  }
  .instr-table {
    width:           100%;
    margin-top:      10px;
    border-collapse: collapse;
  }
  .instr-table th,
  .instr-table td {
    border:     1px solid #ccc;
    padding:    5px;
    text-align: center;
  }

  .download-checkbox {
    display:    block;
    margin-top: 10px;
  }
  
  strong{
    margin:0;
  }
  .warning-wrapper {
    position: relative;
    display: inline-block;
    cursor: default;
  }

  .tooltip-text {
    visibility: hidden;
    width:      240px;
    color:      #fff;
    text-align: left;
    padding:    8px;
    font-size:  0.85em;
    position:   absolute;
    top:        50%;
    left:       100%;
    transform:  translate(8px, -50%);
    z-index:    10;
    opacity:    0;
    white-space:   normal;
    border-radius: 4px;
    transition:    opacity 0.2s ease-in-out;
    background-color: rgba(0, 0, 0, 0.7);
  }

  .warning-wrapper:hover .tooltip-text {
    visibility: visible;
    opacity: 1;
  }

  .auto-tooltip {
    position:fixed;
    background: rgba(0,0,0,0.7);
    color: #fff;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 2.2vh;
    white-space: nowrap;
    top: 35vh;
    right: 0;
    transform: translateX(100%);
    transition: transform 0.3s ease-in-out;
  }
  .auto-tooltip.slide-in {
    transform: translateX(0);
  }
</style>
