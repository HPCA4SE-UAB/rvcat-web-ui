<script setup>
  // Diagram of the execution engine of the processor, from top to bottom: the front-end (dispatch,
  // with the branch penalty), the ROB, the execution ports (with the operation types of each one)
  // joined to the memory (a single block), and the retire. Each box shows its value and, after a
  // simulation, its usage (a bar and the percentage); a click opens a balloon next to it, with an
  // explanation and the field to change the value (unless the lesson locks it). The memory opens
  // the window of the cache.
  import { computed, ref, reactive, nextTick, onMounted, onUnmounted } from 'vue'
  import { t } from '@/i18n'
  import { typeSizes, allOperationNames, removePortFrom, MAX_PORTS, unassignedOperations, usageColor } from '@/common'
  import { portTypeLines, memoryPorts, TYPE_COLOR } from '@/processorDiagram'

  const props = defineProps({
    process:   { type: Object, required: true },        // the simulated processor (edited in place)
    usage:     { type: Object, default: null },         // usage of the resources in the last simulation
    highlightPorts: { type: Array, default: () => [] }, // ports pointed in the timeline
    stage:     { type: String, default: '' },           // stage pointed in the timeline: dispatch, retire
    locked:    { type: Function, required: true },      // locked('processor.rob') ...
    inLesson:  { type: Boolean, default: false },       // a lesson in progress (the text of a locked field)
  })
  const emit = defineEmits(['openCache'])

  const p = computed(() => props.process ?? {})
  const portIds = computed(() => Object.keys(p.value.ports ?? {}))
  const memPorts = computed(() => new Set(memoryPorts(p.value.ports ?? {})))
  const linesOf = (port) => portTypeLines(p.value.ports?.[port] ?? [])
  const highlighted = computed(() => new Set((props.highlightPorts ?? []).map(String)))
  const hasCache = computed(() => Number(p.value.nBlocks) > 0)
  const unassigned = computed(() => unassignedOperations(p.value.ports ?? {}))
  const canEditPorts = computed(() => !props.locked('processor.ports'))
  const canEditLatencies = computed(() => !props.locked('processor.latencies'))

  // ---- usage: the percentage, its bar and its colour ----
  const pct = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? null : v
  const usageText = (v) => (pct(v) === null ? '' : `${v.toFixed(v < 10 ? 1 : 0)}%`)
  const barStyle = (v) => ({ width: `${Math.min(100, Math.max(0, v))}%`, background: usageColor(v) })

  // ---- the parameters with a field: dispatch, retire, ROB, branch penalty ----
  const FIELDS = {
    dispatch: { model: 'dispatch', min: 1, max: 9,   lock: 'dispatch', unit: () => t('per cycle'),
                explain: (n) => t('Dispatch width: up to {n} instruction(s) per cycle enter the ROB and the waiting buffer, in program order.', { n }) },
    rob:      { model: 'ROBsize',  min: 1, max: 200, lock: 'rob',      unit: () => t('entries'),
                explain: (n) => t('ROB (reorder buffer): up to {n} instructions in flight, from dispatch to retire; when it is full, dispatch stops.', { n }) },
    retire:   { model: 'retire',   min: 1, max: 9,   lock: 'retire',   unit: () => t('per cycle'),
                explain: (n) => t('Retire width: up to {n} completed instruction(s) per cycle leave the ROB in program order, updating the architected registers.', { n }) },
    bpenalty: { model: 'bPenalty', min: 0, max: 99,  lock: 'bPenalty', unit: () => t('cycles'),
                explain: (n) => t('Branch penalty: {n} cycles to refill the front-end after a mispredicted conditional branch (if c skip k) resolves.', { n }) },
  }
  const TITLES = { dispatch: 'Dispatch', rob: 'ROB', retire: 'Retire', bpenalty: 'Branch penalty' }

  // ---- the balloon: next to the box clicked ----
  // (below the diagram, over the Program panel: the diagram and the right panel (timeline, simulation)
  //  stay in view, to see the effect of a change at once; its arrow points to the box)
  const balloon = reactive({ kind: '', port: null, top: 0, left: 0, width: 320, arrow: 160, maxHeight: 400 })
  const rootRef = ref(null)
  const balloonRef = ref(null)
  const message = ref('')
  function open(kind, event, port = null) {
    const box = event.currentTarget.getBoundingClientRect()
    if (balloon.kind === kind && balloon.port === port) { close(); return }
    Object.assign(balloon, { kind, port })
    message.value = ''
    const diagram = rootRef.value?.getBoundingClientRect() ?? box
    const W = Math.min(360, Math.max(240, diagram.width - 8))
    const center = box.left + box.width / 2
    balloon.width = W
    balloon.left = Math.max(diagram.left + 4, Math.min(diagram.right - W - 4, center - W / 2))
    balloon.top = diagram.bottom + 10
    balloon.arrow = Math.max(14, Math.min(W - 14, center - balloon.left))
    balloon.maxHeight = Math.max(160, window.innerHeight - balloon.top - 12)
    nextTick(() => balloonRef.value?.querySelector('input, select, button')?.focus())
  }
  function close() { balloon.kind = ''; balloon.port = null }
  const outside = (e) => {
    if (!balloon.kind) return
    if (balloonRef.value?.contains(e.target) || e.target.closest?.('.pd-box')) return
    close()
  }
  const onKey = (e) => { if (e.key === 'Escape' && balloon.kind) close() }
  onMounted(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey) })
  onUnmounted(() => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey) })

  const field = computed(() => FIELDS[balloon.kind] ?? null)
  const fieldLocked = computed(() => field.value && props.locked(`processor.${field.value.lock}`))
  function setField(value) {
    const f = field.value
    if (!f || fieldLocked.value) return
    let v = Math.round(Number(value))
    if (!Number.isFinite(v)) { message.value = ''; return }
    if (v < f.min) { v = f.min; message.value = t('The minimum value is {min}', { min: f.min }) }
    else if (v > f.max) { v = f.max; message.value = t('The maximum value is {max}', { max: f.max }) }
    else message.value = ''
    p.value[f.model] = v
  }

  // ---- a port: its operation types with their latencies; in author mode, its structure ----
  const portEntries = computed(() => p.value.ports?.[balloon.port] ?? [])
  const sizesOf = (label) => (label.includes('.') ? typeSizes[label.split('.')[0]] ?? [] : [])
  const entrySize = reactive({})          // size chosen for the latency of each entry ('' = every size)
  function latencyOf(label, size = '') {
    const lat = p.value.latencies ?? {}
    if (size && lat[`${label}.${size}`] !== undefined) return lat[`${label}.${size}`]
    return lat[label] ?? lat[label.split('.')[0]] ?? 1
  }
  function setLatency(label, value, size = '') {
    if (!canEditLatencies.value) return
    const v = Math.min(99, Math.max(1, Math.round(Number(value)) || 1))
    const lat = p.value.latencies ??= {}
    if (size) { lat[`${label}.${size}`] = v; return }
    lat[label] = v
    for (const key of Object.keys(lat)) if (key.startsWith(`${label}.`)) lat[key] = v
  }
  const insertable = computed(() => allOperationNames().filter(op =>
    !portEntries.value.includes(op) && !portEntries.value.includes(op.split('.')[0])))
  const toInsert = ref('')
  function insertOp() {
    const list = p.value.ports?.[balloon.port]
    if (!list || !toInsert.value) return
    list.push(toInsert.value)
    if (!(toInsert.value in (p.value.latencies ?? {}))) setLatency(toInsert.value, latencyOf(toInsert.value))
    toInsert.value = ''
  }
  function removeOp(entry) {
    p.value.ports[balloon.port] = portEntries.value.filter(e => e !== entry)
  }
  function moveOp(entry, target) {
    const to = p.value.ports?.[target]
    if (!to || target === balloon.port) return
    p.value.ports[balloon.port] = portEntries.value.filter(e => e !== entry)
    if (!to.includes(entry)) to.push(entry)
  }
  function addPort() {
    if (portIds.value.length >= MAX_PORTS) return
    const ids = portIds.value.map(Number)
    const id = String(ids.length ? Math.max(...ids) + 1 : 0)
    p.value.ports = { ...p.value.ports, [id]: [] }
  }
  function removePort() {
    const id = balloon.port
    if (id === null || portIds.value.length <= 1) return
    if (portEntries.value.length && !confirm(t('Remove port P{p}? The operation types that only P{p} executes move to the first remaining port, and the ports are renumbered P0, P1, ...', { p: id })))
      return
    p.value.ports = removePortFrom(p.value.ports, id).ports
    close()
  }

  // ---- the memory: a summary; the window of the cache has all its parameters ----
  const memoryLines = computed(() => hasCache.value
    ? [`L1 ${p.value.nBlocks}×${p.value.blkSize} B`, `MM ${p.value.mPenalty ?? 10} c · FB ${p.value.nFillBuffers ?? 2}`]
    : [t('no cache')])
  // the explanation of the memory, a paragraph per part: the cache, the main memory, the fill buffers
  // and, only for programs with STOREs, the store buffer and the write buffers
  const hasStores = computed(() => [...(p.value.instruction_list ?? []), ...(p.value.epilogue ?? [])].some(i => i?.oper === 'STORE'))
  const memoryParagraphs = computed(() => {
    const v = p.value
    if (!hasCache.value) return [t('No cache: every memory access takes the latency of its instruction.')]
    const list = [
      t('L1 data cache: {blocks} blocks of {size} bytes ({total} bytes).', { blocks: v.nBlocks, size: v.blkSize, total: v.nBlocks * v.blkSize }),
      t('Main memory: a miss brings its block in {penalty} cycles; the memory accepts a request every {issue} cycle(s).', { penalty: v.mPenalty ?? 10, issue: v.mIssueTime ?? 1 }),
      t('Fill buffers: {fill}, the blocks that can be on the way at the same time; up to {ret} waiting LOAD(s) receive their data per cycle.', { fill: v.nFillBuffers ?? 2, ret: v.rThru ?? 1 }),
    ]
    if (hasStores.value) list.push(
      t('Store buffer (SB): {n} entries; a store waits there, after it retires, until it is written into the cache.', { n: v.nStoreBuffers ?? 16 }),
      t('Write buffers: {n}; an evicted dirty block waits there until it is written into the main memory.', { n: v.nWriteBuffers ?? 2 }))
    return list
  })
  const memoryExplain = computed(() => memoryParagraphs.value.join('\n\n'))
  function openCache() { close(); emit('openCache') }

  // (outside a lesson the student is not told that an author mode exists)
  const lockText = computed(() => props.inLesson ? t('This parameter cannot be changed in this lesson')
                                                 : t('This parameter cannot be changed in this mode'))
  const memoryRange = computed(() => {
    // the columns of the bus of the memory: from the first port joined to it to the memory
    const ids = portIds.value
    const first = ids.findIndex(id => memPorts.value.has(id))
    return first < 0 ? null : first
  })
</script>

<template>
  <div class="pd no-pin" id="processor-diagram" ref="rootRef">
    <!-- front-end: dispatch and the branch penalty -->
    <div class="pd-box pd-stage" id="pd-dispatch" :class="{ hl: stage === 'dispatch', open: balloon.kind === 'dispatch' }"
         :title="FIELDS.dispatch.explain(p.dispatch)" @click="open('dispatch', $event)">
      <span class="pd-name">Dispatch</span>
      <span class="pd-value">{{ p.dispatch }}<small>/{{ t('cycle') }}</small></span>
      <span v-if="pct(usage?.dispatch) !== null" class="pd-pct" :style="{ color: usageColor(usage.dispatch) }">{{ usageText(usage.dispatch) }}</span>
      <span class="pd-box pd-badge" id="pd-bpenalty" :class="{ open: balloon.kind === 'bpenalty' }"
            :title="FIELDS.bpenalty.explain(p.bPenalty ?? 5)" @click.stop="open('bpenalty', $event)">
        ⤳ {{ t('branch') }} {{ p.bPenalty ?? 5 }} c
        <b v-if="pct(usage?.branch) !== null" :style="{ color: usageColor(usage.branch) }">{{ usageText(usage.branch) }}</b>
      </span>
      <span v-if="pct(usage?.dispatch) !== null" class="pd-bar" :style="barStyle(usage.dispatch)"></span>
    </div>
    <div class="pd-arrow">↓</div>

    <!-- ROB -->
    <div class="pd-box pd-rob" id="pd-rob" :class="{ open: balloon.kind === 'rob' }"
         :title="FIELDS.rob.explain(p.ROBsize)" @click="open('rob', $event)">
      <span class="pd-name">ROB</span>
      <span class="pd-value">{{ p.ROBsize }} <small>{{ t('entries') }}</small></span>
      <span class="pd-rob-slots" aria-hidden="true"><i v-for="k in 12" :key="k"></i></span>
    </div>
    <div class="pd-arrow pd-arrows"><span>↓</span><span>↑</span></div>

    <!-- execution ports, and the memory joined to the ports of LOAD / STORE -->
    <div class="pd-ports" :style="{ gridTemplateColumns: `repeat(${portIds.length}, minmax(0, 1fr)) ${canEditPorts ? 'auto ' : ''}minmax(74px, 1.4fr)` }">
      <div v-for="id in portIds" :key="id" class="pd-box pd-port" :id="`pd-port-${id}`"
           :class="{ hl: highlighted.has(id), open: balloon.kind === 'port' && balloon.port === id }"
           :title="t('Port P{p}: executes {n} operation type(s), one instruction per cycle.', { p: id, n: (p.ports[id] ?? []).length })"
           @click="open('port', $event, id)">
        <span class="pd-port-head">P{{ id }}
          <span v-if="pct(usage?.ports?.[id]) !== null" class="pd-pct" :style="{ color: usageColor(usage.ports[id]) }">{{ usageText(usage.ports[id]) }}</span>
        </span>
        <span v-for="line in linesOf(id)" :key="line.type" class="pd-type" :style="{ background: TYPE_COLOR[line.type] }"
              :title="line.title">{{ line.label }}</span>
        <span v-if="!linesOf(id).length" class="pd-type pd-empty">—</span>
        <span v-if="pct(usage?.ports?.[id]) !== null" class="pd-bar" :style="barStyle(usage.ports[id])"></span>
      </div>
      <button v-if="canEditPorts" class="pd-add" id="pd-add-port" :disabled="portIds.length >= MAX_PORTS"
              :title="portIds.length >= MAX_PORTS ? t('At most {n} execution ports', { n: MAX_PORTS }) : t('Add a new execution port (then click its header to insert operation types)')"
              @click="addPort">＋</button>
      <div class="pd-box pd-memory" id="pd-memory" :class="{ open: balloon.kind === 'memory', off: !hasCache, hl: stage === 'memory' }"
           :title="memoryExplain" @click="open('memory', $event)">
        <span class="pd-name">{{ t('Memory') }}</span>
        <span v-for="line in memoryLines" :key="line" class="pd-mem-line">{{ line }}</span>
        <span v-if="pct(usage?.memory) !== null" class="pd-pct" :style="{ color: usageColor(usage.memory) }">MM {{ usageText(usage.memory) }}</span>
        <span v-if="pct(usage?.memory) !== null" class="pd-bar" :style="barStyle(usage.memory)"></span>
      </div>
      <!-- the bus between the ports of LOAD / STORE and the memory -->
      <template v-if="memoryRange !== null">
        <span v-for="(id, i) in portIds" :key="'bus' + id" class="pd-bus"
              :class="{ tick: memPorts.has(id), line: i >= memoryRange, start: i === memoryRange }"></span>
        <span v-if="canEditPorts" class="pd-bus line"></span>
        <span class="pd-bus line end"></span>
      </template>
    </div>
    <div v-if="canEditPorts && unassigned.length" class="pd-warning" id="pd-unassigned"
         :title="t('No port executes {ops}: programs that use them cannot be simulated. Click a port header to insert them.', { ops: unassigned.join(', ') })">
      ⚠ {{ unassigned.length > 1 ? t('{n} operation types without port', { n: unassigned.length }) : t('1 operation type without port') }}
    </div>
    <div class="pd-arrow">↓</div>

    <!-- retire -->
    <div class="pd-box pd-stage" id="pd-retire" :class="{ hl: stage === 'retire', open: balloon.kind === 'retire' }"
         :title="FIELDS.retire.explain(p.retire)" @click="open('retire', $event)">
      <span class="pd-name">Retire</span>
      <span class="pd-value">{{ p.retire }}<small>/{{ t('cycle') }}</small></span>
      <span v-if="pct(usage?.retire) !== null" class="pd-pct" :style="{ color: usageColor(usage.retire) }">{{ usageText(usage.retire) }}</span>
      <span v-if="pct(usage?.retire) !== null" class="pd-bar" :style="barStyle(usage.retire)"></span>
    </div>

    <!-- the balloon of the box clicked -->
    <Teleport to="body">
      <div v-if="balloon.kind" ref="balloonRef" class="pd-balloon no-pin" id="pd-balloon" role="dialog"
           :style="{ left: balloon.left + 'px', top: balloon.top + 'px', width: balloon.width + 'px', '--arrow': balloon.arrow + 'px' }">
        <button class="pd-close" @click="close" :title="t('Close')">✕</button>
        <div class="pd-body" :style="{ maxHeight: (balloon.maxHeight - 24) + 'px' }">

        <template v-if="field">
          <h4>{{ t(TITLES[balloon.kind]) }}</h4>
          <p>{{ field.explain(p[field.model] ?? 0) }}</p>
          <div v-if="!fieldLocked" class="pd-edit">
            <button @click="setField((p[field.model] ?? 0) - 1)" :title="t('Decrease')">−</button>
            <input type="number" :min="field.min" :max="field.max" :value="p[field.model]" id="pd-field"
                   @change="setField($event.target.value)" @keydown.enter="setField($event.target.value)" />
            <button @click="setField((p[field.model] ?? 0) + 1)" :title="t('Increase')">+</button>
            <span>{{ field.unit() }} ({{ field.min }}–{{ field.max }})</span>
          </div>
          <p v-else class="pd-lock">🔒 {{ lockText }}</p>
          <p v-if="message" class="pd-msg">{{ message }}</p>
          <p v-if="balloon.kind === 'bpenalty' && pct(usage?.branch) !== null" class="pd-note">{{ t('Percentage: mispredicted conditional branches in the last simulation.') }}</p>
          <p v-else-if="usage && balloon.kind !== 'rob'" class="pd-note">{{ t('Colored percentages: usage of each resource in the last simulation.') }}</p>
        </template>

        <template v-else-if="balloon.kind === 'port'">
          <h4>{{ t('Port P{p}', { p: balloon.port }) }}</h4>
          <p>{{ t('Port P{p}: executes {n} operation type(s), one instruction per cycle.', { p: balloon.port, n: portEntries.length }) }}</p>
          <table class="pd-ops">
            <tr><th>{{ t('Operation') }}</th><th>{{ t('Latency') }}</th><th v-if="canEditPorts"></th></tr>
            <tr v-for="entry in portEntries" :key="entry">
              <td><span class="pd-type" :style="{ background: TYPE_COLOR[entry.split('.')[0]] }">{{ entry }}</span></td>
              <td>
                <template v-if="canEditLatencies">
                  <select v-if="sizesOf(entry).length" v-model="entrySize[entry]" class="pd-size"
                          :title="t('Edit the latency of {op} for every data size, or for one size only', { op: entry })">
                    <option :value="undefined">{{ t('all sizes') }}</option>
                    <option v-for="s in sizesOf(entry)" :key="s" :value="s">{{ s }}</option>
                  </select>
                  <input type="number" min="1" max="99" :value="latencyOf(entry, entrySize[entry])"
                         @change="setLatency(entry, $event.target.value, entrySize[entry])" />
                </template>
                <span v-else>{{ latencyOf(entry) }}</span>
              </td>
              <td v-if="canEditPorts" class="pd-op-tools">
                <select :title="t('Move {op} from P{p} to another port', { op: entry, p: balloon.port })"
                        @change="moveOp(entry, $event.target.value); $event.target.value = ''">
                  <option value="">{{ t('move to…') }}</option>
                  <option v-for="q in portIds.filter(q => q !== balloon.port)" :key="q" :value="q">P{{ q }}</option>
                </select>
                <button @click="removeOp(entry)" :title="t('Remove {op} from port P{p}', { op: entry, p: balloon.port })">✕</button>
              </td>
            </tr>
          </table>
          <div v-if="canEditPorts" class="pd-edit">
            <select v-model="toInsert" :title="t('Operation type to insert in this port')">
              <option value="">{{ t('insert type…') }}</option>
              <option v-for="op in insertable" :key="op" :value="op">{{ op }}</option>
            </select>
            <button :disabled="!toInsert" @click="insertOp" :title="t('Insert the selected operation type in this port')">＋</button>
            <button :disabled="portIds.length <= 1" @click="removePort" :title="t('Remove this port')">✕ {{ t('port') }}</button>
          </div>
          <p v-if="!canEditLatencies && !canEditPorts" class="pd-lock">🔒 {{ lockText }}</p>
          <p class="pd-note">{{ t('Short names: + ARITH or ADD, & LOGIC, << SHIFT, × MUL, ÷ DIV, √ SQRT, cvt conversion, shf SHUFFLE, prm PERMUTE, LD LOAD, ST STORE; FP: FLOAT.') }}</p>
        </template>

        <template v-else-if="balloon.kind === 'memory'">
          <h4>{{ t('Memory') }}</h4>
          <p v-for="(par, k) in memoryParagraphs" :key="k">{{ par }}</p>
          <p v-if="pct(usage?.memory) !== null" class="pd-note">{{ t('Percentage: main memory busy in the last simulation.') }}</p>
          <div v-if="!locked('processor.cache')" class="pd-edit">
            <button class="pd-wide" id="pd-open-cache" @click="openCache">{{ t('Configure the cache…') }}</button>
          </div>
          <p v-else class="pd-lock">🔒 {{ lockText }}</p>
        </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
  .pd { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 4px 6px 6px; font-size: 0.78rem; user-select: none; }
  .pd-box {
    position: relative; overflow: hidden; border: 1.5px solid #7a8aa3; border-radius: 6px; background: #f4f7fb;
    cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s;
  }
  .pd-box:hover { border-color: #1a4fb3; box-shadow: 0 0 0 2px rgba(26, 79, 179, 0.15); }
  .pd-box.open  { border-color: #1a4fb3; box-shadow: 0 0 0 3px rgba(26, 79, 179, 0.3); }
  .pd-box.hl    { background: #ffcccc; border-color: #d32f2f; }
  .pd-stage { display: flex; align-items: center; gap: 8px; padding: 3px 8px; min-height: 24px; }
  .pd-name  { font-weight: 700; color: #1f2a3a; }
  .pd-value { font-weight: 700; color: #0b2e5c; font-size: 0.95rem; }
  .pd-value small { font-weight: 400; color: #555; font-size: 0.75rem; margin-left: 2px; }
  .pd-pct   { font-weight: 700; font-size: 0.75rem; }
  .pd-badge { margin-left: auto; padding: 1px 6px; font-size: 0.72rem; background: #fff; border-color: #b0b8c8; border-radius: 10px; }
  .pd-badge b { margin-left: 3px; }
  .pd-bar { position: absolute; left: 0; bottom: 0; height: 3px; opacity: 0.85; }
  .pd-arrow { text-align: center; line-height: 1; color: #4a5a73; font-size: 0.8rem; height: 12px; }
  .pd-arrows { display: flex; justify-content: center; gap: 18px; }
  .pd-rob { display: flex; align-items: center; gap: 8px; padding: 3px 8px; background: #e9eef6; }
  .pd-rob-slots { display: flex; gap: 2px; margin-left: auto; }
  .pd-rob-slots i { display: block; width: 7px; height: 12px; border: 1px solid #9aa8bf; background: #fff; border-radius: 1px; }
  .pd-ports { display: grid; column-gap: 3px; row-gap: 0; align-items: stretch; }
  .pd-port { display: flex; flex-direction: column; align-items: stretch; gap: 1px; padding: 2px 2px 5px; min-width: 0; }
  .pd-port-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; color: #1f2a3a; padding: 0 2px; }
  .pd-type {
    display: block; padding: 0 2px; border-radius: 3px; font-size: 0.66rem; line-height: 1.3; color: #1f2a3a;
    white-space: normal; overflow-wrap: anywhere; font-family: monospace;
  }
  .pd-empty { color: #999; text-align: center; background: transparent; }
  .pd-add { align-self: center; border: 1px dashed #7aa2e3; background: #f4f8ff; color: #1a4fb3; border-radius: 6px; cursor: pointer; padding: 2px 5px; }
  .pd-memory { display: flex; flex-direction: column; gap: 1px; padding: 3px 5px 6px; background: #f1ecf8; border-color: #5e35b1; }
  .pd-memory.off { background: #f5f5f5; border-color: #aaa; }
  .pd-mem-line { font-size: 0.7rem; color: #333; white-space: nowrap; }
  /* the bus: a line under the ports joined to the memory */
  .pd-bus { height: 8px; position: relative; }
  .pd-bus.line::after { content: ''; position: absolute; left: 0; right: -3px; top: 6px; border-top: 2px solid #5e35b1; }
  .pd-bus.start::after { left: 50%; }
  .pd-bus.end::after { right: 50%; }
  .pd-bus.tick::before { content: ''; position: absolute; left: 50%; top: 0; height: 7px; border-left: 2px solid #5e35b1; }
  .pd-bus.end::before  { content: ''; position: absolute; left: 50%; top: 0; height: 7px; border-left: 2px solid #5e35b1; }
  .pd-warning { margin-top: 2px; padding: 1px 6px; background: #fff3cd; color: #8a5a00; border-radius: 4px; font-size: 0.72rem; }

  .pd-balloon {
    position: fixed; z-index: 10005; width: 320px; max-width: calc(100vw - 16px); box-sizing: border-box;
    background: #fff; border: 1.5px solid #1a4fb3; border-radius: 8px; padding: 8px 10px 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); font-size: 0.82rem; color: #222;
  }
  .pd-body { overflow-y: auto; }
  .pd-balloon::before {
    content: ''; position: absolute; left: calc(var(--arrow) - 7px); top: -8px; width: 12px; height: 12px;
    background: #fff; border-left: 1.5px solid #1a4fb3; border-top: 1.5px solid #1a4fb3; transform: rotate(45deg);
  }
  .pd-balloon h4 { margin: 0 18px 4px 0; color: #0b2e5c; font-size: 0.92rem; }
  .pd-balloon p { margin: 0 0 6px; line-height: 1.35; }
  .pd-close { position: absolute; right: 6px; top: 4px; border: none; background: none; cursor: pointer; color: #888; }
  .pd-edit { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 4px 0 6px; }
  .pd-edit button { border: 1px solid #7aa2e3; background: #f4f8ff; color: #1a4fb3; border-radius: 4px; cursor: pointer; min-width: 26px; padding: 2px 6px; }
  .pd-edit button:disabled { opacity: 0.5; cursor: default; }
  .pd-edit input { width: 5em; padding: 2px 4px; }
  .pd-wide { padding: 3px 10px !important; }
  .pd-lock { color: #8a5a00; }
  .pd-msg  { color: #c62828; }
  .pd-note { color: #777; font-size: 0.74rem; }
  .pd-ops { border-collapse: collapse; width: 100%; margin: 2px 0 4px; }
  .pd-ops th { text-align: left; font-size: 0.72rem; color: #555; }
  .pd-ops td { padding: 1px 2px; vertical-align: middle; white-space: nowrap; }
  .pd-ops input { width: 3.6em; padding: 1px 3px; }
  .pd-ops .pd-type { display: inline-block; font-size: 0.72rem; }
  .pd-size { font-size: 0.7rem; max-width: 5.5em; margin-right: 2px; }
  .pd-op-tools { white-space: nowrap; }
  .pd-op-tools select { font-size: 0.72rem; max-width: 6.5em; }
  .pd-op-tools button { border: none; background: none; color: #c62828; cursor: pointer; }
</style>
