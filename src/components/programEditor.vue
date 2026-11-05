<script setup>
  import { ref, toRef, toRaw, watchEffect, onMounted, onUnmounted,
           nextTick, inject, reactive, watch, computed }             from "vue"
  import { useDraggable, useResizeObserver}                 from '@vueuse/core'
  import HelpComponent                    from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'
  import { downloadJSON, uploadJSON, createGraphVizGraph,
           instructionTypes, typeOperations, typeSizes,
           normalizeProgramDefaults, MAX_LOGICAL_ELEMENT_COUNT }  from '@/common'
  import MemoryTrace                                         from '@/components/MemoryTrace.vue'
  import DeclarationsTable                                   from '@/components/DeclarationsTable.vue'
  import ProgramDescription                                  from '@/components/ProgramDescription.vue'
  import { analyzeProgramText, deriveRowFields, fillFromText, declarationsFromAnalysis,
           declareVariable, checkDeclarations }               from '@/instructionText'
  import { programDraftFrom, isEmptyProgramDraft }           from '@/editDrafts'
  import { checkProgram, enforceStructure, VECTOR_TYPES, MEMORY_TYPES,
           VECTOR_WIDTHS, vectorWidth }                       from '@/programChecks'
  import { analyzeLoop, vectorizeLoop, transformLoop }       from '@/loopTransforms'
  import { PROGRAM_EDITOR_HELP }                             from '@/programEditorHelp'

  const { getProgGraph }    = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  // Opened with an empty draft: start from the program currently selected
  function seedDraftFromCurrentProgram() {
    let draft = null
    try { draft = JSON.parse(localStorage.getItem('programTemp')) } catch { /* invalid draft */ }
    if (isEmptyProgramDraft(draft) && simState.simulatedProcess?.instruction_list?.length) {
      localStorage.setItem('programTemp', JSON.stringify(programDraftFrom(simState.simulatedProcess)))
    }
  }

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
    showStrideLanes:   true,
    showActions:       true,
    showGraph:         false,
    windowWidth:       500,
    windowHeight:      300,
    x_pos:             10,
    y_pos:             10
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
        seedDraftFromCurrentProgram();
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

  useDraggable(headerRef, {
    initialValue: { x: programEditOptions.x_pos, y: programEditOptions.y_pos },

    onMove(pos) {

      const w = programEditOptions.windowWidth

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

    x.value = Math.min(x.value, window.innerWidth - w)
    y.value = Math.min(y.value, window.innerHeight - HEADER_HEIGHT)
  })

// ============================================================================
// Temporal in-edition program
// ============================================================================

const editedProgram = ref([]);
// N (algorithmic operations) stored with the program: default N when the program is selected,
// and N of the memory trace. Programs without N take the N of the Program panel.
const editedN = ref(100)
// Declarations of the program (data type of its variables): seeds of the type inference,
// set from the JSON file or from the declarations table
const declarations = ref([])
// Width in bytes of the vector registers (null: the largest vector instruction)
const editedVlen = ref(null)
// Source code (e.g. C) of the loop, saved with the program
const editedDescription = ref('')
const autoVlen   = computed(() => vectorWidth(editedProgram.value, null))
// Text of the instructions vs their fields, and data types (src/instructionText.js)
const textAnalysis = computed(() => analyzeProgramText(editedProgram.value, declarations.value))
function validN(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_LOGICAL_ELEMENT_COUNT) : null
}
function panelN() {
  try { return validN(JSON.parse(localStorage.getItem('programOptions'))?.N) ?? 100 } catch { return 100 }
}
const editedNModel = computed({
  get: () => editedN.value,
  set: (value) => { editedN.value = validN(value) ?? editedN.value }
})
function loadEditedProgram() {
  const stored = localStorage.getItem('programTemp');
  if (!stored) return;
  try {
    const data = normalizeProgramDefaults(JSON.parse(stored));
    editedN.value = validN(data.N) ?? panelN()
    editedVlen.value = VECTOR_WIDTHS.includes(data.vlen) ? data.vlen : null
    editedDescription.value = typeof data.description === 'string' ? data.description : ''
    declarations.value = Array.isArray(data.declarations) ? data.declarations : []
    editedProgram.value = (data.instruction_list || []).map(inst => {
      return {
        text:    inst.text    || '', type:    inst.type    || '',  oper:     inst.oper     || '',
        size:    inst.size    || '', destin:  inst.destin  || '',  source1:  inst.source1  || '',
        source2: inst.source2 || '', source3: inst.source3 || '',  constant: inst.constant || '',
        stride:  inst.stride  ?? 1,  lanes:   inst.lanes   ?? 1
      };
    }).map((inst, index, all) => index === all.length - 1 ? inst : enforceStructure(inst));
    console.log('📄Edited Program Reloaded from local storage')
  } catch (e) {
    console.error('📄❌ Failed to load edited program from localStorage:', e);
  }
}

// ============================================================================
// WATCHES
// ============================================================================
  watch( () => [programEditOptions.showInOut, programEditOptions.showStrideLanes,
                programEditOptions.showActions, programEditOptions.showGraph,
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

    const stored = localStorage.getItem('programTemp');
    if (!stored) clearProgram()
    // localStorage.setItem('programTemp', JSON.stringify(val));

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
        localStorage.setItem('programTemp', JSON.stringify(data));
        loadEditedProgram()
        undoProgram.value = null
        warnDeclarations(data)
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
      constant: '',
      stride: 1,
      lanes:  1
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
    stride:   inst.stride ?? 1,
    lanes:    inst.lanes  ?? 1
  };
}

// ---- Coherence of loop stride, lanes and memory accesses (docs/program-editor-rules.md) ----
const isVectorType = (inst) => VECTOR_TYPES.includes(inst?.type)
const isMemoryType = (inst) => MEMORY_TYPES.includes(inst?.type)

const checks = computed(() => {
  const structure = checkProgram(editedProgram.value, { vlen: editedVlen.value })
  return { errors:   structure.errors,
           warnings: [...structure.warnings, ...textAnalysis.value.warnings],
           infos:    textAnalysis.value.infos }
})
// Problems of each instruction, shown on its row number (error > warning > info)
const RANK = { info: 0, warning: 1, error: 2 }
const rowIssues = computed(() => {
  const map = {}
  for (const [kind, items] of [['error', checks.value.errors], ['warning', checks.value.warnings], ['info', checks.value.infos]]) {
    for (const item of items) {
      if (item.index < 0) continue
      map[item.index] ??= { kind, text: [] }
      if (RANK[kind] > RANK[map[item.index].kind]) map[item.index].kind = kind
      map[item.index].text.push(`${item.code}: ${item.message}`)
    }
  }
  return map
})
const ISSUE_MARK = { error: '✖', warning: '⚠', info: 'ℹ' }

// ---- Autofill from the text ----
// Values of the select fields that are not valid for the type are cleared
function sanitizeInstruction(inst) {
  if (inst.oper && !(typeOperations[inst.type] ?? []).includes(inst.oper)) inst.oper = ''
  if (inst.size && !(typeSizes[inst.type] ?? []).includes(inst.size)) inst.size = ''
  enforceStructure(inst)
}
// Fields that could not be deduced when the text was written (e.g. the stride of A[i] before
// the counter i = i + 1 exists): they are filled when they can be deduced, unless edited by hand
const LATER_FIELDS = ['type', 'oper', 'size', 'stride']
const pendingFields = new WeakMap()
const pendingOf = (inst) => pendingFields.get(toRaw(inst))
function keepField(inst, field) { pendingOf(inst)?.delete(field) }

// The text of an instruction changed: every field deduced from it is overwritten
function applyText(index) {
  const inst = editedProgram.value[index]
  if (!inst) return
  const derived = deriveRowFields(editedProgram.value, index, declarations.value)
  fillFromText(inst, derived)
  sanitizeInstruction(inst)
  pendingFields.set(toRaw(inst), new Set(derived ? LATER_FIELDS.filter(f => derived[f] === null) : []))
}
// Empty Type/Oper/Size fields, and the pending ones, are filled as soon as they can be deduced
// (e.g. when another instruction gives the data type of a variable)
watch(textAnalysis, (analysis) => {
  analysis.derived.forEach((d, index) => {
    const inst = editedProgram.value[index]
    if (!d || !inst || inst.type === 'BRANCH') return
    const pending = pendingOf(inst)
    let changed = false
    for (const field of LATER_FIELDS) {
      const empty = field !== 'stride' && !String(inst[field] ?? '').trim()
      if ((empty || pending?.has(field)) && d[field] !== null && d[field] !== undefined) {
        if (field === 'stride' && !isMemoryType(inst)) continue
        if (String(inst[field]) !== String(d[field])) { inst[field] = d[field]; changed = true }
        pending?.delete(field)
      }
    }
    // a vector type known only now: its lanes come from the text
    if (changed && VECTOR_TYPES.includes(inst.type) && d.lanes > 1) inst.lanes = d.lanes
    if (changed) sanitizeInstruction(inst)
  })
})
// Data type set in the declarations table
function onDeclare(name, selection) {
  const result = declareVariable(editedProgram.value, declarations.value, name, selection)
  declarations.value = result.declarations
  for (const { index, fields } of result.updates) {
    const inst = editedProgram.value[index]
    Object.assign(inst, fields)
    const d = textAnalysis.value.derived[index]
    if (VECTOR_TYPES.includes(inst.type) && d?.lanes > 1) inst.lanes = d.lanes
    sanitizeInstruction(inst)
  }
}
function warnDeclarations(program) {
  const messages = checkDeclarations(program)
  if (messages.length)
    alert(`The declarations of program "${program.name}" are not coherent with its instructions:\n` +
          messages.map(m => `• ${m}`).join('\n'))
}

// Loop stride S = algorithmic operations per iteration, stored in the final BRANCH
const loopStrideModel = computed({
  get: () => editedProgram.value.at(-1)?.stride ?? 1,
  set: (value) => {
    const branch = editedProgram.value.at(-1)
    const S = Math.round(Number(value))
    if (branch) branch.stride = Number.isFinite(S) && S >= 1 ? S : 1
  }
})

// Changing the type keeps the structure coherent: stride only for memory, lanes only for vectors
function onTypeChange(inst) {
  keepField(inst, 'type')
  inst.oper = ''
  inst.size = ''
  enforceStructure(inst)
}

// ---- Unroll / vectorize assistant (src/loopTransforms.js) ----
const showTransform    = ref(false)
// blocks: model of the vector registers when data crosses 128-bit blocks ('avx', 'generic'; null: not chosen)
const transformOptions = reactive({ lanes: 1, unroll: 2, splitAccumulators: false, blocks: null })
const undoProgram      = ref(null)    // program before the last transformation

const loopInfo = computed(() => analyzeLoop(editedProgram.value))
// Why the loop cannot be vectorized ('' when it can)
const vectorizeBlock = computed(() => vectorizeLoop(editedProgram.value, 4).errors.join(' '))
const transformPreview = computed(() => {
  if (transformOptions.lanes < 2 && transformOptions.unroll < 2) return null
  return transformLoop(editedProgram.value, {
    lanes:  vectorizeBlock.value ? 1 : transformOptions.lanes,
    unroll: transformOptions.unroll,
    splitAccumulators: transformOptions.splitAccumulators,
    blocks:            transformOptions.blocks ?? 'generic',
    declarations:      declarations.value,
  })
})
// Instructions per algorithmic operation before and after the transformation
const instrPerAlgOp = (list) => (list?.length ? list.length / (Number(list.at(-1).stride) || 1) : 0)

function openTransform() {
  transformOptions.lanes  = 1
  transformOptions.unroll = 2
  transformOptions.splitAccumulators = false
  transformOptions.blocks = null
  showTransform.value = true
}

function applyTransform() {
  const result = transformPreview.value
  if (!result?.program) return
  undoProgram.value = editedProgram.value.map(inst => ({ ...inst }))
  editedProgram.value = result.program.map(inst => ({
    text:    inst.text    ?? '', type:    inst.type    ?? '', oper:     inst.oper     ?? '',
    size:    inst.size    ?? '', destin:  inst.destin  ?? '', source1:  inst.source1  ?? '',
    source2: inst.source2 ?? '', source3: inst.source3 ?? '', constant: String(inst.constant ?? ''),
    stride:  Number(inst.stride ?? 1), lanes: Number(inst.lanes ?? 1)
  }))
  undoVlen = editedVlen.value
  if (result.vlen) editedVlen.value = result.vlen
  showTransform.value = false
}

let undoVlen = null
function undoTransform() {
  if (!undoProgram.value) return
  editedProgram.value = undoProgram.value
  editedVlen.value = undoVlen
  undoProgram.value = null
}

// Instruction highlighted from the memory trace (-1: none)
const tracedRows = ref([])

const issueLine = (item) =>
  `• ${item.code}${item.index >= 0 ? ` (instruction ${item.index})` : ''}: ${item.message}`

function snapshotProgram() {
  return {
    name:             'programTemp',
    ...(editedDescription.value.trim() ? { description: editedDescription.value } : {}),
    N:                editedN.value,
    ...(editedVlen.value ? { vlen: editedVlen.value } : {}),
    declarations:     declarationsFromAnalysis(textAnalysis.value),
    instruction_list: editedProgram.value.map(inst => normalizeInstruction(inst))
  };
}

  function toggleInOut  ()     { programEditOptions.showInOut   = !programEditOptions.showInOut }
  function toggleStrideLanes() { programEditOptions.showStrideLanes = !programEditOptions.showStrideLanes }
  function toggleActions()     { programEditOptions.showActions = !programEditOptions.showActions }

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
        getProgGraph(
          JSON.stringify( toRaw(editedProgram.value), null, 2),
          1, true, false, false, true
        )
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

  // Errors block saving the program; warnings ask for confirmation
  function requestDownload() {
    const { errors, warnings } = checks.value
    if (errors.length) {
      alert(`The program cannot be saved until these errors are fixed:\n${errors.map(issueLine).join('\n')}`)
      return
    }
    if (warnings.length &&
        !confirm(`The program has possible incoherences:\n${warnings.map(issueLine).join('\n')}\n\nSave it anyway?`))
      return
    showModalDownload.value = true
  }

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

  function clearProgram() {
    editedProgram.value  = [{ text: "if c go back", type: "BRANCH", oper: "",
      size: "", destin: "", source1: "c", source2: "", source3: "", constant: "",
      stride: 1, lanes: 1}];
    showModalClear.value = false;
    undoProgram.value = null
    declarations.value = []
    editedVlen.value = null
    editedDescription.value = ''
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

      <button class="blue-button toggle-button add-prev-margin"
              :class="{ active: programEditOptions.showInOut }"
          title="Show/Hide instruction Input/Output operands"
          id="show-inout-operands"
        @click="toggleInOut">
        <span v-if="programEditOptions.showInOut">✔ </span>
        InOut
      </button>

      <button class="blue-button toggle-button add-margin"
              :class="{ active: programEditOptions.showStrideLanes }"
          title="Show/Hide instruction Stride & vector lanes"
          id="show-mem-operands"
        @click="toggleStrideLanes">
        <span v-if="programEditOptions.showStrideLanes">✔ </span>
        Stride/Lanes
      </button>

      <button class="blue-button toggle-button add-margin"
              :class="{ active: programEditOptions.showActions }"
          title="Show/Hide column with buttons for moving/adding/removing instructions"
          id="show-instruction-actions"
          @click="toggleActions">
        <span v-if="programEditOptions.showActions">✔ </span>
        Actions
      </button>

      <label class="loop-stride-field" id="editor-loop-stride"
             title="Loop stride S = algorithmic operations (iterations of the original loop) done by each iteration: 1 for the original loop, U for a loop unrolled U times, L×U for a loop vectorized with L lanes and unrolled U times. The loop runs N/S iterations.">
        Alg opers/iter (S):
        <input type="number" min="1" step="1" v-model.lazy.number="loopStrideModel" id="editor-loop-stride-input" />
      </label>
      <label class="loop-stride-field editor-n-field" id="editor-n"
             :title="`N = algorithmic operations (iterations of the original loop), 1 - ${MAX_LOGICAL_ELEMENT_COUNT}. It is saved with the program and becomes the N of the Program panel when the program is selected. The memory trace uses it.`">
        N:
        <input type="number" min="1" :max="MAX_LOGICAL_ELEMENT_COUNT" step="1" v-model.lazy.number="editedNModel" id="editor-n-input" />
      </label>
      <label class="loop-stride-field editor-n-field" id="editor-vlen"
             title="Width in bytes of the vector registers. A vector instruction holds width / element size lanes (e.g. 32 bytes: 8 single or 4 double); a conversion between single and double is done in two halves. Auto: the largest vector instruction of the program.">
        Vector regs:
        <select v-model="editedVlen" id="editor-vlen-select">
          <option :value="null">auto{{ autoVlen ? ` (${autoVlen} B)` : '' }}</option>
          <option v-for="w in VECTOR_WIDTHS" :key="w" :value="w">{{ w }} B</option>
        </select>
      </label>
      <button class="blue-button add-margin" id="open-loop-transform" @click="openTransform"
              title="Assistant: unroll and/or vectorize this loop, with a coherent loop stride, lanes, memory strides and offsets">
        Unroll / Vectorize…
      </button>
      <button v-if="undoProgram" class="blue-button add-margin" id="undo-loop-transform" @click="undoTransform"
              title="Go back to the program before the last unroll / vectorize">
        ↶ Undo
      </button>

      <button class="blue-button toggle-button add-prev-margin" :class="{ active: programEditOptions.showGraph }"
          title="View/Update program's dependence graph on full-screen"
          id="open-edited-program-graph"
          @click="openFullScreen">
        <span v-if="programEditOptions.showGraph">✔ </span>
        View Graph
      </button>

      <div class="settings-container">
        <div class="buttons">
          <button class="blue-button" @click="requestDownload"
               title="Save current edited program (after checking its coherence)"
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
                <th style="width: 600px;"> Text    </th>
                <th style="width: 100px;"> Type    </th>
                <th style="width: 100px;"> Oper    </th>
                <th style="width: 100px;"> Size    </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Destin  </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Source1 </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Source2 </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Source3 </th>
                <th v-if="programEditOptions.showInOut"   style="width: 80px;">  Constant</th>
                <th v-if="programEditOptions.showStrideLanes" style="width: 80px;">  Stride </th>
                <th v-if="programEditOptions.showStrideLanes" style="width: 80px;">  Lanes  </th>
                <th v-if="programEditOptions.showActions" style="width: 100px;"> Actions </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(inst, index) in editedProgram.slice(0, editedProgram.length - 1)" :key="index"
                  :class="[rowIssues[index] ? 'row-' + rowIssues[index].kind : '', { 'row-traced': tracedRows.includes(index) }]">
                <td :title="rowIssues[index]?.text.join('\n')">
                  {{ index }}<span v-if="rowIssues[index]" class="row-issue">{{ ISSUE_MARK[rowIssues[index].kind] }}</span>
                </td>

                <td>
                  <input type="text" v-model="inst.text" class="table-input" @change="applyText(index)"
                         title="Text of the instruction, e.g. sum = sum + tmp, tmp = V[i+1], V[N-1-i] = x, x[0:3] = y[0:3] * z[0:3]. When it changes, the fields deduced from it are filled in (help: Instruction text)" />
                </td>

                <td>
                  <select v-model="inst.type" class="table-select" title="Select instruction type"
                          @change="onTypeChange(inst)">
                    <option value="">Select...</option>
                    <option v-for="type in instructionTypes" :key="type" :value="type">
                      {{ type }}
                    </option>
                  </select>
                </td>

                <td>
                  <select v-model="inst.oper" @change="keepField(inst, 'oper')" :disabled="!inst.type || typeOperations[inst.type].length === 0"
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

                <td>
                  <select v-model="inst.size" @change="keepField(inst, 'size')" :disabled="!inst.type || !inst.oper || typeSizes[inst.type].length === 0"
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

                <td v-if="programEditOptions.showStrideLanes">
                  <input v-if="isMemoryType(inst)" type="number" step="1" v-model.number="inst.stride" @change="keepField(inst, 'stride')" class="table-input"
                         title="Memory stride s: the access advances lanes × s elements per iteration (negative: backwards from the end of the array; 0: the same elements in every iteration). Usually lanes × s = S." />
                  <span v-else class="table-input readonly" title="Only memory instructions have a stride">–</span>
                </td>

                <td v-if="programEditOptions.showStrideLanes">
                  <input v-if="isVectorType(inst)" type="number" min="2" step="1" v-model.number="inst.lanes" class="table-input"
                         title="Vector lanes L: elements processed by this vector instruction" />
                  <span v-else class="table-input readonly" title="Scalar instruction: 1 lane">1</span>
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
                    :disabled="index === editedProgram.length - 2"
                    class="action-btn"
                    title="Move down"
                  >
                    ▼
                  </button>

                  <button
                    @click="removeInstruction(index)"
                    :disabled="editedProgram.length === 2"
                    class="action-btn delete"
                    title="Delete"
                  >
                    ✕
                  </button>

                  <button
                    @click="addInstruction(index)"
                    class="action-btn"
                    title="Insert new instruction before this one"
                  >
                    ▶️
                  </button>

                </td>
              </tr>

              <!-- 🔒 Fila fija final -->
              <tr v-if="editedProgram.length" class="fixed-row"
                  :class="rowIssues[editedProgram.length - 1] ? 'row-' + rowIssues[editedProgram.length - 1].kind : ''">
                <td :title="rowIssues[editedProgram.length - 1]?.text.join('\n')">
                  {{editedProgram.length-1}}<span v-if="rowIssues[editedProgram.length - 1]" class="row-issue">{{ ISSUE_MARK[rowIssues[editedProgram.length - 1].kind] }}</span>
                </td>

                <td title="This final conditional branch is fixed">
                  <span class="table-input readonly">if c go back</span>
                </td>

                <td title="This final conditional branch is fixed">
                  <span class="table-select readonly">BRANCH</span>
                </td>

                <td title="This final conditional branch is fixed">
                  <span class="table-select readonly"> </span>
                </td>

                <td title="This final conditional branch is fixed">
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
                <td v-if="programEditOptions.showStrideLanes"
                    title="Loop stride S: edit it in 'Alg opers/iter (S)' above">
                  <span class="table-input readonly"> S={{ loopStrideModel }} </span>
                </td>
                <td v-if="programEditOptions.showStrideLanes"
                title="This final conditional branch is fixed">
                  <span class="table-input readonly"> 1 </span>
                </td>
                <td v-if="programEditOptions.showActions" class="actions-cell"
                  title="This final conditional branch is fixed">
                  <span class="table-input readonly"> 🔒 </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="coherence-panel" id="program-coherence">
        <div v-if="!checks.errors.length && !checks.warnings.length" class="coherence-ok">
          ✔ Loop stride, lanes, memory accesses, texts and data types are coherent
        </div>
        <div v-for="(item, k) in checks.errors" :key="'e' + k" class="coherence-error">
          ✖ <strong>{{ item.code }}</strong><span v-if="item.index >= 0"> · instr {{ item.index }}</span>: {{ item.message }}
        </div>
        <div v-for="(item, k) in checks.warnings" :key="'w' + k" class="coherence-warning">
          ⚠ <strong>{{ item.code }}</strong><span v-if="item.index >= 0"> · instr {{ item.index }}</span>: {{ item.message }}
        </div>
        <div v-for="(item, k) in checks.infos" :key="'i' + k" class="coherence-info">
          ℹ <strong>{{ item.code }}</strong> · instr {{ item.index }}: {{ item.message }}
        </div>
      </div>
      <ProgramDescription v-model="editedDescription" />
      <DeclarationsTable :variables="textAnalysis.variables" @declare="onDeclare"
                         @highlight="tracedRows = $event" />
      <MemoryTrace :program="editedProgram" :N="editedN" :rowIssues="rowIssues"
                   :blocked="checks.errors.length ? 'Fix the errors (✖) to see the memory trace.' : ''"
                   @highlight="tracedRows = $event >= 0 ? [$event] : []" />
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

  <div v-if="showTransform" class="modal-overlay" @click.self="showTransform = false">
    <div class="modal transform-modal" id="loop-transform-dialog">
      <h4>Unroll / vectorize the loop</h4>
      <p class="transform-intro">
        Current loop: S = {{ loopInfo.S }}<span v-if="loopInfo.vectorized">, vectorized with {{ loopInfo.lanes }} lanes</span>,
        {{ editedProgram.length }} instructions per iteration.
        The assistant sets the loop stride, lanes, memory strides and offsets coherently;
        edit the result manually only for special cases.
      </p>

      <div class="transform-options">
        <label title="Each vector holds L elements of the smallest data size of the loop (L iterations of the original loop): S × L. Elements twice as large use L/2 lanes, in two halves">
          Vectorize:
          <select v-model.number="transformOptions.lanes" :disabled="!!vectorizeBlock" id="transform-lanes">
            <option :value="1">no</option>
            <option v-for="L in [2, 4, 8, 16]" :key="L" :value="L">{{ L }} lanes</option>
          </select>
        </label>
        <label title="Each iteration repeats the body U times: S × U">
          Unroll:
          <select v-model.number="transformOptions.unroll" id="transform-unroll">
            <option :value="1">no</option>
            <option v-for="U in [2, 3, 4, 6, 8]" :key="U" :value="U">{{ U }} times</option>
          </select>
        </label>
        <label v-if="loopInfo.reductions.length"
               title="Each unrolled copy accumulates in its own variable: the dependence chain is split into U shorter chains (the partial results are added after the loop)">
          <input type="checkbox" v-model="transformOptions.splitAccumulators" :disabled="transformOptions.unroll < 2"
                 id="transform-split" />
          Partial accumulators for {{ loopInfo.reductions.join(', ') }}
        </label>
      </div>
      <div v-if="vectorizeBlock" class="transform-why">Cannot vectorize: {{ vectorizeBlock }}</div>
      <div v-if="transformPreview?.rearrange?.question" class="transform-blocks" id="transform-blocks">
        <div>
          This loop moves data across the 128-bit blocks of the vector registers:
          {{ transformPreview.rearrange.reasons.join('; ') }}. How should these moves be done?
        </div>
        <label title="x86 AVX: registers made of 128-bit blocks. Moving elements across blocks needs PERMUTE instructions (3 cycles in Intel processors); within a block, SHUFFLE (1 cycle)">
          <input type="radio" value="avx" v-model="transformOptions.blocks" id="transform-blocks-avx" />
          AVX: generate the PERMUTE instructions (more latency than SHUFFLE)
        </label>
        <label title="Generic vector model, without 128-bit blocks: conversions read and write halves of registers directly, and reversals are SHUFFLE instructions">
          <input type="radio" value="generic" v-model="transformOptions.blocks" id="transform-blocks-generic" />
          Generic vector model, without 128-bit blocks
        </label>
      </div>

      <template v-if="transformPreview">
        <div v-for="(e, k) in transformPreview.errors" :key="'te' + k" class="coherence-error">✖ {{ e }}</div>
        <template v-if="transformPreview.program">
          <div class="transform-summary" id="transform-summary">
            Result: S = {{ transformPreview.program.at(-1).stride }} ·
            <template v-if="transformPreview.vlen">vector registers of {{ transformPreview.vlen }} bytes ·</template>
            {{ transformPreview.program.length }} instructions per iteration ·
            instructions per algorithmic operation {{ instrPerAlgOp(editedProgram).toFixed(2) }} →
            <strong>{{ instrPerAlgOp(transformPreview.program).toFixed(2) }}</strong>
          </div>
          <div v-for="(n, k) in transformPreview.notes" :key="'tn' + k" class="transform-note">• {{ n }}</div>
          <div v-for="(w, k) in transformPreview.checks.warnings" :key="'tw' + k" class="coherence-warning">
            ⚠ {{ w.code }}: {{ w.message }}
          </div>
          <div class="transform-preview">
            <table class="instructions-table">
              <thead>
                <tr><th>#</th><th>Text</th><th>Type</th><th>Oper</th><th>Lanes</th><th>Stride</th><th>Constant</th></tr>
              </thead>
              <tbody>
                <tr v-for="(inst, k) in transformPreview.program" :key="k">
                  <td>{{ k }}</td><td class="preview-text">{{ inst.text }}</td><td>{{ inst.type }}</td><td>{{ inst.oper }}</td>
                  <td>{{ inst.type === 'BRANCH' ? '' : (inst.lanes ?? 1) }}</td>
                  <td>{{ inst.type === 'BRANCH' ? 'S=' + inst.stride : (['MEM', 'VMEM'].includes(inst.type) ? inst.stride : '') }}</td>
                  <td>{{ inst.constant }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>
      <div v-else class="transform-note">Choose a number of lanes and/or an unrolling factor.</div>

      <div class="modal-actions">
        <button class="blue-button" id="apply-loop-transform"
                :disabled="!transformPreview?.program || (transformPreview.rearrange?.question && !transformOptions.blocks)"
                title="Replace the edited program with the transformed one (↶ Undo restores it)" @click="applyTransform">
          Apply
        </button>
        <button class="blue-button" title="Close without changes" @click="showTransform = false">Cancel</button>
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
    <HelpComponent v-if="showHelp" :position="helpPosition" :text="PROGRAM_EDITOR_HELP"
      title="Program Edition"
    @close="closeHelp" />
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

  .loop-stride-field {
    display:     inline-flex;
    align-items: center;
    gap:         0.3em;
    margin-left: 0.6em;
    font-size:   small;
    font-weight: 600;
    white-space: nowrap;
  }
  .editor-n-field { margin-right: 0.6em; }
  .loop-stride-field input {
    width:       3.5em;
    text-align:  center;
  }
  .row-issue {
    margin-left: 2px;
    font-size:   0.8em;
  }
  .instructions-table tbody tr.row-warning td:first-child { background: #fff3cd; color: #8a6d00; }
  .instructions-table tbody tr.row-error   td:first-child { background: #fde2e2; color: #b00020; }
  .instructions-table tbody tr.row-info    td:first-child { color: #555; }
  .instructions-table tbody tr.row-traced { outline: 2px solid #007acc; outline-offset: -2px; background: #e8f4fd; }
  .coherence-panel {
    flex-shrink:   0;
    max-height:    9em;
    overflow-y:    auto;
    margin-top:    4px;
    padding:       3px 6px;
    font-size:     small;
    border:        1px solid #ddd;
    border-radius: 5px;
  }
  .transform-modal {
    width:      min(56rem, 94vw);
    max-height: 90vh;
    overflow-y: auto;
    box-sizing: border-box;
    font-size:  small;
  }
  .transform-modal h4 { margin: 0 0 0.4em; }
  .transform-intro    { margin: 0 0 0.6em; }
  .transform-options {
    display:   flex;
    flex-wrap: wrap;
    gap:       0.5em 1.5em;
    align-items: center;
    margin-bottom: 0.5em;
    font-weight: 600;
  }
  .transform-options label {
    display:     inline-flex;
    align-items: center;
    gap:         0.3em;
  }
  .transform-why     { color: #8a6d00; margin-bottom: 0.4em; }
  .transform-blocks {
    margin:        0.4em 0;
    padding:       0.4em 0.6em;
    border:        1px solid #c9a227;
    border-radius: 5px;
    background:    #fffbe6;
  }
  .modal .transform-blocks label { display: flex; align-items: center; gap: 0.4em; margin: 0.3em 0 0; font-weight: normal; }
  .modal .transform-blocks input { width: auto; margin: 0; padding: 0; }
  .transform-summary { margin: 0.4em 0; }
  .transform-note    { color: #444; }
  .transform-preview {
    max-height: 40vh;
    overflow:   auto;
    margin-top: 0.5em;
    border:     1px solid #ddd;
  }
  .transform-preview td { font-size: small; padding: 1px 6px; }
  .transform-preview .preview-text { text-align: left; white-space: nowrap; }

  .coherence-ok      { color: #2e7d32; }
  .coherence-error   { color: #b00020; }
  .coherence-warning { color: #8a6d00; }
  .coherence-info    { color: #666; }

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
    margin-right: 24px;
  }
  .add-prev-margin {
    margin-left: 40px;
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
