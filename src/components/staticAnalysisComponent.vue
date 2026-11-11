<script setup>
  import { t } from '@/i18n'
  import { ref, toRaw, onMounted, onUnmounted, onBeforeUnmount,
           nextTick, inject, watch, reactive, computed }      from 'vue'
  import HelpComponent             from '@/components/helpComponent.vue'
  import DependenceGraphWindow     from '@/components/DependenceGraphWindow.vue'
  import { createGraphVizGraph }                         from '@/common'
  import { useRVCAT_Api }                              from '@/rvcatAPI'
  import { throughputBoundRows, latencyBoundRows }     from '@/performanceBounds'
  import { loopStride, cyclesPerAlgOp, algOpFormula, strideWarning, ALG_OP_HELP, ALG_OP_UNIT } from '@/algOps'

  const { getDependenceGraph, getPerformanceAnalysis } = useRVCAT_Api();
  const { registerHandler } = inject('worker');
  const simState            = inject('simulationState');

  /* ------------------------------------------------------------------
   * Dependence Graph options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'dependentGraphOptions'
  const defaultOptions = {
    iters:       1,
    showIntern:  false,
    showLaten:   false,
    showSmall:   false,
    showFull:    false
  }

  const dependenceGraphOptions = reactive(defaultOptions)
  const dependenceGraphSvg     = ref('')

  // Floating window with the dependence graph (open/closed is remembered)
  const GRAPH_OPEN_KEY = 'dependenceGraphOpen'
  const graphOpen = ref(localStorage.getItem(GRAPH_OPEN_KEY) === 'true')
  watch(graphOpen, (open) => {
    try { localStorage.setItem(GRAPH_OPEN_KEY, String(open)) } catch { /* ignore */ }
    if (open) createDependenceGraph()
  })

  let cleanupHandleGraph    = null
  let cleanupHandleAnalysis = null

  const performanceData = ref({
    name:                "No data",
    LatencyTime:         0.0,
    ThroughputTime:      0.0,
    "performance-bound":   "N/A",
    BestTime:            0.0,
    "Throughput-Bounds": [],
    "Latency-Bounds":    []
  })

  const throughputTable = computed(() =>
    throughputBoundRows(performanceData.value['Throughput-Bounds'],
                        simState.simulatedProcess?.instruction_list ?? [], undefined,
                        performanceData.value.ExecProbability)
  )
  const latencyTable = computed(() =>
    latencyBoundRows(performanceData.value['Latency-Bounds'],
                     simState.simulatedProcess?.instruction_list ?? [])
  )
  const minimumTimeFormula = computed(() => {
    const { LatencyTime: lat, ThroughputTime: thr, BestTime: best } = performanceData.value
    return t('max{latency bound, throughput bound} = max{{a}, {b}} = {c} cycles/iter',
             { a: lat.toFixed(2), b: thr.toFixed(2), c: best.toFixed(2) })
  })
  // Algorithmic operations: with loop stride S > 1 (unrolled or SIMD loop) the tables add a
  // "Cycles/Alg Oper" column = cycles/iter ÷ S, comparable with the baseline loop
  const stride       = computed(() => loopStride(simState.simulatedProcess?.instruction_list))
  const showAlgOps   = computed(() => stride.value > 1)
  const warning      = computed(() => strideWarning(simState.simulatedProcess?.instruction_list))
  const algOpValue   = (cycles) => cyclesPerAlgOp(cycles, stride.value)?.toFixed(2) ?? '—'
  const algOpTitle   = (cycles) => algOpFormula(cycles, stride.value)
  const algOpHeaderTitle = computed(() =>
    `${t('Cycles per algorithmic operation = cycles/iter ÷ {s} (loop stride).', { s: stride.value })} ${t(ALG_OP_HELP)}`)

  // Latency bound selected in the table: highlighted in the graph window
  const selectedChainKey = ref(null)
  const selectedChain = computed(() =>
    latencyTable.value.rows.find(r => r.key === selectedChainKey.value) ?? null)

  // State seen by the tutorials (validations and actions)
  watch([graphOpen, selectedChain], ([open, chain]) => {
    simState.analysisView = { graphOpen: open, chain: chain?.variable ?? null }
  }, { immediate: true })

  function selectChain(row) {
    if (selectedChainKey.value === row.key) {   // second click: show the whole graph again
      selectedChainKey.value = null
      return
    }
    selectedChainKey.value = row.key
    // Show enough iterations to follow the whole cycle back to its first instruction
    const needed = Math.min(7, (row.iterations ?? 1) + 1)
    if (dependenceGraphOptions.iters < needed) dependenceGraphOptions.iters = needed
    graphOpen.value = true
  }

  // Hovering an instruction number highlights it in the program panel and in the graph
  function hoverInstruction(index) { simState.instrHighlightedIdx = index }

  // Tooltip with HTML (bold words) of the throughput table, below the element under the mouse
  const tip = ref(null)
  function showTip(event, html) {
    if (!html) return
    const r = event.currentTarget.getBoundingClientRect()
    tip.value = { html, left: Math.min(r.left, window.innerWidth - 340), top: r.bottom + 6 }
  }
  function hideTip() { tip.value = null }
  function enterInstr(event, instr) { hoverInstruction(instr.index); showTip(event, instr.tip) }
  function leaveInstr() { hoverInstruction(-1); hideTip() }

  const boundLabel = computed(() => ({
    LATENCY:              t('LATENCY-bound'),
    THROUGHPUT:           t('THROUGHPUT-bound'),
    'LATENCY+THROUGHPUT': t('LATENCY+THROUGHPUT-bound'),
  }[performanceData.value['performance-bound']] ?? 'N/A'))

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(dependenceGraphOptions, JSON.parse(saved))
        console.log('🔎load options')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('🔎default load options')
      }
    } catch (error) {
      console.error('🔎❌ Failed to load:', error)
    }
  }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dependenceGraphOptions))
    } catch (error) {
      console.error('🔎❌ Failed to save:', error)
    }
  }

  function getAnalysis() {
    if (simState.state >= 3 && simState.simulatedProcess) {
      const { name, ROBsize, dispatch, retire, instruction_list } = simState.simulatedProcess
      const bPenalty = simState.simulatedProcess.bPenalty ?? 5
      getPerformanceAnalysis(JSON.stringify( { name, ROBsize, dispatch, retire, bPenalty, instruction_list: toRaw(instruction_list)}, null, 2));
    }
  }

  function createDependenceGraph() {
    if (graphOpen.value && simState.state >= 3 && simState.simulatedProcess) {
      getDependenceGraph(
        JSON.stringify( toRaw(simState.simulatedProcess.instruction_list), null, 2),
        dependenceGraphOptions.iters,
        dependenceGraphOptions.showIntern,
        dependenceGraphOptions.showLaten,
        dependenceGraphOptions.showSmall,
        dependenceGraphOptions.showFull
      )
    }
  }

  let unwatch            = null

  onMounted(() => {
    cleanupHandleGraph    = registerHandler('get_dependence_graph',     handleGraph);
    cleanupHandleAnalysis = registerHandler('get_performance_analysis', handleAnalysis);
    loadOptions() // load options or store it if not present (first run)
    getAnalysis() // load performance data for current process if it exists
    nextTick(() => {
      unwatch = watch(dependenceGraphOptions, () => {
          try {
            dependenceGraphOptions.iters = Math.min(dependenceGraphOptions.iters, 7);
            dependenceGraphOptions.iters = Math.max(dependenceGraphOptions.iters, 1);
            createDependenceGraph()
            saveOptions()
            console.log('🔎✅ Saved graph options')
          } catch (error) {
            console.error('🔎❌Failed to create dependence graph:', error)
          }
        },
        { immediate: true, deep: false})
      console.log('🔎🎯 Static Analysis Component mounted')
    })
  })

  onBeforeUnmount(() => {
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  })

  // Clean up on unmount
  onUnmounted(() => {
    if (cleanupHandleGraph) {
        cleanupHandleGraph();
        cleanupHandleAnalysis();
        cleanupHandleGraph    = null;
        cleanupHandleAnalysis = null
    }
    console.log('🔎👋 Static Analysis Component unMounted')
  })

 /* ------------------------------------------------------------------
  * Dependence Graph options: UI actions
  * ------------------------------------------------------------------ */
  watch (simState.simulatedProcess, () => {
      getAnalysis()
      createDependenceGraph()
      console.log('🔎✅ Graph updated')
  },
  { deep: true, immediate: false })

  // Handler for 'get_dependence_graph' message (fired by RVCAT getDependenceGraph function)
  const handleGraph = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('🔎❌Failed to get dependence graph:', data);
      return;
    }
    try {
      const svg = await createGraphVizGraph(data);
      dependenceGraphSvg.value = svg.outerHTML;
      console.log('🔎✅ Dependence Graph updated')
    } catch (error) {
      console.error('🔎❌Failed to generate SVG for graphviz Dependence Graph:', error)
      dependenceGraphSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  // Handler for 'get_performance_analysis' message (fired by RVCAT getPerformanceAnalysis function)
  const handleAnalysis = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('🔎❌Failed to get performance analysis:', data);
      return;
    }
    try {
      // fields of programs with conditional branches: removed so that they do not remain from a previous program
      for (const key of ['LatencyRange', 'ThroughputRange', 'Branches', 'ExecProbability', 'MispredictionsPerIter',
                         'BranchPenalty', 'MispredictTime', 'EstimatedTime'])
        delete performanceData.value[key]
      Object.assign(performanceData.value, JSON.parse(data))  // let VUE understand reactive action
      simState.performanceAnalysis = performanceData.value     // live values of the tutorials
      console.log('🔎✅ Performance Analysis updated')
    } catch (error) {
      console.error('🔎❌Error handling performance analysis:', error)
    }
  }

/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp1 = ref(false);  const showHelp2 = ref(false);  const showHelp3 = ref(false);
  const helpIcon1 = ref(null);   const helpIcon2 = ref(null);
  const showHelp4 = ref(false);  const helpIcon4 = ref(null);
  const helpPosition = ref({ top: '0%', left: '0%' });

  function openHelp1()  { nextTick(() => { showHelp1.value = true }) }
  function closeHelp1() { showHelp1.value  = false }
  function openHelp2()  { nextTick(() => { showHelp2.value = true }) }
  function closeHelp2() { showHelp2.value  = false }
  function openHelp3()  { nextTick(() => { showHelp3.value = true }) }
  function closeHelp3() { showHelp3.value  = false }
  function openHelp4()  { nextTick(() => { showHelp4.value = true }) }
  function closeHelp4() { showHelp4.value  = false }

  // Method to determine CSS class based on performance bound
  const getBoundClass = (bound) => {
    switch(bound) {
      case 'LATENCY':
        return 'latency-bound'
      case 'THROUGHPUT':
        return 'throughput-bound'
      default:
        return 'both'
    }
  }

</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" :title="t('Show Help')" >
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">{{ t('Static Performance Analysis') }}: <strong>{{simState.simulatedProcess.name}}</strong></span>
      </div>
    </div>

    <!-- Summary: one line -->
    <div class="bounds-summary">
      <span class="summary-item" id="latency-limit"
            :title="t('Latency bound: minimum cycles per loop iteration due to the longest cyclic chain of data dependencies')">
        {{ t('Latency') }} <strong>{{ performanceData.LatencyTime.toFixed(2) }}</strong>
      </span>
      <span class="summary-sep">·</span>
      <span class="summary-item" id="throughput-limit"
            :title="t('Throughput bound: minimum cycles per loop iteration due to the most saturated resource (dispatch, retire or execution ports)')">
        {{ t('Throughput') }} <strong>{{ performanceData.ThroughputTime.toFixed(2) }}</strong>
      </span>
      <span class="summary-sep">·</span>
      <span class="summary-item summary-min" id="best-limit" :title="minimumTimeFormula">
        {{ t('Minimum') }} <strong>{{ performanceData.BestTime.toFixed(2) }}</strong> cycles/iter
      </span>
      <span v-if="showAlgOps" class="summary-item summary-min" id="best-limit-alg-op"
            :title="`${algOpTitle(performanceData.BestTime)}\n${t(ALG_OP_HELP)}`">
        = <strong>{{ algOpValue(performanceData.BestTime) }}</strong> {{ ALG_OP_UNIT }}
      </span>
      <span class="metric-value bound-kind" id="performance-bound"
            :title="t('The minimum time is determined by the latency bound, the throughput bound, or both')"
            :class="getBoundClass(performanceData['performance-bound'])">
        {{ boundLabel }}
      </span>
    </div>

    <div v-if="performanceData.LatencyRange" class="branch-analysis" id="branch-analysis">
      <div :title="t('The latency bound depends on whether the conditional blocks are executed: the minimum is used as the bound')">
        {{ t('Conditional branches: latency bound between') }} <strong>{{ performanceData.LatencyRange.min.toFixed(2) }}</strong>
        {{ t('and') }} <strong>{{ performanceData.LatencyRange.max.toFixed(2) }}</strong>
        ({{ t('with the conditional blocks {a}, without them {b}', { a: performanceData.LatencyRange.with_blocks.toFixed(2), b: performanceData.LatencyRange.without_blocks.toFixed(2) }) }}).
      </div>
      <div v-if="performanceData.ThroughputRange" id="throughput-range"
           :title="t('The throughput bound counts each conditional instruction with its probability of being executed (expected instructions per iteration). The range gives the bound when every conditional block is executed and when none of them is')">
        {{ t('Throughput bound') }} <strong>{{ performanceData.ThroughputTime.toFixed(2) }}</strong>{{ t(', with the expected instructions; between {a} and {b}', { a: performanceData.ThroughputRange.min.toFixed(2), b: performanceData.ThroughputRange.max.toFixed(2) }) }}
        ({{ t('with the conditional blocks {a}, without them {b}', { a: performanceData.ThroughputRange.with_blocks.toFixed(2), b: performanceData.ThroughputRange.without_blocks.toFixed(2) }) }}).
      </div>
      <div id="mispredict-cost"
           :title="t('After a misprediction, the instructions that follow the branch are not useful from its dispatch until it resolves (estimated with the dependence chain that computes its condition in the iteration) and during the branch penalty. Cost per iteration = Σ mispredictions × (resolution + penalty). It is an approximation: part of the resolution time can overlap with useful work')">
        {{ t('Mispredictions') }}: <strong>{{ performanceData.MispredictionsPerIter.toFixed(3) }}</strong>/iter
        <span v-for="b in performanceData.Branches" :key="b.index" class="branch-info">
          ({{ t('branch {i}', { i: b.index }) }}: p={{ b.prob }}, {{ b.estimated ? t('2-bit predictor') : t('given rate') }} {{ b.mispredict.toFixed(3) }};
          {{ t('cost {r} resolution + {p} penalty = {c} cycles', { r: b.resolution ?? '?', p: performanceData.BranchPenalty, c: b.cost ?? performanceData.BranchPenalty }) }})
        </span>
        → {{ performanceData.MispredictTime.toFixed(2) }} cycles/iter
        → {{ t('estimate') }} ≈ <strong>{{ performanceData.EstimatedTime.toFixed(2) }}</strong> cycles/iter
      </div>
    </div>

    <div v-if="warning" class="stride-warning" id="stride-warning" role="note">⚠ {{ warning }}</div>

    <!-- Latency bounds -->
    <div class="section-title-and-info bounds-title">
      <span ref="helpIcon4" class="info-icon" @click="openHelp4" :title="t('Show Help')">
        <img src="/img/info.png" class="info-img">
      </span>
      <span class="header-title">{{ t('Latency bounds') }}</span>
      <button class="blue-button graph-open-button" :class="{ active: graphOpen }"
              id="open-dependence-graph"
              :title="t('Show/hide the data dependence graph in a movable window')"
              @click="graphOpen = !graphOpen">
        📈 {{ t('Dependence graph') }}
      </button>
    </div>

    <div class="bounds-container" id="latency-bounds">
      <table class="bounds-table">
        <thead>
          <tr>
            <th :title="t('Variable whose new value depends on its own previous value. Click a row to highlight its chain in the dependence graph.')">{{ t('Recurrence') }}</th>
            <th :title="t('Cyclic chain of dependent instructions (hover a number to see the instruction)')">{{ t('Cyclic dependence chain') }}</th>
            <th :title="t('Cycles per loop iteration determined by the chain (hover a value to see how it is computed)')">Cycles/iter</th>
            <th v-if="showAlgOps" :title="algOpHeaderTitle">Cycles/Alg Oper</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in latencyTable.rows" :key="row.key"
              class="chain-row" :data-chain="row.variable"
              :class="{ bottleneck: row.bottleneck, selected: row.key === selectedChainKey }"
              @click="selectChain(row)">
            <td class="bound-resource" :title="row.recurrenceTitle">{{ row.recurrence }}</td>
            <td>
              <template v-for="(instr, k) in row.chain" :key="k">
                <span v-if="k > 0" class="bound-arrow">→</span>
                <span class="bound-instr" :title="instr.title"
                      @mouseenter="hoverInstruction(instr.index)" @mouseleave="hoverInstruction(-1)">{{ instr.index }}</span>
              </template>
            </td>
            <td class="bound-cycles"><span v-if="row.bottleneck" class="bound-badge" :title="t('This row determines the bound (maximum value)')">max</span><span :title="row.formula">{{ row.cycles }}</span></td>
            <td v-if="showAlgOps" class="bound-cycles bound-algop"><span :title="algOpTitle(row.cyclesValue)">{{ algOpValue(row.cyclesValue) }}</span></td>
          </tr>
          <tr v-if="latencyTable.rows.length === 0">
            <td :colspan="showAlgOps ? 4 : 3" class="bound-empty">{{ t('No cyclic dependences') }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="latencyTable.hidden" class="bounds-note">
        {{ t('Showing the {n} highest bounds ({h} lower bounds hidden).', { n: latencyTable.rows.length, h: latencyTable.hidden }) }}
      </div>
    </div>

    <!-- Throughput bounds -->
    <div class="section-title-and-info bounds-title">
      <span ref="helpIcon2" class="info-icon" @click="openHelp2" :title="t('Show Help')">
        <img src="/img/info.png" class="info-img">
      </span>
      <span class="header-title">{{ t('Throughput bounds') }}</span>
    </div>

    <div class="bounds-container" id="throughput-bounds">
      <table class="bounds-table">
        <thead>
          <tr>
            <th :title="t('Dispatch or retire width, an execution port, or a combination of ports that share instructions')">{{ t('Resource') }}</th>
            <th :title="t('Instructions that can only use this resource (hover a number to see the instruction). In grey, instructions that can also use other ports.')">{{ t('Instructions (exclusive)') }}</th>
            <th :title="t('Cycles per loop iteration determined by this resource (hover a value to see how it is computed)')">Cycles/iter</th>
            <th v-if="showAlgOps" :title="algOpHeaderTitle">Cycles/Alg Oper</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in throughputTable.rows" :key="index" :class="{ bottleneck: row.bottleneck }"
              :data-resource="row.resource">
            <td class="bound-resource" @mouseenter="showTip($event, row.resourceTip)" @mouseleave="hideTip">{{ row.resource }}</td>
            <td>
              <span v-if="row.allRange">{{ row.allRange }}</span>
              <span v-if="row.conditional?.length" class="bound-conditional"
                    :title="t('Conditional instructions: each one counts with its probability of being executed')">
                · {{ t('conditional:') }}
                <template v-for="(instr, k) in row.conditional" :key="'c' + k"><span v-if="k > 0">, </span><span class="bound-instr"
                      @mouseenter="enterInstr($event, instr)" @mouseleave="leaveInstr">{{ instr.index }}</span> <em>(p={{ instr.prob }})</em></template>
              </span>
              <template v-else>
                <span v-if="row.included.length === 0 && !row.allRange" class="bound-none">{{ t('none') }}</span>
                <template v-for="(instr, k) in row.included" :key="'i' + k">
                  <span v-if="k > 0">, </span>
                  <span class="bound-instr"
                        @mouseenter="enterInstr($event, instr)" @mouseleave="leaveInstr">{{ instr.index }}</span><em
                        v-if="instr.prob" class="bound-conditional"> (p={{ instr.prob }})</em>
                </template>
                <span v-if="row.excluded.length" class="bound-excluded">
                  (<template v-for="(instr, k) in row.excluded" :key="'e' + k"><span v-if="k > 0">, </span><span class="bound-instr"
                        @mouseenter="enterInstr($event, instr)" @mouseleave="leaveInstr">{{ instr.index }}</span></template>)
                </span>
              </template>
            </td>
            <td class="bound-cycles"><span v-if="row.bottleneck" class="bound-badge" :title="t('This row determines the bound (maximum value)')">max</span><span :title="row.formula">{{ row.cycles }}</span></td>
            <td v-if="showAlgOps" class="bound-cycles bound-algop"><span :title="algOpTitle(row.cyclesValue)">{{ algOpValue(row.cyclesValue) }}</span></td>
          </tr>
          <tr v-if="throughputTable.rows.length === 0">
            <td :colspan="showAlgOps ? 4 : 3" class="bound-empty">{{ t('No data') }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="throughputTable.hidden" class="bounds-note">
        {{ t('Showing the {n} highest bounds ({h} lower bounds hidden).', { n: throughputTable.rows.length, h: throughputTable.hidden }) }}
      </div>
    </div>

  </div>

  <Teleport to="body">
    <DependenceGraphWindow v-if="graphOpen"
      :svg="dependenceGraphSvg"
      :options="dependenceGraphOptions"
      :chain="selectedChain"
      :hover-instr="simState.instrHighlightedIdx"
      @close="graphOpen = false"
      @clear-chain="selectedChainKey = null"
      @set-option="(key, value) => { dependenceGraphOptions[key] = value }"
      @help="openHelp3" />
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition"
    :text="t('help.analysis')"
    :title="t('Static Performance Analysis')"
    @close="closeHelp1"/>
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp2" :position="helpPosition"
    :text="t('help.throughputBounds')"
    :title="t('Throughput bounds')"
    @close="closeHelp2"/>
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp4" :position="helpPosition"
    :text="t('help.latencyBounds')"
    :title="t('Latency bounds')"
    @close="closeHelp4"/>
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp3" :position="helpPosition"
    :text="t('help.dependenceGraph')"
    :title="t('Dependence graph')"
    @close="closeHelp3"/>
    </Teleport>

  <!-- tooltip of the throughput table (with bold words) -->
  <Teleport to="body">
    <div v-if="tip" class="bound-tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }" v-html="tip.html"></div>
  </Teleport>
</template>

<style scoped>
  /* One-line summary of the bounds */
  .bounds-summary {
    display:     flex;
    flex-wrap:   wrap;
    align-items: baseline;
    gap:         0.3em 0.5em;
    box-sizing:  border-box;
    max-width:   44rem;
    margin:      0.2rem 0 0.3rem;
    padding:     0.25rem 0.5rem;
    background:  #f8f9fa;
    border:      1px solid #dee2e6;
    border-radius: 4px;
  }
  .summary-item { cursor: help; white-space: nowrap; }
  .summary-min strong { color: #1a73e8; }
  .summary-sep { color: #aaa; }

  .graph-open-button { margin-left: 1em; }

  .chain-row { cursor: pointer; }
  .chain-row:hover td { background: #eef3fd; }
  /* Selected chain: blue frame, keeping the yellow background of a bottleneck row */
  .bounds-table tr.chain-row.selected td {
    box-shadow:  inset 0 2px 0 #1a4fb3, inset 0 -2px 0 #1a4fb3;
  }
  .bounds-table tr.chain-row.selected td:first-child {
    box-shadow:  inset 0 2px 0 #1a4fb3, inset 0 -2px 0 #1a4fb3, inset 3px 0 0 #1a4fb3;
  }
  .bounds-table tr.chain-row.selected td:last-child {
    box-shadow:  inset 0 2px 0 #1a4fb3, inset 0 -2px 0 #1a4fb3, inset -3px 0 0 #1a4fb3;
  }

  .metric-value {
    font-size: 1em;
    font-weight: 600;
  }

  .metric-value.latency-bound {
    color:         #d93025;
    background:    #fce8e6;
    padding:       0 4px;
    border-radius: 3px;
  }

  .metric-value.throughput-bound {
    color:         #188038;
    background:    #e6f4ea;
    padding:       0 4px;
    border-radius: 3px;
  }

  .metric-value.both {
    color:         #488038;
    background:    #eff4ea;
    padding:       0 4px;
    border-radius: 3px;
  }

  .bounds-title {
    margin: 0.4rem 0 0.2rem;
  }

  .bounds-container {
    overflow-x: auto;
    margin-bottom: 0.5rem;
  }

  .bounds-table {
    /* Compact: keeps each value close to its resource on wide screens */
    width: 100%;
    max-width: 44rem;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .bounds-table th {
    background: #f0f5ff;
    font-weight: 600;
    text-align: left;
    padding: 4px 8px;
    border-bottom: 2px solid #c9d7f2;
    cursor: help;
  }

  .bounds-table td {
    padding: 4px 8px;
    border-bottom: 1px solid #eceff1;
    vertical-align: top;
  }

  .bound-resource {
    font-weight: 600;
    white-space: nowrap;
    cursor: help;
  }

  .bounds-table tr.bottleneck td {
    background: #fff3c4;
    font-weight: 600;
  }

  .bound-instr {
    cursor: help;
    border-bottom: 1px dotted #999;
  }

  .bound-arrow {
    margin: 0 0.3em;
    color: #888;
  }

  .bound-algop {
    color: #1a4fb3;
  }
  .branch-analysis {
    margin:        4px 0;
    padding:       4px 8px;
    font-size:     small;
    border:        1px solid #c9a227;
    border-radius: 5px;
    background:    #fffbe6;
    max-width:     60rem;
  }
  .branch-info { color: #555; }
  .bound-conditional { color: #7a5a00; font-size: 0.9em; }
  .stride-warning {
    box-sizing:    border-box;
    max-width:     44rem;   /* as wide as the summary */
    margin:        0 0 0.3rem;
    padding:       4px 8px;
    font-size:     0.85rem;
    background:    #fff7e0;
    border:        1px solid #e0b84a;
    border-radius: 6px;
  }
  .bound-excluded {
    margin-left: 0.4em;
    color: #6b7280;
    font-weight: normal;
  }

  .bound-tip {
    position: fixed; z-index: 3000; max-width: 330px; pointer-events: none;
    background: #fffde7; color: #222; border: 1px solid #c9b458; border-radius: 4px;
    padding: 4px 8px; font-size: 13px; line-height: 1.4; box-shadow: 0 2px 6px rgba(0,0,0,.2);
  }
  .bound-none {
    color: #6b7280;
  }

  .bound-cycles {
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
    cursor: help;
  }

  /* Second cue (besides the yellow background) for the rows that give the bound */
  .bound-badge {
    margin-right:  0.5em;
    padding:       0 5px;
    font-size:     0.75em;
    font-weight:   700;
    color:         #fff;
    background:    #8a5a00;
    border-radius: 3px;
    vertical-align: 1px;
  }

  .bound-empty {
    color: #888;
    text-align: center;
  }

  .bounds-note {
    font-size: 0.8em;
    color: #666;
    margin-top: 2px;
  }

  .bound-kind {
    margin-top: 2px;
    font-size: 0.85em;
  }

  .annotations-box {
    margin-top: 0.5rem;
  }

</style>
