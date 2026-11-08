<script setup>
  import { t } from '@/i18n'
  // Memory trace of the edited program: elements and byte addresses accessed by each memory
  // instruction in the first and last K iterations. The addresses come from RVCAT
  // (get_memory_trace), so they are the ones the simulator uses.
  import { ref, reactive, computed, watch, inject, onMounted, onUnmounted } from 'vue'
  import { useRVCAT_Api } from '@/rvcatAPI'
  import { buildTraceView, effectiveN, elementRange, byteRange, formatAddress,
           traceToText, TRACE_MAX_K } from '@/memoryTrace'

  const props = defineProps({
    program:   { type: Array,   required: true },   // edited instruction list
    N:         { type: Number,  required: true },   // algorithmic operations
    blocked:   { type: String,  default: '' },      // reason why the trace cannot be computed
    rowIssues: { type: Object,  default: () => ({}) },
  })
  const emit = defineEmits(['highlight'])

  const { getMemoryTrace }            = useRVCAT_Api()
  const { registerHandler, isReady }  = inject('worker')

  const STORAGE_KEY = 'memoryTraceOptions'
  const options = reactive({ open: false, K: 4, hex: true })
  try { Object.assign(options, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')) } catch { /* defaults */ }
  watch(options, () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)) } catch { /* not persisted */ }
  })

  const trace   = ref(null)
  const error   = ref('')
  const copied  = ref(false)
  const view    = computed(() => (trace.value ? buildTraceView(trace.value) : null))
  const S       = computed(() => Number(props.program.at(-1)?.stride) || 1)
  const memoryCount = computed(() =>
    props.program.filter(i => (i.type === 'MEM' || i.type === 'VMEM') && i.source2?.trim()).length)

  // ---- Request the trace (debounced) when the program, N or K change ----
  const numberOr1 = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? 1 : Number(v))
  let timer = null
  function request() {
    clearTimeout(timer)
    if (!options.open || props.blocked || !memoryCount.value) return
    timer = setTimeout(() => {
      if (!isReady.value) return       // retried when the worker is ready
      const K = Math.min(TRACE_MAX_K, Math.max(1, Math.round(options.K) || 1))
      // Empty number inputs count as 1, as in the coherence checks
      const list = props.program.map(i => ({ ...i, stride: numberOr1(i.stride), lanes: numberOr1(i.lanes),
                                             constant: String(i.constant ?? '').trim() }))
      getMemoryTrace(JSON.stringify({ instruction_list: list }), effectiveN(props.N, S.value), K)
        .catch(e => { error.value = String(e?.message ?? e) })
    }, 200)
  }
  function handleTrace(data, dataType) {
    if (dataType === 'error') {
      error.value = String(data).split('\n').filter(Boolean).at(-1) ?? 'RVCAT error'
      trace.value = null
      return
    }
    try {
      trace.value = JSON.parse(data)
      error.value = ''
    } catch (e) {
      error.value = t('Invalid trace: {e}', { e: e.message })
    }
  }

  watch(() => [JSON.stringify(props.program), props.N, options.K, options.open, props.blocked, isReady.value],
        request, { immediate: true })

  let cleanup = null
  onMounted(()   => { cleanup = registerHandler('get_memory_trace', handleTrace) })
  onUnmounted(() => { cleanup?.(); clearTimeout(timer) })

  // ---- Presentation ----
  const columnTitle = (col) =>
    t('Instruction {i}: {text}', { i: col.index, text: props.program[col.index]?.text ?? '' }) + '\n' +
    t('{oper} of array {array}, {size}-byte elements, lanes {lanes}, stride {stride}, offset {c}',
      { oper: col.oper, array: col.array, size: col.size, lanes: col.lanes, stride: col.stride, c: col.constant }) + '\n' +
    t('Advances {n} elements = {b} bytes per iteration', { n: col.lanes * Math.abs(col.stride), b: col.lanes * Math.abs(col.stride) * col.size }) +
    (props.rowIssues[col.index] ? `\n\n${props.rowIssues[col.index].text.join('\n')}` : '')

  const cellTitle = (col, cell, k) =>
    t('Iteration {k}: {elements}, bytes {bytes}', { k, elements: elementRange(col.array, cell), bytes: byteRange(cell, false) }) +
    ` (${byteRange(cell, true)})` +
    (cell.outside ? '\n' + t('Outside the {n} elements swept by this access over the loop ({it} iterations × {step})',
                              { n: col.length, it: trace.value.iterations, step: col.lanes * Math.abs(col.stride) }) : '')

  const arrayTitle = (a) =>
    t('Array {name}: base address {base} ({hex}), {bytes} bytes.', { name: a.name, base: a.base, hex: formatAddress(a.base, true), bytes: a.bytes }) + ' ' +
    t('RVCAT places the arrays one after another, in program order, with the size reached by their accesses.')

  async function copyTrace() {
    if (!view.value) return
    try {
      await navigator.clipboard.writeText(traceToText(view.value, options.hex))
      copied.value = true
      setTimeout(() => { copied.value = false }, 1500)
    } catch (e) {
      error.value = t('Cannot copy: {e}', { e: e.message })
    }
  }
</script>

<template>
  <div class="memory-trace" id="memory-trace">
    <div class="trace-header">
      <button class="trace-toggle" id="memory-trace-toggle" @click="options.open = !options.open"
              :title="t('Show/hide the memory addresses accessed in the first and last iterations of the loop')">
        {{ options.open ? '▾' : '▸' }} {{ t('Memory trace') }}
      </button>
      <template v-if="options.open">
        <label :title="t('Iterations shown at the beginning and at the end of the loop')">
          {{ t('first / last') }}
          <input type="number" min="1" :max="TRACE_MAX_K" v-model.lazy.number="options.K" id="memory-trace-k" />
          {{ t('iterations') }}
        </label>
        <label :title="t('Byte addresses in hexadecimal')">
          <input type="checkbox" v-model="options.hex" id="memory-trace-hex" /> hex
        </label>
        <span v-if="view && !blocked" class="trace-summary">
          N = {{ view.N }} alg opers · S = {{ view.S }} · {{ view.iterations }} {{ t('iterations') }}
        </span>
        <button v-if="view && !blocked" class="trace-copy" id="memory-trace-copy" @click="copyTrace"
                :title="t('Copy the trace as tab-separated text')">
          {{ copied ? '✔ ' + t('Copied') : t('Copy') }}
        </button>
      </template>
    </div>

    <div v-if="options.open" class="trace-body">
      <div v-if="!memoryCount" class="trace-note">The program has no memory instructions with an array.</div>
      <div v-else-if="blocked" class="trace-note">{{ blocked }}</div>
      <div v-else-if="error" class="trace-error">✖ {{ error }}</div>
      <div v-else-if="!isReady" class="trace-note">Waiting for RVCAT…</div>
      <template v-else-if="view">
        <div class="trace-arrays">
          Arrays:
          <span v-for="a in view.arrays" :key="a.name" class="trace-array" :title="arrayTitle(a)">
            <b>{{ a.name }}</b> @{{ formatAddress(a.base, options.hex) }} ({{ a.bytes }} B)
          </span>
        </div>
        <div class="trace-table-container">
          <table class="trace-table">
            <thead>
              <tr>
                <th :title="t('Loop iteration (k)')">it</th>
                <th v-for="col in view.columns" :key="col.index" :title="columnTitle(col)"
                    @mouseenter="emit('highlight', col.index)" @mouseleave="emit('highlight', -1)">
                  #{{ col.index }} {{ col.oper }} {{ col.array }}<span v-if="rowIssues[col.index]" class="trace-issue">{{ rowIssues[col.index].kind === 'error' ? '✖' : '⚠' }}</span>
                  <div class="trace-col-info">L={{ col.lanes }} s={{ col.stride }} c={{ col.constant }} · {{ col.size }} B</div>
                  <div v-if="col.execProb < 1" class="trace-col-info"
                       :title="t('Conditional access: executed only in the iterations in which the branch does not skip it')">
                    conditional (p={{ col.execProb.toFixed(2) }})
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in view.rows" :key="row.k">
                <tr v-if="row.skipped > 0" class="trace-gap">
                  <td :colspan="view.columns.length + 1">⋮ {{ row.skipped }} iteration{{ row.skipped > 1 ? 's' : '' }}</td>
                </tr>
                <tr>
                  <td class="trace-k">{{ row.k }}</td>
                  <td v-for="(cell, c) in row.cells" :key="c" :class="{ outside: cell.outside }"
                      :title="cellTitle(view.columns[c], cell, row.k)"
                      @mouseenter="emit('highlight', view.columns[c].index)" @mouseleave="emit('highlight', -1)">
                    <span class="trace-elem">{{ elementRange(view.columns[c].array, cell) }}</span>
                    <span class="trace-bytes">{{ byteRange(cell, options.hex) }}</span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
  .memory-trace {
    flex-shrink:   0;
    margin-top:    4px;
    border:        1px solid #ddd;
    border-radius: 5px;
    font-size:     small;
  }
  .trace-header {
    display:     flex;
    flex-wrap:   wrap;
    align-items: center;
    gap:         0.3em 1.2em;
    padding:     2px 6px;
  }
  .trace-header label {
    display:     inline-flex;
    align-items: center;
    gap:         0.3em;
  }
  .trace-header input[type="number"] { width: 3.5em; text-align: center; }
  .trace-toggle {
    background:  none;
    border:      none;
    padding:     2px 0;
    font-weight: 600;
    font-size:   small;
    color:       #0b2e5c;
    cursor:      pointer;
  }
  .trace-summary { color: #444; }
  .trace-copy {
    margin-left:   auto;
    padding:       1px 8px;
    border:        1px solid #ccc;
    border-radius: 4px;
    background:    white;
    cursor:        pointer;
  }
  .trace-body { padding: 0 6px 4px; }
  .trace-note  { color: #555; }
  .trace-error { color: #b00020; }
  .trace-arrays {
    display:   flex;
    flex-wrap: wrap;
    gap:       0.2em 1em;
    margin-bottom: 3px;
  }
  .trace-table-container {
    max-height: 32vh;
    overflow:   auto;
    border:     1px solid #ddd;
  }
  .trace-table {
    border-collapse: collapse;
    font-family:     monospace;
    font-size:       small;
  }
  .trace-table thead {
    position:   sticky;
    top:        0;
    background: #e8f1fa;
    z-index:    1;
  }
  .trace-table th, .trace-table td {
    border:      1px solid #ddd;
    padding:     1px 8px;
    white-space: nowrap;
    text-align:  center;
  }
  .trace-col-info { font-weight: normal; color: #555; }
  .trace-issue    { margin-left: 3px; color: #8a6d00; }
  .trace-k        { font-weight: 600; color: #0b2e5c; }
  .trace-elem     { font-weight: 600; }
  .trace-bytes    { margin-left: 0.8em; color: #555; }
  .trace-gap td   { color: #888; background: #fafafa; font-style: italic; }
  .trace-table td.outside { background: #fde2e2; }
  .trace-table td.outside .trace-elem { color: #b00020; }
  .trace-table tbody tr:hover { background: #e8f4fd; }
</style>
