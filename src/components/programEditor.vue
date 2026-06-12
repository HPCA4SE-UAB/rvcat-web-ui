<script setup>
  import { ref, toRef, toRaw, watchEffect, onMounted, onUnmounted,
           nextTick, inject, reactive, watch }                       from "vue"
  import { useDraggable, useResizeObserver}                 from '@vueuse/core'
  import HelpComponent                    from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'
  import { downloadJSON, uploadJSON, createGraphVizGraph,
           instructionTypes, typeOperations, typeSizes       }  from '@/common'

  const { getProgGraph }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');

  const props = defineProps({
    isFullscreen: {
      type: Boolean,
      default: false
    }
  });

// ============================================================================
// Program options & localStorage
// ============================================================================

const STORAGE_KEY = 'programEditOptions'

  const defaultOptions = {
    showInOut:         true,
    showActions:       true,
    showGraph:         false,
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

  const programEditOptions = reactive(defaultOptions)
  const programSvg     = ref('')
  const showFullScreen = ref(false)
  let   graphTimeout   = null

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(programEditOptions, JSON.parse(saved))
        console.log('📄load program edit options')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('📄default load program edit options')
      }
    } catch (error) {
      console.error('📄❌ Failed to load:', error)
    }
  }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(programEditOptions))
    } catch (error) {
      console.error('📄❌ Failed to save:', error)
    }
  }

  watchEffect(() => { // Dependences: re-evaluated when they change
    const fullscreen = props.isFullscreen;

    if (fullscreen) { // maybe edited program has changed
      nextTick(() => {
        loadEditedProgram();
      })
    }
  })

// ============================================================================
// Draggable & resizable full-screen graph container
// ============================================================================

  const HEADER_HEIGHT = 48
  const MIN_W = 200
  const MIN_H = 200

  const headerRef  = ref(null)
  const contentRef = ref(null)

  const x = toRef(programEditOptions, 'x_pos')
  const y = toRef(programEditOptions, 'y_pos')

  const { isDragging } = useDraggable(headerRef, {
    initialValue: { x: programEditOptions.x_pos, y: programEditOptions.y_pos },

    onMove(pos) {

      const w = programEditOptions.windowWidth
      const h = programEditOptions.windowHeight

      const maxX = window.innerWidth  - w
      const maxY = window.innerHeight - HEADER_HEIGHT

      x.value = Math.min(Math.max(pos.x, 0), maxX)
      y.value = Math.min(Math.max(pos.y, 0), maxY)
    }
  })

  useResizeObserver(contentRef, (entries) => {
    const { width: w, height: h } = entries[0].contentRect

    const maxWidth  = window.innerWidth  - programEditOptions.x_pos
    const maxHeight = window.innerHeight - programEditOptions.y_pos

    programEditOptions.windowWidth  = Math.max(MIN_W, Math.min(w, maxWidth))
    programEditOptions.windowHeight = Math.max(MIN_H, Math.min(h, maxHeight))
  })

  window.addEventListener("resize", () => {

    const w = programEditOptions.windowWidth
    const h = programEditOptions.windowHeight

    x.value = Math.min(x.value, window.innerWidth - w)
    y.value = Math.min(y.value, window.innerHeight - HEADER_HEIGHT)
  })

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
      return {
        text:    inst.text    || '', type:    inst.type    || '',  oper:     inst.oper     || '',
        size:    inst.size    || '', destin:  inst.destin  || '',  source1:  inst.source1  || '',
        source2: inst.source2 || '', source3: inst.source3 || '',  constant: inst.constant || ''
      };
    });
    console.log('📄Edited Program Reloaded from local storage')
  } catch (e) {
    console.error('📄❌ Failed to load edited program from localStorage:', e);
  }
}

// ============================================================================
// WATCHES
// ============================================================================
  watch( () => [programEditOptions.showInOut, programEditOptions.showActions, programEditOptions.showGraph,
           programEditOptions.windowWidth, programEditOptions.windowHeight],
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

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
  let cleanupHandleGraph= null

  onMounted(() => {
    loadOptions()
    cleanupHandleGraph = registerHandler('get_prog_graph', handleGraph);
    loadEditedProgram()
    console.log('📄🎯 Program Editor Component mounted')
  });

  onUnmounted(() => {
    if (cleanupHandleGraph) {
       cleanupHandleGraph();
       cleanupHandleGraph= null
    }
    console.log('📄👋 Program Editor Component unmounted')
  });

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
//        normalizeInstruction, snapshotProgram
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
      constant: ''
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
    constant: (inst.constant || '').trim()
  };
}

function snapshotProgram() {
  return {
    name:             'programTemp',
    instruction_list: editedProgram.value.map(inst => normalizeInstruction(inst))
  };
}

  function toggleInOut  () { programEditOptions.showInOut   = !programEditOptions.showInOut }
  function toggleActions() { programEditOptions.showActions = !programEditOptions.showActions }

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
      programEditOptions.showGraph = true
    } catch (error) {
      console.error('📄❌Failed to generate program graph:', error)
    }
  }

  function closeFullScreen()   { showFullScreen.value = false;  programEditOptions.showGraph = false}

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

  function clearProgram() {
    editedProgram.value  = [];
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

</script>

<template>
  <div>
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Program Editor</span>
      </div>

      <button class="blue-button add-prev-margin" :class="{ active: programEditOptions.showInOut }"
          title="Show/Hide instruction Input/Output operands"
          id="show-inout-operands"
        @click="toggleInOut">
        <span v-if="programEditOptions.showInOut">✔ </span>
        InOut
      </button>

      <button class="blue-button add-margin" :class="{ active: programEditOptions.showActions }"
          title="Show/Hide column with buttons for moving/adding/removing instructions"
          id="show-instruction-actions"
          @click="toggleActions">
        <span v-if="programEditOptions.showActions">✔ </span>
        Actions
      </button>

      <button class="blue-button add-prev-margin" :class="{ active: programEditOptions.showGraph }"
          title="View/Update program's dependence graph on full-screen"
          id="open-edited-program-graph"
          @click="openFullScreen">
        <span v-if="programEditOptions.showGraph">✔ </span>
        View Graph
      </button>

      <div class="settings-container">
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

    <div class="instructions-section">
      <div class="horizontal-layout">
        <div class="table-container">
          <table class="instructions-table">
            <thead>
              <tr>
                <th style="width: 20px;">  # </th>
                <th v-if="programEditOptions.visibleCols.text"     style="width: 600px;"> Text    </th>
                <th v-if="programEditOptions.visibleCols.type"     style="width: 100px;"> Type    </th>
                <th v-if="programEditOptions.visibleCols.oper"     style="width: 100px;"> Oper    </th>
                <th v-if="programEditOptions.visibleCols.size"     style="width: 100px;"> Size    </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Destin  </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Source1 </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Source2 </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Source3 </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Constant</th>
                <th v-if="programEditOptions.showActions" style="width: 100px;"> Actions </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(inst, index) in editedProgram" :key="index">
                <td>{{ index }}</td>

                <td v-if="programEditOptions.visibleCols.text">
                  <input type="text" v-model="inst.text" class="table-input" title="Free text describing instruction" />
                </td>

                <td v-if="programEditOptions.visibleCols.type">
                  <select v-model="inst.type" class="table-select" title="Select instruction type">
                    <option value="">Select...</option>
                    <option v-for="type in instructionTypes" :key="type" :value="type">
                      {{ type }}
                    </option>
                  </select>
                </td>

                <td v-if="programEditOptions.visibleCols.oper">
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

                <td v-if="programEditOptions.visibleCols.size">
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

                <td v-if="programEditOptions.showInOut">
                  <input type="text" v-model="inst.destin" class="table-input" />
                </td>

                <td v-if="programEditOptions.showInOut">
                  <input type="text" v-model="inst.source1" class="table-input" />
                </td>

                <td v-if="programEditOptions.showInOut">
                  <input type="text" v-model="inst.source2" class="table-input" />
                </td>

                <td v-if="programEditOptions.showInOut">
                  <input type="text" v-model="inst.source3" class="table-input" />
                </td>

                <td v-if="programEditOptions.showInOut">
                  <input type="text" v-model="inst.constant" class="table-input" />
                </td>

                <td v-if="programEditOptions.showActions" class="actions-cell">

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

                <td v-if="programEditOptions.visibleCols.text" title="This final conditional branch is fixed">
                  <span class="table-input readonly">if c go back</span>
                </td>

                <td v-if="programEditOptions.visibleCols.type">
                  <span class="table-select readonly">BRANCH</span>
                </td>

                <td v-if="programEditOptions.visibleCols.oper">
                  <span class="table-select readonly"> </span>
                </td>

                <td v-if="programEditOptions.visibleCols.size">
                  <span class="table-select readonly"> </span>
                </td>

                <td v-if="programEditOptions.showInOut">
                  <span class="table-input readonly"> </span>
                </td>

                <td v-if="programEditOptions.showInOut">
                  <span class="table-input readonly">c</span>
                </td>

                <td v-if="programEditOptions.showInOut">
                  <span class="table-input readonly"> </span>
                </td>

                <td v-if="programEditOptions.showInOut">
                  <span class="table-input readonly"> </span>
                </td>
                <td v-if="programEditOptions.showInOut">
                  <span class="table-input readonly"> </span>
                </td>

                <td v-if="programEditOptions.showActions" class="actions-cell">
                  <span class="table-input readonly"> 🔒 </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div v-if="showFullScreen" class="fullscreen-overlay" @click.self="closeFullScreen">
    <div class="fullscreen-content"
      ref="contentRef"
      :style="{
        left: x + 'px',
        top: y + 'px',
        width: programEditOptions.windowWidth + 'px',
        height: programEditOptions.windowHeight + 'px'
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
       informal language. The description of each instruction can be modified: text, type, input/destination operands, constants.
        Programs can be edited/uploaded/downloaded in JSON format."
      title="Program Edition"
    @close="closeHelp"  />
  </Teleport>
</template>

<style scoped>
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
    display: flex;
    align-items: center;
    gap: 10px;
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

  tr:hover {
    background-color: rgba(0,0,0,0.05);
  }

</style>
