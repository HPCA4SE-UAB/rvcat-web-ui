<script setup>
  // Declarations of the edited program: data type of each variable, inferred from the texts and
  // fields of the instructions (src/instructionText.js). Setting the type of a variable here sets
  // it for all the variables that exchange values with it, and rewrites their instructions.
  import { reactive, computed, watch } from 'vue'
  import { sizeName } from '@/instructionText'

  const props = defineProps({
    variables: { type: Array, required: true },   // analyzeProgramText(...).variables
  })
  const emit = defineEmits(['declare', 'highlight'])

  const STORAGE_KEY = 'declarationsOptions'
  const options = reactive({ open: false })
  try { Object.assign(options, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')) } catch { /* defaults */ }
  watch(options, () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)) } catch { /* not persisted */ }
  })

  const SIZES = { INT: ['byte', 'word', 'long'], FLOAT: ['single', 'double'], '': ['byte', 'word', 'long'] }
  const conflicts = computed(() => new Set(props.variables.filter(v => v.conflict).map(v => v.root)).size)
  const unknown   = computed(() => props.variables.filter(v => !v.kind && v.role !== 'array').length)

  const roleText = (v) => (v.readOnly && v.role === 'data' ? 'read-only' : v.role) +
                          (v.readOnly && v.role !== 'data' && v.role !== 'size' ? ' (read-only)' : '')
  const ROLE_TITLE = {
    array: 'Array in memory: its type is the type of its elements',
    index: 'Memory index (always INT)', counter: 'Loop counter (always INT)',
    condition: 'Condition of a comparison or of the branch (always INT)',
    size: 'Number of elements in a backward index (N-c-i), always INT',
    data: 'Data computed by the loop', 'read-only': 'Value read by the loop and never written (e.g. N, a constant)',
  }

  function setType(v, type) {
    const size = type && v.bytes ? sizeName(type, v.bytes) ?? '' : (v.size ?? '')
    emit('declare', v.name, { type, size: SIZES[type].includes(size) ? size : '' })
  }
  const setSize = (v, size) => emit('declare', v.name, { type: v.kind ?? '', size })

  const statusTitle = (v) =>
    v.conflict ? `Incoherent data type: ${v.conflict}`
    : !v.kind && v.role !== 'array' ? 'Data type unknown: choose it here, or in the Type field of an instruction'
    : v.assumed ? 'Size not given by any instruction: word (4 bytes) assumed'
    : 'Coherent'
  const statusText = (v) => (v.conflict ? '⚠' : !v.kind && v.role !== 'array' ? '?' : v.assumed ? 'assumed' : '✔')
</script>

<template>
  <div class="declarations" id="declarations">
    <div class="decl-header">
      <button class="decl-toggle" id="declarations-toggle" @click="options.open = !options.open"
              title="Show/hide the data type of each variable, inferred from the instructions and saved with the program">
        {{ options.open ? '▾' : '▸' }} Declarations
      </button>
      <span class="decl-summary">
        {{ variables.length }} variable{{ variables.length === 1 ? '' : 's' }}
        <span v-if="conflicts" class="decl-conflict"> · ⚠ {{ conflicts }} incoherent type{{ conflicts > 1 ? 's' : '' }}</span>
        <span v-if="unknown" class="decl-unknown"> · {{ unknown }} unknown</span>
      </span>
    </div>
    <div v-if="options.open" class="decl-body">
      <div v-if="!variables.length" class="decl-note">Write the text of the instructions to see their variables.</div>
      <table v-else class="decl-table">
        <thead>
          <tr>
            <th>Variable</th><th>Role</th>
            <th title="Data type (arrays: type of their elements). Changing it rewrites the instructions of this variable and of the ones that exchange values with it">Type</th>
            <th>Size</th>
            <th title="Lanes of the vector register (x[0:3] → 4)">Lanes</th>
            <th title="Variables with the same data type, because they exchange values (operands and result, value and array)">Same data as</th>
            <th>Instructions</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in variables" :key="v.name" :class="{ conflict: v.conflict }"
              @mouseenter="emit('highlight', v.uses)" @mouseleave="emit('highlight', [])">
            <td class="decl-name">{{ v.name }}</td>
            <td :title="ROLE_TITLE[v.readOnly && v.role === 'data' ? 'read-only' : v.role]">{{ roleText(v) }}</td>
            <td>
              <select :value="v.kind ?? ''" @change="setType(v, $event.target.value)" :id="`decl-type-${v.name}`">
                <option value="">?</option><option>INT</option><option>FLOAT</option>
              </select>
            </td>
            <td>
              <select :value="v.size ?? ''" @change="setSize(v, $event.target.value)" :id="`decl-size-${v.name}`"
                      :title="v.bytes ? `${v.bytes} bytes` : 'Size unknown'">
                <option value="">?</option>
                <option v-for="s in SIZES[v.kind ?? '']" :key="s" :value="s">{{ s }}</option>
              </select>
            </td>
            <td>{{ v.lanes.length ? v.lanes.join(', ') : '' }}</td>
            <td class="decl-same">{{ v.sameData.join(', ') }}</td>
            <td>{{ v.uses.join(', ') }}</td>
            <td class="decl-status" :title="statusTitle(v)">{{ statusText(v) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
  .declarations {
    flex-shrink:   0;
    margin-top:    4px;
    border:        1px solid #ddd;
    border-radius: 5px;
    font-size:     small;
  }
  .decl-header {
    display:     flex;
    flex-wrap:   wrap;
    align-items: center;
    gap:         0.3em 1.2em;
    padding:     2px 6px;
  }
  .decl-toggle {
    background:  none;
    border:      none;
    padding:     2px 0;
    font-weight: 600;
    font-size:   small;
    color:       #0b2e5c;
    cursor:      pointer;
  }
  .decl-summary  { color: #444; }
  .decl-conflict { color: #8a6d00; }
  .decl-unknown  { color: #555; }
  .decl-body     { padding: 0 6px 4px; max-height: 32vh; overflow: auto; }
  .decl-note     { color: #555; }
  .decl-table    { border-collapse: collapse; }
  .decl-table thead { position: sticky; top: 0; background: #e8f1fa; z-index: 1; }
  .decl-table th, .decl-table td {
    border:      1px solid #ddd;
    padding:     1px 8px;
    white-space: nowrap;
    text-align:  center;
  }
  .decl-table select { font-size: small; }
  .decl-name   { font-family: monospace; font-weight: 600; }
  .decl-same   { font-family: monospace; color: #555; text-align: left; white-space: normal; max-width: 18em; }
  .decl-status { min-width: 4em; }
  .decl-table tr.conflict td { background: #fff3cd; }
  .decl-table tbody tr:hover td { background: #e8f4fd; }
</style>
