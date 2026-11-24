<script setup>
  import { t } from '@/i18n'
  import { ref, toRaw, computed, onMounted, onUnmounted, onBeforeUnmount,
           nextTick, inject, watch, reactive }                       from "vue"
  import HelpComponent                    from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'
  import { downloadJSON, uploadJSON,
           saveToLocalStorage, removeFromLocalStorage, initResource,
           getLogicalElementCount, getUnsupportedInstructions,
           validateProgram, repetitionFields } from '@/common'
  import { resultsToCsv, hasAlgOps }      from '@/resultsCsv'
  import { authorMode }                   from '@/authorMode'
  import { buildResultContext, defaultResultName,
           resultMemoryColumns, resultContextLines, resultRepetitions } from '@/resultContext'
  import { resultStride, resultCyclesPerAlgOp, resultInstrPerAlgOp, speedupOver,
           ALG_OP_HELP, ALG_OP_UNIT, algOpFormula } from '@/algOps'

  const { getExecutionResults } = useRVCAT_Api();
  const { registerHandler, registerProgressHandler, restartWorker } = inject('worker');

  // ---- Progress of a simulation: an estimate before it starts (from the speed of the previous
  // simulations), the percentage done and the time left while it runs, and the option to abort ----
  const SPEED_KEY = 'simulationSpeed'          // milliseconds per simulated instruction
  const simProgress = ref(null)                 // { fraction, start, estimate (ms) }
  const progressNow = ref(0)
  let progressTimer = null
  let cleanupProgress = null
  function expectedInstructions(process) {
    const n = process?.instruction_list?.length ?? 0, rep = Math.max(1, Number(process?.rep) || 1)
    return (Number(process?.iters) || 0) * n * rep + rep * (process?.epilogue?.length ?? 0)
  }
  function startProgress(process) {
    let msPerInstr = null
    try { msPerInstr = Number(localStorage.getItem(SPEED_KEY)) || null } catch { msPerInstr = null }
    const instructions = expectedInstructions(process)
    simProgress.value = { fraction: 0, start: performance.now(), instructions,
                          estimate: msPerInstr ? msPerInstr * instructions : null }
    progressNow.value = performance.now()
    clearInterval(progressTimer)
    progressTimer = setInterval(() => { progressNow.value = performance.now() }, 250)
  }
  function endProgress(results) {
    const p = simProgress.value
    if (p && results?.total_instructions > 0) {
      const elapsed = performance.now() - p.start
      // the speed of this simulation, for the next estimate (only long enough simulations)
      if (elapsed > 300) try { localStorage.setItem(SPEED_KEY, String(elapsed / results.total_instructions)) } catch { /* ignore */ }
    }
    clearInterval(progressTimer)
    simProgress.value = null
  }
  // percentage done, and seconds left (from the progress so far, or from the estimate)
  const progressText = computed(() => {
    const p = simProgress.value
    if (!p) return ''
    const elapsed = (progressNow.value - p.start) / 1000
    if (p.fraction > 0.02) {
      const left = elapsed * (1 - p.fraction) / p.fraction
      return t('{p}% done · about {s} s left', { p: Math.round(100 * p.fraction), s: Math.max(0, Math.round(left)) })
    }
    if (p.estimate) return t('Estimated time: about {s} s', { s: Math.max(1, Math.round(p.estimate / 1000)) })
    return t('Simulating {n} instructions…', { n: p.instructions.toLocaleString('en-US') })
  })
  async function abortSimulation() {
    endProgress(null)
    showRunning(false)
    executionError.value = t('Simulation aborted. The simulator is being restarted…')
    await restartWorker()
    executionError.value = t('Simulation aborted.')
  }
  const simState                = inject('simulationState');

 /* ------------------------------------------------------------------
   * Simulation Results options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'simulationOptions'

  const defaultOptions = {
    autorun:          false,
    availableResults: [],
    resultName:       '',
    referenceResult:  '',   // stored result used as baseline for the speedup column
    allColumns:       false // every column of the stored results (otherwise, the main ones)
  }

  const simulationOptions = reactive(defaultOptions)

  const executionError        = ref('')
  let   cleanupHandleResults  = null
  let   resultsTimeout        = null
  const showResultsInfo       = ref({})

  // Memory columns of the stored-results table, by row index
  // Cycles per algorithmic operation (one iteration of the original loop) of each stored result:
  // comparable between a baseline loop and its unrolled or vectorized versions
  const storedAlgOps = computed(() =>
    simulationOptions.availableResults.map((_, index) => {
      const result = showResultsInfo.value[index]
      const value  = resultCyclesPerAlgOp(result)
      const stride = resultStride(result)
      return value === null
        ? { value: 'X', title: t('Unknown: these results were saved without the simulated program') }
        : { value: value.toFixed(2),
            title: t('{cycles} cycles / ({iters} iterations × {s} alg opers/iter) = {v} {unit}',
                     { cycles: result.total_cycles.toLocaleString('en-US'), iters: result.total_iterations.toLocaleString('en-US'),
                       s: stride, v: value.toFixed(2), unit: ALG_OP_UNIT }) }
    })
  )
  const algOpHeaderTitle = computed(() => `${t('Cycles per algorithmic operation.')} ${t(ALG_OP_HELP)}`)
  const instrAlgOpHeaderTitle = computed(() =>
    t('Machine instructions executed per algorithmic operation. Unrolling and SIMD reduce it. Cycles/Alg Oper = (Instr/Alg Oper) / IPC.'))
  const speedupHeaderTitle = computed(() =>
    t('Speedup over the reference result (★) = its cycles/alg oper ÷ cycles/alg oper of this row. Click ☆ in a row to make it the reference. Only meaningful between versions of the same algorithm.'))

  const storedInstrAlgOps = computed(() =>
    simulationOptions.availableResults.map((_, index) => {
      const result = showResultsInfo.value[index]
      const value  = resultInstrPerAlgOp(result)
      return value === null
        ? { value: 'X', title: t('Unknown: these results were saved without the simulated program') }
        : { value: value.toFixed(2),
            title: t('{instr} instructions / {ops} alg opers = {v} instr/alg oper',
                     { instr: result.total_instructions.toLocaleString('en-US'),
                       ops: (result.total_iterations * resultStride(result)).toLocaleString('en-US'), v: value.toFixed(2) }) + '\n' +
                   `${value.toFixed(2)} instr/alg oper ÷ IPC ${result.ipc?.toFixed(3)} = ` +
                   `${resultCyclesPerAlgOp(result).toFixed(2)} ${ALG_OP_UNIT}` }
    })
  )

  const storedSpeedups = computed(() => {
    const refIndex = simulationOptions.availableResults.indexOf(simulationOptions.referenceResult)
    const reference = refIndex >= 0 ? showResultsInfo.value[refIndex] : null
    return simulationOptions.availableResults.map((name, index) => {
      if (index === refIndex) return { isRef: true, value: '1.00', title: t('Reference result (speedup 1)') }
      if (!reference) return { isRef: false, value: '', title: t('Click ☆ to use this result as the reference') }
      const value = speedupOver(reference, showResultsInfo.value[index])
      return value === null
        ? { isRef: false, value: 'X', title: t('Unknown: these results were saved without the simulated program') }
        : { isRef: false, value: value.toFixed(2),
            title: `${resultCyclesPerAlgOp(reference).toFixed(2)} (${simulationOptions.referenceResult}) ÷ ` +
                   `${resultCyclesPerAlgOp(showResultsInfo.value[index]).toFixed(2)} ${ALG_OP_UNIT} = ` +
                   t('{v}× faster', { v: value.toFixed(2) }) }
    })
  })

  function setReferenceResult(name) {
    simulationOptions.referenceResult = simulationOptions.referenceResult === name ? '' : name
    saveOptions()
  }

  const storedMemoryColumns = computed(() =>
    simulationOptions.availableResults.map((_, index) => resultMemoryColumns(showResultsInfo.value[index]))
  )

  // Hover box with the program/processor of a stored result
  const contextHover = ref(null)   // { lines, style }
  function showResultContext(event, index) {
    const rect     = event.currentTarget.getBoundingClientRect()
    const below    = rect.bottom + 220 < window.innerHeight   // otherwise open above the row
    const maxWidth = Math.min(672, window.innerWidth - 16)
    const left     = Math.max(8, Math.min(rect.left, window.innerWidth - maxWidth - 8))
    contextHover.value = {
      lines: resultContextLines(showResultsInfo.value[index]?.context),
      style: {
        left:     `${left}px`,
        maxWidth: `${maxWidth}px`,
        ...(below ? { top:    `${rect.bottom + 4}px` }
                  : { bottom: `${window.innerHeight - rect.top + 4}px` })
      }
    }
  }
  function hideResultContext() { contextHover.value = null }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(simulationOptions))
    } catch (error) {
      console.error('🕐❌ Failed to save:', error)
    }
  }

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(simulationOptions, JSON.parse(saved))
        console.log('🕐load options')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('🕐default load options')
      }
    } catch (error) {
      console.error('🕐❌ Failed to load:', error)
    }
  }

  const displayText = computed(() => {
    return t('Simulation: {program} on {processor}', { program: simState.simulatedProcess.name, processor: simState.processorName })
  })

/* ------------------------------------------------------------------
  * Simulation Results (persistent in localStorage)
  * ------------------------------------------------------------------ */
  let simResults = {}
  let simProcess = {}
  let pendingContext = null   // context of the simulation sent to RVCAT, attached to its results
  const isArray  = (arr) => Array.isArray(arr);

  // Options of the simulation, stored with the simulated copy so that changing them invalidates results
  const settings = simState.simulationSettings


  // Options fixed by a lesson (locks.simulation: { sched, speculation })
  const fixedOption = (key) => (simState.lessonAllow ?? []).includes(`simulation.${key}`)
    ? null : simState.lesson?.locks?.simulation?.[key] ?? null
  watch(() => [fixedOption('sched'), fixedOption('speculation'), settings.sched, settings.speculation], () => {
    for (const key of ['sched', 'speculation']) {
      const fixed = fixedOption(key)
      if (fixed && settings[key] !== fixed) settings[key] = fixed
    }
  }, { immediate: true })
  const withSettings = (process) => ({ ...process, sched: settings.sched, speculation: settings.speculation })

  const areInstructionsEqual = (instr1, instr2) => {
    if (instr1.type    !== instr2.type)    return false;
    if (instr1.latency !== instr2.latency)  return false;
    if (instr1.ports   !== instr2.ports)    return false;
    if (instr1.size    !== instr2.size)     return false;
    if (instr1.destin  !== instr2.destin)   return false;
    if (instr1.source1 !== instr2.source1)  return false;
    if (instr1.source2 !== instr2.source2)  return false;
    if (instr1.source3 !== instr2.source3)  return false;
    if (instr1.constant !== instr2.constant) return false;
    if (instr1.stride  !== instr2.stride)   return false;
    if (instr1.lanes   !== instr2.lanes)    return false;
    if ((instr1.prob ?? '') !== (instr2.prob ?? ''))             return false;
    if ((instr1.mask ?? '') !== (instr2.mask ?? ''))             return false;
    if ((instr1.mispredict ?? '') !== (instr2.mispredict ?? '')) return false;
    return true; // ✅ all are equal
  }

  const areProcessorsEqual = (proc1, proc2) => {
    if (proc1 == {} || proc2 == {})        return false
    // (Nloop = iters × loop stride is not compared: only the simulated copy has it, and
    //  iters and the BRANCH stride are compared)
    if (proc1.iters !== proc2.iters)       return false;
    if (proc1.dispatch !== proc2.dispatch) return false;
    if (proc1.retire !== proc2.retire)     return false;
    if (proc1.sched !== proc2.sched)       return false;
    if (proc1.speculation !== proc2.speculation) return false;
    if ((proc1.bPenalty ?? 5) !== (proc2.bPenalty ?? 5)) return false;
    if (proc1.ROBsize !== proc2.ROBsize)   return false;
    if (proc1.nBlocks !== proc2.nBlocks)   return false;
    if (proc1.nBlocks > 0) {
      if (proc1.blkSize    !== proc2.blkSize)    return false;
      if (proc1.mIssueTime !== proc2.mIssueTime) return false;
      if (proc1.mPenalty   !== proc2.mPenalty)   return false;
      if (proc1.nFillBuffers !== proc2.nFillBuffers) return false;
      if (proc1.nWriteBuffers !== proc2.nWriteBuffers) return false;
      if ((proc1.nStoreBuffers ?? 16) !== (proc2.nStoreBuffers ?? 16)) return false;
      if (proc1.rThru !== proc2.rThru) return false;
    }

    if (isArray(proc1.instruction_list) && isArray(proc2.instruction_list)) {
      if (proc1.instruction_list.length !== proc2.instruction_list.length) return false;
      for (let i = 0; i < proc1.instruction_list.length; i++) {
        if (!areInstructionsEqual(proc1.instruction_list[i], proc2.instruction_list[i])) return false;
      }
      return true;
    }
    return false;
  };

  const saveResults = () => {
    try {
      localStorage.setItem('simResults', JSON.stringify(simResults))
      localStorage.setItem('simProcess', JSON.stringify(simProcess))
    } catch (error) {
      console.error('🕐❌ Failed to save:', error)
    }
  }

  const loadResults = () => {
    let stored = localStorage.getItem('simResults');
    if (stored) {
      try {
        Object.assign(simResults, structuredClone(JSON.parse(stored)))
      } catch (e) {
        console.error('🕐❌ Failed to load simulation results from localStorage:', e);
      }
    }
    stored = localStorage.getItem('simProcess');
    if (stored) {
      try {
        Object.assign(simProcess, structuredClone(JSON.parse(stored)))
      } catch (e) {
        console.error('🕐❌ Failed to load simulated processor from localStorage:', e);
      }
    }
  }

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================

  let unwatch            = null;
  let isComponentMounted = false;

  const updateResults= () => {
    if (simState.state >= 3 && simState.simulatedProcess) {
      const equalProcs = areProcessorsEqual(withSettings(simState.simulatedProcess), simProcess)
      if (equalProcs) {
        if (simState.executionResults == null) simState.executionResults = simResults
        console.log('🕐✅ Same simulated proces: execution results are valid');
      } else if (simulationOptions?.autorun) {
        console.log('🕐🔄 Something changed: re-running simulation', equalProcs)
        reloadExecutionResults()
      } else {
        simState.executionResults = null; // Clear results to avoid showing outdated data
        console.log('🕐🧹 Process changed but autorun is disabled: clear simulation results')
      }
    }
  }

  const updateShowResults= () => {
    showResultsInfo.value = {}  // clear previous results info from simulation state
    for (const [index, name] of simulationOptions.availableResults.entries()) {
      const stored = localStorage.getItem(`results.${name}`);
      if (stored) {
        try {
          showResultsInfo.value[index] = JSON.parse(stored);
        } catch (e) {
          console.error(`🕐❌ Failed to load previous results for ${name}:`, e);
        }
      }
    }
    // the programs of the stored results, seen by the tutorials (validation "results_stored")
    simState.storedResultPrograms = Object.values(showResultsInfo.value)
      .map(r => r?.context?.program?.name).filter(Boolean)
  }

  const handleOptionsChange = () => {
    // Verify that component is mounted and necessary data is available before executing the watch logic
    if (!isComponentMounted || !simulationOptions || !simState) {
      console.log('🕐 Component not ready, skipping watch execution')
      return
    }
    try {
      updateResults()
      updateShowResults()
      saveOptions()
    } catch (error) {
      console.error('🕐❌ Error in options watch handler:', error);
    }
  };

  const initSimulation = async () => {
    await initResource('result', simulationOptions, 'resultName', 'availableResults');
    updateResults()
  };

  function removeResult (index) {
    const name = simulationOptions.availableResults[index]
    if (name === undefined) return
    if (!confirm(t('Remove the stored result "{name}"?', { name }))) return
    if (simulationOptions.referenceResult === name) simulationOptions.referenceResult = ''
    removeFromLocalStorage('result', name, simulationOptions.availableResults)
    simulationOptions.resultName = simulationOptions.availableResults[0] ?? ''
    updateShowResults()
    saveOptions()
  }

  // The spinner and the "running" message while RVCAT simulates (the elements may not exist: the
  // panel can be closed before a delayed update)
  function showRunning(on) {
    const set = (id, display) => { const el = document.getElementById(id); if (el) el.style.display = display }
    set('run-simulation-spinner', on ? 'block' : 'none')
    set('simulation-running', on ? 'block' : 'none')
    const button = document.getElementById('run-simulation-button')
    if (button) button.disabled = on
  }

  onMounted(() => {
    cleanupHandleResults  = registerHandler('get_execution_results', handleResults)
    cleanupProgress = registerProgressHandler('get_execution_results', (fraction) => {
      if (simProgress.value) simProgress.value.fraction = fraction
    })
    document.getElementById('simulation-running').style.display = 'none'
    loadOptions()
    loadResults()
    initSimulation()
    nextTick(() => {
      isComponentMounted = true;
      unwatch = watch(
        () => ({
          autorun:  simulationOptions?.autorun,
          name:     simulationOptions?.resultName
        }),
        handleOptionsChange,
        {
          immediate: true,
          deep: false
        }
      )
      console.log('🕐🎯 SimulationComponent mounted')
    })
  })

  onBeforeUnmount(() => {
    isComponentMounted = false;
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  })

  onUnmounted(() => {
     if (cleanupHandleResults) {
        cleanupHandleResults();
        cleanupHandleResults = null
     }
    cleanupProgress?.()
    clearInterval(progressTimer)
    console.log('🕐👋 SimulationComponent unMounted')
  })

// ============================================================================
// WATCHES: simulatedProcess, rvcat results
// ============================================================================

  watch( () => simState.simulatedProcess, () => { updateResults() },
    { deep: true, immediate: false }
  )

  // Options of the simulation: saved in the browser; changing them invalidates the results
  watch( () => ({ ...simState.simulationSettings }), (value) => {
      try { localStorage.setItem('simulationSettings', JSON.stringify(value)) } catch { /* not saved */ }
      updateResults()
    }
  )

  // Handler for 'get_execution_results' message (fired by RVCAT getPerformanceAnalysis function)
  const handleResults = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('🕐❌Failed to get execution results:', data);
      endProgress(null)
      showRunning(false)
      const reason = String(data).split('\n').filter(Boolean).pop() ?? ''
      executionError.value = t('The simulation failed: {reason}', { reason: reason.replace(/^\w*Error: /, '') })
      return;
    }
    try {
      console.log('🕐✅ Execution Results received')
      // Results + snapshot of the simulated program/processor (shown when stored results are hovered)
      simResults = { ...JSON.parse(data), context: pendingContext }
      endProgress(simResults)
      saveResults()
      if (resultsTimeout) clearTimeout(resultsTimeout)
      resultsTimeout = setTimeout(() => {
        showRunning(false)   // (the panel may have been closed meanwhile)
      }, 500)
      simState.executionResults = simResults
    } catch (error) {
      console.error('🕐❌Failed to obtain execution results:', error)
    }
  }

 /* ------------------------------------------------------------------
  * Simulation options: UI actions
  * ------------------------------------------------------------------ */
  function toggleAutorun()  { simulationOptions.autorun = !simulationOptions.autorun }

  // calls of the loop (repetitions) of the current result
  const repetitions = computed(() => resultRepetitions(simState.executionResults))

  const formattedResults = computed(() => {
    const results = simState.executionResults || {};
    if (results.total_iterations === undefined || results.total_iterations === null) {
      return {
        iters:    'X',    instructions: 'X',    cycles:   'X',    cpi:      'X',
        ipc:      'X',    primary:      'X',    secondary: 'X',   MM:       'X'
      };
    }

    const nIters      = results["total_iterations"]
    const totalCycles = results["total_cycles"]
    const totalInstrs = results["total_instructions"]
    const cpi         = totalCycles / nIters;
    const ipc         = totalInstrs / totalCycles
    const MM_reads    = results["MM_Reads"]
    const MM_writes   = results["MM_Writes"]

    // total a+b (the detail goes to the tooltip), or 'X' when a value is missing
    const formatSum = (a, b) => (Number.isFinite(a) && Number.isFinite(b)) ? (a + b).toLocaleString('en-US') : 'X'
    const formatDetail = (a, b, first, second) => (Number.isFinite(a) && Number.isFinite(b))
      ? `${first} ${a.toLocaleString('en-US')} + ${second} ${b.toLocaleString('en-US')} = ${(a + b).toLocaleString('en-US')}` : ''

    const mmUsagePercent = Number.isFinite(results.MM_usage_percent)
      ? results.MM_usage_percent
      : totalCycles > 0
        ? 100 * (MM_reads + MM_writes) * simState.simulatedProcess.mIssueTime / totalCycles
        : 0
    const mmTransfers = formatSum(MM_reads, MM_writes)

    // Unrolled or vectorized loop (loop stride > 1): also cycles per algorithmic operation
    const stride = resultStride(results) ?? 1
    const algOp  = resultCyclesPerAlgOp(results)
    const instrAlgOp = resultInstrPerAlgOp(results)

    return {
      stride,
      instrAlgOp:      instrAlgOp === null ? 'X' : instrAlgOp.toFixed(2),
      instrAlgOpTitle: instrAlgOp === null ? '' :
        t('{instr} instructions / {ops} alg opers = {v} instr/alg oper', { instr: totalInstrs.toLocaleString('en-US'),
          ops: (nIters * stride).toLocaleString('en-US'), v: instrAlgOp.toFixed(2) }) +
        ` (${t('{n} per iteration', { n: (totalInstrs / nIters).toFixed(2) })} ÷ ${stride})`,
      algOp:        algOp === null ? 'X' : algOp.toFixed(2),
      algOpTitle:   algOp === null ? '' :
        `${algOpFormula(cpi, stride)}\n${t(ALG_OP_HELP)}`,
      iters:        nIters.toLocaleString('en-US'),
      instructions: totalInstrs.toLocaleString('en-US'),
      cycles:       totalCycles.toLocaleString('en-US'),
      cpi:          cpi.toFixed(2),
      ipc:          ipc.toFixed(3),
      primary:      formatSum(results.read_primary_misses,   results.write_primary_misses),
      secondary:    formatSum(results.read_secondary_misses, results.write_secondary_misses),
      MM:           mmTransfers === 'X' ? 'X' : `${mmTransfers} (${mmUsagePercent.toFixed(1)}%)`,
      primaryTitle:   formatDetail(results.read_primary_misses, results.write_primary_misses, 'LD', 'ST'),
      secondaryTitle: formatDetail(results.read_secondary_misses, results.write_secondary_misses, 'LD', 'ST'),
      MMTitle:        formatDetail(MM_reads, MM_writes, 'Rd', 'Wr') +
                      (mmTransfers === 'X' ? '' : ' · ' + t('Main Memory busy {p}% of the cycles', { p: mmUsagePercent.toFixed(1) })),
    };
  });

  const ipcColor = computed(() => {
    const ipc = simState.executionResults?.["ipc"] ?? 0
    const dw  = simState.simulatedProcess?.dispatch || 1

    if (!ipc || !dw || dw === 0) return '#666';

    const ratio = ipc / dw;

    // close to maximum (>= 80% of dispatch width) -> Green
    if (ratio >= 0.8) return '#1b7f3a';

    // Very low (<= 10% of dispatch width) -> Red
    if (ratio <= 0.1) return '#c62828';

    // Intermediate: gradient from red to green
    const t     = (ratio - 0.1) / 0.7; // Normalize 0.1-0.8 to 0-1
    const red   = Math.floor(190 * (1 - t));
    const green = Math.floor(127 * t);

    return `rgb(${red}, ${green}, 0)`;
  });

  const ipcTooltip = computed(() => {
    const ipc = simState.executionResults?.["ipc"] ?? 0;
    const dw  = simState.simulatedProcess?.dispatch || 1;
    const efficiency = ((ipc / dw) * 100).toFixed(1);
    return `IPC: ${ipc.toFixed(3)} | Dispatch Width: ${dw}\nEfficiency: ${efficiency}% of maximum possible IPC`;
  });

  // there are results of the current program and processor
  const hasResults = computed(() => Number.isFinite(simState.executionResults?.total_iterations))
  const hasCache   = computed(() => (simState.simulatedProcess?.nBlocks ?? 0) > 0)

  // Columns of the stored results: the main ones, and those that matter for these results
  const columns = computed(() => {
    const results = simulationOptions.availableResults.map((_, i) => showResultsInfo.value[i]).filter(Boolean)
    const all = !!simulationOptions.allColumns
    return {
      all,
      algOps: all || hasAlgOps(results),
      branch: all || results.some(r => r.branch),
      cache:  all || results.some(r => (r.context?.processor?.nBlocks ?? 0) > 0),
    }
  })

  const reloadExecutionResults = async () => {
    if (simState.simulationBlocked) return        // a tutorial card waits for something first
    executionError.value = ''
    const process = simState.simulatedProcess
    const instructionList = Array.isArray(process?.instruction_list)
      ? process.instruction_list
      : []
    const Nloop = getLogicalElementCount(instructionList, process?.iters)
    const validationErrors = validateProgram(simState.simulatedProcess, {
      logicalElementCount: Nloop
    })
    if (validationErrors.length) {
      executionError.value = t('Cannot simulate invalid program: {errors}', { errors: validationErrors.join(' ') })
      console.error('🕐❌ Cannot simulate invalid program:', validationErrors)
      simState.executionResults = null
      return
    }

    const unsupportedInstructions = getUnsupportedInstructions(process)
    if (unsupportedInstructions.length) {
      const instructionList = unsupportedInstructions
        .map(({ index, instruction }) => `#${index + 1} (${instruction.type}.${instruction.oper})`)
        .join(', ')
      executionError.value =
        t('Cannot simulate: the active processor has no execution port for {list}.', { list: instructionList })
      console.error('🕐❌ Cannot simulate unsupported instructions:', unsupportedInstructions)
      simState.executionResults = null
      return
    }

    simProcess = {
      iters:    process.iters,
      Nloop,
      dispatch: process.dispatch,
      retire:   process.retire,
      sched:    settings.sched,
      speculation: settings.speculation,
      bPenalty: process.bPenalty ?? 5,
      ROBsize:  process.ROBsize,
      nBlocks:  process.nBlocks,
      blkSize:  process.blkSize,
      mIssueTime: process.mIssueTime,
      mPenalty: process.mPenalty,
      nFillBuffers: process.nFillBuffers ?? 2,
      nWriteBuffers: process.nWriteBuffers ?? 2,
      nStoreBuffers: process.nStoreBuffers ?? 16,
      rThru: process.rThru ?? 1,
      instruction_list: JSON.parse(JSON.stringify(instructionList))
    }
    clearTimeout(resultsTimeout)
    try {
      resultsTimeout = setTimeout(() => {
        showRunning(true)

        const { iters, ROBsize, dispatch, retire, blkSize, nBlocks, mPenalty, mIssueTime,
                nFillBuffers, nWriteBuffers, rThru } = process
        const { sched, speculation } = settings
        pendingContext = buildResultContext(toRaw(process), simState.processorName, settings)
        startProgress(process)
        getExecutionResults(JSON.stringify( { Nloop, ROBsize, dispatch, retire, sched, speculation,
                                              bPenalty: process.bPenalty ?? 5, blkSize, nBlocks, mPenalty, mIssueTime,
                                              nFillBuffers: nFillBuffers ?? 2,
                                              nWriteBuffers: nWriteBuffers ?? 2,
                                              nStoreBuffers: process.nStoreBuffers ?? 16,
                                              rThru: rThru ?? 1,
                                              ...repetitionFields(toRaw(process)),
                                              instruction_list: toRaw(instructionList)}, null, 2),
                            iters) // Call Python RVCAT
        console.log('🕐✅ Reloading execution results')
       }, 200)
    } catch (error) {
      console.error('🕐❌Failed to request execution results:', error)
    }
  }

// ============================================================================
// confirmDownload, uploadResults
// ============================================================================
 const ADD_NEW_OPTION = '_add_new_'

  watch( () => simulationOptions.resultName, (newName, oldName) => {
    try {
      if (newName === ADD_NEW_OPTION)
        return uploadResults(oldName)
      saveOptions()
    } catch (error) {
      console.error('🕐❌ Failed when changing result name:', error)
    }
  })

  async function downloadResult(index) {
    const name   = simulationOptions.availableResults[index]
    const stored = localStorage.getItem(`results.${name}`)
    if (stored) {
      const data = JSON.parse(stored)
      data.name = name
      await downloadJSON(data, name, 'result')
    }
  }

  // The stored results as a CSV file (a spreadsheet opens it)
  function exportCsv() {
    const rows = simulationOptions.availableResults.map((name, i) => ({ name, result: showResultsInfo.value[i] }))
    const csv  = resultsToCsv(rows, simulationOptions.referenceResult)
    const url  = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'rvcat-results.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const uploadResults = async (oldResult) => {
    try {
      const data = await uploadJSON(null, 'result')
      if (data) {
        const exists = simulationOptions.availableResults.includes(data.name)
        if (exists && !confirm(t('A result with the name "{name}" is already loaded. Do you want to overwrite it?', { name: data.name }))) {
          alert(t('Upload cancelled.'))
          simulationOptions.resultName = oldResult
          return
        }
        saveToLocalStorage('result', data.name, data, simulationOptions.availableResults)
        simulationOptions.resultName = data.name;
        updateShowResults()
        console.log(`✅ Upload results to "${data.name}"`);
        return
      }
    } catch (error) {
      console.error('🕐❌ Failed to upload result:', error)
    }
    simulationOptions.resultName = oldResult
  }

  const copyResults = async () => {
    try {
      const res = localStorage.getItem('simResults');
      if (res) {
        const data = JSON.parse(res);
        // Results on screen are valid for the current program/processor (they may have been reused
        // without re-simulating after a name change): describe them with the current configuration
        if (simState.executionResults && simState.state >= 3)
          data.context = buildResultContext(toRaw(simState.simulatedProcess), simState.processorName)
        const name = defaultResultName(data.context, simulationOptions.availableResults);
        localStorage.setItem(`results.${name}`, JSON.stringify(data));
        simulationOptions.availableResults.push(name)
        simulationOptions.resultName = name
        updateShowResults()
        console.log(`✅ Copied results to ${name}`);
        return
      }
      console.log(`✅ Cannot copy, since there are no results to copy`);
    } catch (error) {
      console.error('🕐📄❌ Failed to copy results', error)
    }
  }

  let oldResultNames = {}

  const captureOldValue = (index) => {
    oldResultNames[index] = simulationOptions.availableResults[index]
  }

  const renameResult = (index) => {
    const newName = simulationOptions.availableResults[index]
    const oldName = oldResultNames[index]
    console.log(`✅ Renamed results from "${oldName}" to "${newName}"`);
    if (oldName === newName) return
    const oldData = localStorage.getItem(`results.${oldName}`)
    if (oldData) {
      try {
        localStorage.setItem(`results.${newName}`, oldData)
        localStorage.removeItem(`results.${oldName}`)
        if (simulationOptions.referenceResult === oldName) simulationOptions.referenceResult = newName
        simulationOptions.resultName = newName
        updateShowResults()
      } catch (e) {
        console.error(`❌ Failed to rename results:`, e);
      }
    }
  }

  function moveResult(index, delta) {
    const list = simulationOptions.availableResults
    const other = index + delta
    if (other < 0 || other >= list.length) return
    ;[list[index], list[other]] = [list[other], list[index]]
    updateShowResults()
    saveOptions()
  }

/* ------------------------------------------------------------------
 * Help support
 * ------------------------------------------------------------------ */
  const showHelp1 = ref(false);  const showHelp2 = ref(false);
  const helpIcon1 = ref(null);   const helpIcon2 = ref(null);
  const helpPosition = ref({ top: '0%', left: '0%' });

  function openHelp1()  { nextTick(() => { showHelp1.value = true }) }
  function closeHelp1() { showHelp1.value  = false }
  function openHelp2()  { nextTick(() => { showHelp2.value = true }) }
  function closeHelp2() { showHelp2.value  = false }

</script>

<template>
  <div class="main simulation-root">
    <div class="header sim-header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" :title="t('Show help')">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">{{displayText}}</span>
      </div>
      <div class="iters-run">
        <button class="run-button" @click="reloadExecutionResults" :disabled="!!simState.simulationBlocked"
          :title="simState.simulationBlocked || t('Simulate the program on the processor')" id="run-simulation-button" >
          ▶ {{ t('Run Simulation') }}
        </button>
        <!-- Options that are rarely changed: folded -->
        <details class="sim-options" id="simulation-options">
          <summary :title="t('Options of the simulation: instruction scheduler, behavior after a mispredicted branch, automatic simulation')">
            ⚙ {{ t('Options') }}
          </summary>
          <div class="sim-options-body">
            <label class="sim-setting" :title="t('Instruction scheduler (an option of the simulation): optimal issues in each cycle the largest set of ready instructions, the oldest first; greedy issues each ready instruction, in program order, to its first free port')">
              Scheduler:
              <select v-model="settings.sched" id="simulation-sched" :disabled="!!fixedOption('sched')">
                <option value="optimal">optimal</option>
                <option value="greedy">greedy</option>
              </select>
            </label>
            <label class="sim-setting" :title="t('What the processor does after a mispredicted conditional branch (programs with \'if c skip k\'): stall = dispatch stops until the branch resolves, plus the branch penalty of the processor; wrong path = it keeps dispatching and executing the wrong path until the branch resolves (or the ROB is full), then squashes it: its cache accesses act as prefetches or pollute the cache')">
              Mispredictions:
              <select v-model="settings.speculation" id="simulation-speculation" :disabled="!!fixedOption('speculation')">
                <option value="stall">stall</option>
                <option value="wrong-path">wrong path</option>
              </select>
            </label>
            <label class="sim-setting" id="autorun-label"
                   :title="t('Set to run the simulation every time the processor/program/#iterations is modified')">
              <input type="checkbox" id="automatic-simulation-check"
                     :checked="simulationOptions.autorun" @change="toggleAutorun" />
              {{ t('Simulate automatically after every change') }}
            </label>
          </div>
        </details>
      </div>
    </div>

    <div id="simulation-results-info" class="results-info">
      <div v-if="!hasResults" class="no-results" id="no-results">
        {{ t('No results yet: press ▶ Run Simulation to simulate {program} on {processor}.', { program: simState.simulatedProcess?.name ?? '', processor: simState.processorName ?? '' }) }}
      </div>
      <template v-else>
        <!-- The main metrics, large -->
        <div class="key-metrics">
          <div class="key-metric" :title="t('Clock cycles per loop iteration')">
            <span class="key-label">Cycles/iter</span>
            <span class="key-value" id="cycles-per-iteration-output">{{ formattedResults.cpi }}</span>
          </div>
          <div v-if="formattedResults.stride > 1" class="key-metric" :title="formattedResults.algOpTitle">
            <span class="key-label">Cycles/Alg Oper</span>
            <span class="key-value" id="cycles-per-alg-op-output">{{ formattedResults.algOp }}</span>
          </div>
          <div class="key-metric" :title="ipcTooltip">
            <span class="key-label">IPC</span>
            <span class="key-value" id="IPC-output" :style="{ color: ipcColor }">{{ formattedResults.ipc }}</span>
          </div>
        </div>
        <div class="row">
          <div class="simulation-inline-item">
            <label>{{ t('Iterations:') }}</label>
            <span id="iterations-output" :title="t('Total loop iterations')">{{ formattedResults.iters }}</span>
          </div>
          <div v-if="repetitions" class="simulation-inline-item" id="calls-item">
            <label>{{ t('Calls:') }}</label>
            <span id="calls-output"
                  :title="t('The loop runs {r} times (calls of the function), {i} iterations each; {kind}', { r: repetitions.reps, i: (repetitions.itersPerRep ?? 0).toLocaleString('en-US'), kind: simState.simulatedProcess?.repIndependent === false ? t('each call uses the results of the previous one') : t('independent calls: they can overlap') })">
              {{ repetitions.reps }} × {{ (repetitions.itersPerRep ?? 0).toLocaleString('en-US') }}
            </span>
          </div>
          <div class="simulation-inline-item">
            <label>{{ t('Instructions:') }}</label>
            <span id="instructions-output" :title="t('Total executed instructions')">{{ formattedResults.instructions }}</span>
          </div>
          <div class="simulation-inline-item">
            <label>{{ t('Clock Cycles:') }}</label>
            <span id="cycles-output" :title="t('Total clock cycles')">{{ formattedResults.cycles }}</span>
          </div>
          <div v-if="formattedResults.stride > 1" class="simulation-inline-item">
            <label>Instr/Alg Oper:</label>
            <span id="instr-per-alg-op-output" :title="formattedResults.instrAlgOpTitle">{{ formattedResults.instrAlgOp }}</span>
          </div>
        </div>
        <!-- branch statistics (programs with conditional branches) -->
        <div v-if="simState.executionResults?.branch" class="row">
          <div class="simulation-inline-item stat-branch">
            <label>{{ t('Mispredictions/iter:') }}</label>
            <span id="mispredictions-output"
                  :title="t('{m} mispredicted of {n} conditional branches. Branch penalty {p} cycles; after a misprediction: {s}', { m: (simState.executionResults.branch.mispredictions - (simState.executionResults.branch.exit_mispredictions ?? 0)).toLocaleString('en-US'), n: simState.executionResults.branch.branches.toLocaleString('en-US'), p: simState.executionResults.branch.penalty, s: simState.executionResults.branch.speculation }) +
                          (simState.executionResults.branch.exit_mispredictions ? ' ' + t('Also {x} mispredicted exits of the loop, one at the end of each call.', { x: simState.executionResults.branch.exit_mispredictions }) : '')">
              {{ simState.executionResults.branch.mispredictions_per_iteration.toFixed(3) }}
            </span>
          </div>
          <div v-if="simState.executionResults?.branch?.speculation === 'wrong-path'" class="simulation-inline-item stat-branch">
            <label>{{ t('Wrong path:') }}</label>
            <span id="wrong-path-output"
                  :title="t('Wrong-path instructions: {d} dispatched, {e} started executing. Loads: {r} ({rm} misses); stores (RFO): {w} ({wm} misses)', { d: simState.executionResults.branch.wrong_path_dispatched.toLocaleString('en-US'), e: simState.executionResults.branch.wrong_path_executed.toLocaleString('en-US'), r: simState.executionResults.branch.wrong_path_reads.toLocaleString('en-US'), rm: simState.executionResults.branch.wrong_path_read_misses.toLocaleString('en-US'), w: simState.executionResults.branch.wrong_path_writes.toLocaleString('en-US'), wm: simState.executionResults.branch.wrong_path_write_misses.toLocaleString('en-US') })">
              {{ simState.executionResults.branch.wrong_path_dispatched.toLocaleString('en-US') }} instr ·
              {{ (simState.executionResults.branch.wrong_path_read_misses + simState.executionResults.branch.wrong_path_write_misses).toLocaleString('en-US') }} {{ t('misses') }}
            </span>
          </div>
        </div>
        <!-- cache statistics (processors with a cache) -->
        <div v-if="hasCache" class="row">
          <div class="simulation-inline-item stat-cache">
            <label>{{ t('Primary Misses:') }}</label>
            <span id="PrimaryMiss-output"
                  :title="(formattedResults.primaryTitle ? formattedResults.primaryTitle + '. ' : '') + t('Primary misses start a new fill: LD = caused by a LOAD, ST = caused by a STORE.')">{{ formattedResults.primary }}</span>
          </div>
          <div class="simulation-inline-item stat-cache">
            <label>{{ t('Secondary Misses:') }}</label>
            <span id="SecondaryMiss-output"
                  :title="(formattedResults.secondaryTitle ? formattedResults.secondaryTitle + '. ' : '') + t('Secondary misses join an existing or queued fill of the same block: LD = caused by a LOAD, ST = caused by a STORE.')">{{ formattedResults.secondary }}</span>
          </div>
          <div v-if="repetitions && repetitions.firstMisses !== null" class="simulation-inline-item stat-cache" id="misses-per-call-item">
            <label>{{ t('Misses per call:') }}</label>
            <span id="misses-per-call-output"
                  :title="t('Primary misses of each call: {list}', { list: repetitions.missesList.slice(0, 40).map(m => m.toLocaleString('en-US')).join(', ') + (repetitions.missesList.length > 40 ? ', …' : '') })">
              {{ t('1st') }} {{ repetitions.firstMisses.toLocaleString('en-US') }} ·
              {{ t('next') }} {{ repetitions.nextMisses === null ? '—' : Number(repetitions.nextMisses.toFixed(1)).toLocaleString('en-US') }}
            </span>
          </div>
          <div v-if="simState.executionResults?.store_buffer_full_cycles > 0" class="simulation-inline-item stat-cache" id="sb-full-item">
            <label>{{ t('SB full:') }}</label>
            <span id="sb-full-output"
                  :title="t('Cycles in which dispatch waited for a free entry of the store buffer ({n} entries)', { n: simState.simulatedProcess?.nStoreBuffers ?? 16 })">
              {{ simState.executionResults.store_buffer_full_cycles.toLocaleString('en-US') }} {{ t('cycles') }}
            </span>
          </div>
          <div class="simulation-inline-item stat-cache">
            <label>{{ t('MM Transfers:') }}</label>
            <span id="MM-output"
                  :title="(formattedResults.MMTitle ? formattedResults.MMTitle + '. ' : '') + t('Rd = Main Memory reads caused by cache misses (including STORE read-for-write); Wr = writes of dirty blocks evicted from the cache.')">{{ formattedResults.MM }}</span>
          </div>
        </div>
        <div class="usage-note sim-usage-part">
          {{ t('The usage of each resource (%) is shown on the diagram of the processor, in the left panel.') }}
        </div>
      </template>
    </div>
    <div v-if="executionError" class="execution-validation-error" role="alert">
      {{ executionError }}
    </div>

    <div class="sim-running-msg">
      <div class="running-group">
        <div id="run-simulation-spinner" class="spinner" style="display: none;"></div>
        <div id="simulation-running">
          <p>{{ t('Simulation on course...') }}</p>
          <div v-if="simProgress" class="sim-progress" id="simulation-progress">
            <progress :value="Math.round(100 * simProgress.fraction)" max="100"></progress>
            <span id="simulation-progress-text">{{ progressText }}</span>
            <button class="blue-button" id="abort-simulation" @click="abortSimulation"
                    :title="t('Stop the simulation (the simulator is restarted: a few seconds)')">{{ t('Abort') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stored results: to compare versions of the program or of the processor -->
    <div class="header stored-results-part">
      <div class="section-title-and-info">
        <span ref="helpIcon2" class="info-icon" @click="openHelp2" :title="t('Show help')">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">{{ t('Stored results') }}</span>
      </div>
      <div class="iters-run">
        <button class="blue-button" @click="copyResults" :disabled="!hasResults"
            :title="hasResults ? t('Store the current results in the table, to compare them with other versions') : t('Run a simulation first')"
            id="store-results-button">
          ＋ {{ t('Store Results') }}
        </button>
        <button class="blue-button" @click="exportCsv" :disabled="!simulationOptions.availableResults.length"
            :title="t('Download the stored results as a CSV file (for a spreadsheet or a report)')"
            id="export-results-csv">
          ⬇ CSV
        </button>
        <label class="all-columns" :title="t('Show every column of the stored results (iterations, instructions, cycles, all the misses…)')">
          <input type="checkbox" v-model="simulationOptions.allColumns" @change="saveOptions" id="results-all-columns" />
          {{ t('All columns') }}
        </label>
        <button v-if="authorMode" class="blue-button" @click="uploadResults(simulationOptions.resultName)"
            :title="t('Load a result file (JSON)')" id="upload-results-button">
          {{ t('Load…') }}
        </button>
      </div>
    </div>
    <div class="table-container stored-results-part">
        <div v-if="!simulationOptions.availableResults.length" class="no-results" id="no-stored-results">
          {{ t('No stored results. Run a simulation and press Store Results to compare versions of the program or of the processor.') }}
        </div>
        <table v-else class="results-table">
          <thead>
            <tr>
              <th> {{ t('Name') }}  </th>
              <th v-if="columns.all"> {{ t('Iters') }}  </th>
              <th v-if="columns.all"> {{ t('Instr') }}  </th>
              <th v-if="columns.all"> {{ t('Cycles') }} </th>
              <th> Cycles/iter </th>
              <th v-if="columns.all" :title="instrAlgOpHeaderTitle"> Instr/Alg Oper </th>
              <th v-if="columns.algOps" :title="algOpHeaderTitle"> Cycles/Alg Oper </th>
              <th :title="speedupHeaderTitle"> Speedup </th>
              <th> IPC    </th>
              <th v-if="columns.branch" :title="t('Mispredicted conditional branches per loop iteration (programs with if c skip k)')"> Mispred/iter </th>
              <th v-if="columns.cache" :title="t('Primary cache misses (LOAD + STORE)')"> {{ t('Primary') }} </th>
              <th v-if="columns.all" :title="t('Secondary cache misses (LOAD + STORE)')"> {{ t('Secondary') }} </th>
              <th v-if="columns.all" :title="t('Main Memory transfers (reads + writes); the detail is in the tooltip')"> MM </th>
              <th class="actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(name, index) in simulationOptions.availableResults" :key="name + index">
              <td @mouseenter="showResultContext($event, index)" @mouseleave="hideResultContext"
                  @focusin="showResultContext($event, index)" @focusout="hideResultContext">
                <input type="text"
                  v-model="simulationOptions.availableResults[index]"
                  class="iters-group result-name"
                  :title="t('Name of the result (click to change it)')"
                  @focus="captureOldValue(index)"
                  @blur="renameResult(index)"
                />
              </td>
              <td v-if="columns.all" :title="t('Total loop iterations executed')">
                {{ showResultsInfo[index]?.total_iterations?.toLocaleString('en-US') ?? '—' }}
              </td>
              <td v-if="columns.all" :title="t('Total machine instructions executed')">
                {{ showResultsInfo[index]?.total_instructions?.toLocaleString('en-US') ?? '—' }}
              </td>
              <td v-if="columns.all" :title="t('Total clock cycles taken')">
                {{ showResultsInfo[index]?.total_cycles?.toLocaleString('en-US') ?? '—' }}
              </td>
              <td :title="t('Cycles per loop iteration')">
                {{ showResultsInfo[index]?.cycles_per_iteration?.toFixed(2) ?? '—' }}
              </td>
              <td v-if="columns.all" :title="storedInstrAlgOps[index]?.title">
                {{ storedInstrAlgOps[index]?.value ?? '—' }}
              </td>
              <td v-if="columns.algOps" :title="storedAlgOps[index]?.title">
                {{ storedAlgOps[index]?.value ?? '—' }}
              </td>
              <td class="speedup-cell" :class="{ reference: storedSpeedups[index]?.isRef }">
                <button class="ref-button" :class="{ active: storedSpeedups[index]?.isRef }"
                        :title="storedSpeedups[index]?.isRef ? t('Reference result: click to clear') : t('Use this result as the reference for the speedup')"
                        @click="setReferenceResult(name)">{{ storedSpeedups[index]?.isRef ? '★' : '☆' }}</button>
                <span :title="storedSpeedups[index]?.title">{{ storedSpeedups[index]?.value }}{{ storedSpeedups[index]?.value && storedSpeedups[index]?.value !== 'X' ? '×' : '' }}</span>
              </td>
              <td :title="t('Instructions Per cycle (IPC)')">
                {{ showResultsInfo[index]?.ipc?.toFixed(3) ?? '—' }}
              </td>
              <td v-if="columns.branch" :title="showResultsInfo[index]?.branch ? t('{m} mispredicted of {n} conditional branches; after a misprediction: {s}', { m: showResultsInfo[index].branch.mispredictions.toLocaleString('en-US'), n: showResultsInfo[index].branch.branches.toLocaleString('en-US'), s: showResultsInfo[index].branch.speculation }) : t('No conditional branches')">
                {{ showResultsInfo[index]?.branch ? showResultsInfo[index].branch.mispredictions_per_iteration.toFixed(3) : '—' }}
              </td>
              <td v-if="columns.cache" :title="storedMemoryColumns[index]?.primaryDetail || t('Primary cache misses')">
                {{ storedMemoryColumns[index]?.primary ?? '—' }}
              </td>
              <td v-if="columns.all" :title="storedMemoryColumns[index]?.secondaryDetail || t('Secondary cache misses')">
                {{ storedMemoryColumns[index]?.secondary ?? '—' }}
              </td>
              <td v-if="columns.all" :title="storedMemoryColumns[index]?.MMDetail || t('Main Memory transfers')">
                {{ storedMemoryColumns[index]?.MM ?? '—' }}
              </td>
              <td class="row-actions">
                <button class="row-button" :disabled="index === 0" @click="moveResult(index, -1)"
                        :title="t('Move up')" :aria-label="t('Move up')">▲</button>
                <button class="row-button" :disabled="index === simulationOptions.availableResults.length - 1" @click="moveResult(index, 1)"
                        :title="t('Move down')" :aria-label="t('Move down')">▼</button>
                <button v-if="authorMode" class="row-button" @click="downloadResult(index)"
                        :title="t('Download this result as a JSON file')">⬇</button>
                <button class="row-button delete" @click="removeResult(index)"
                        :title="t('Remove this result')" :aria-label="t('Remove this result')">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
    </div>
    <Teleport to="body">
      <div v-if="contextHover" class="result-context-box" :style="contextHover.style">
        <div v-for="(line, i) in contextHover.lines" :key="i">{{ line }}</div>
      </div>
    </Teleport>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition"
    :text="t('help.simulation')"
    :title="t('Overall Simulation Results')"
    @close="closeHelp1"/>
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp2" :position="helpPosition"
    :text="t('help.storedResults')"
    :title="t('Previous Performance Results')"
    @close="closeHelp2"/>
  </Teleport>

</template>

<style scoped>

  .iters-run span {
    white-space: nowrap;
  }
  .simulation-inline-item.stat-branch { background: #e6f4e6; }
  .simulation-inline-item.stat-cache  { background: #e6eef8; }
  .simulation-inline-item.stat-cache-first { margin-left: auto; }
  .sim-setting {
    display:     inline-flex;
    align-items: center;
    gap:         0.3em;
    white-space: nowrap;
    font-size:   0.875rem;
  }
  .sim-setting select { font-size: 0.875rem; }

  .execution-validation-error {
    margin: 8px 0;
    color: #a12622;
    font-weight: 600;
  }

  .iters-run {
    display:     flex;
    align-items: center;
    gap:         10px;
    flex-wrap:   nowrap;
  }

  .iters-run input[type="checkbox"] {
    width:  22px;
    height: 22px;
    cursor: pointer;
    accent-color: #4a90e2;
    margin: 0;
    vertical-align: middle;
  }

  .iters-run input[type="checkbox"]:hover {
    transform:  scale(1.05);
    transition: transform 0.2s ease;
  }

  .settings-container {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1;
    justify-content: center;
  }
  .settings-container select,
  .settings-container button {
    flex-shrink: initial;
  }

  .form-select {
    width:            100%;
    padding:          1px 1px;
    margin-bottom:    2px;
    border:           2px solid #ddd;
    border-radius:    6px;
    font-size:        1rem;
    background-color: white;
    transition:       border-color 0.3s;
  }

  .form-select:focus {
    outline:      none;
    border-color: #4a6cf7;
  }

  .form-select option[value="_add_new_"] {
    color:            #4a6cf7;
    font-weight:      bold;
    background-color: #f0f5ff;
  }

  .results-info {
    /* Font size follows the panel width so the 5 metrics of the first row fit in one line */
    container-type: inline-size;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  .results-info .row {
    display:         flex;
    gap:             4px;
    margin-bottom:   6px;
    flex-wrap:       wrap;
    justify-content: space-between;
    font-size:       clamp(0.875rem, 1.6cqi, 1.125rem);
  }

  .simulation-inline-item {
    flex:            1;
    display:         flex;
    padding:         2px 2px;
    justify-content: space-between;
    align-items:     center;
    background:      #f0f0f0;
    border-radius:   6px;
  }
  .simulation-inline-item label {
    flex:         1;
    margin-right: 0.4em;
    font-weight:  600;
    color:       #333;
    white-space:  nowrap;
  }
  .simulation-inline-item span {
    text-align:  right;
    flex-shrink: 0;
    font-weight: bold;
    white-space: nowrap;
    transition:  color 0.3s ease;
  }

  /* The main metrics, large */
  .key-metrics {
    display:       flex;
    gap:           10px;
    margin:        6px 0 8px;
    flex-wrap:     wrap;
  }
  .key-metric {
    flex:           1;
    min-width:      9rem;
    display:        flex;
    flex-direction: column;
    align-items:    center;
    padding:        4px 8px;
    background:     #eef4fb;
    border:         1px solid #cfdcec;
    border-radius:  8px;
    cursor:         help;
  }
  .key-label { font-size: 0.9375rem; font-weight: 600; color: #333; }
  .key-value { font-size: 1.75rem; font-weight: 700; color: #0b2e5c; line-height: 1.2; }

  .no-results {
    margin:     10px 4px;
    padding:    10px 12px;
    color:      #444;
    background: #f6f8fb;
    border:     1px dashed #b9c6d8;
    border-radius: 6px;
  }
  .usage-note { color: #555; font-size: 0.875rem; margin: 2px 2px 6px; }

  .sim-running-msg {
    display:         flex;
    width:           100%;
    align-items:     center;
    justify-content: center;
  }
  .running-group {
    display: flex;
    gap:     10px;
  }
  .sim-progress { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
  .sim-progress progress { width: 220px; height: 14px; }
  .spinner {
    width:  15px;
    height: 15px;
    width:  5vh;
    height: 5vh;
    margin: auto;
    animation:  spin 1s linear infinite;
    border:     8px solid #f0f0f0;
    border-top: 8px solid #0085dd;
    border-radius: 50%;
  }
  @keyframes spin {
      0% {
          transform: rotate(0deg);
      }
      100% {
          transform: rotate(360deg);
      }
  }

  .table-container {
     width:          auto;
     max-width:      100%;
     overflow-x:     auto;
     overflow-y:     auto;
     padding-bottom: 37px;
     border:         1px solid #ddd;
     border-radius:  5px;
     margin-right:   2px;
  }

  .result-context-box {
    position:      fixed;
    z-index:       10000;
    padding:       6px 10px;
    background:    #fffff0;
    border:        1px solid #999;
    border-radius: 6px;
    box-shadow:    0 4px 12px rgba(0, 0, 0, 0.2);
    font-family:   ui-monospace, Consolas, monospace;
    font-size:     0.875rem;
    line-height:   1.4;
    white-space:   pre-wrap;
    overflow-wrap: anywhere;
    pointer-events: none;
  }

  .speedup-cell {
    white-space: nowrap;
  }
  .speedup-cell.reference {
    font-weight: 600;
  }
  .ref-button {
    all:         unset;
    cursor:      pointer;
    color:       #b58900;
    margin-right: 0.3em;
  }
  .ref-button:hover {
    color:       #1a4fb3;
  }
  .results-table {
    width:           100%;
    border-collapse: collapse;
    font-size:       0.875rem;
    padding-bottom:  30px;
  }
  .results-table thead {
    position:   sticky;
    top:        0;
    background: #007acc;
    color:      white;
    z-index:    1;
  }
  .results-table th {
    padding:     3px 3px;
    text-align:  center;
    font-weight: bold;
    border:      1px solid #005a9e;
  }
  .results-table td {
    padding:        0px;
    border:         1px solid #ddd;
    vertical-align: middle;
    text-align:     center;
    font-size:      1rem;
  }
  .results-table tbody tr:nth-child(even) {
    background: #f9f9f9;
  }
  .results-table tbody tr:hover {
    background: #e8f4fd;
  }
  .results-table .result-name { width: 100%; min-width: 10rem; box-sizing: border-box; }
  .row-actions { white-space: nowrap; padding: 0 4px !important; }
  .row-button {
    border:        1px solid #c9d6ea;
    background:    white;
    border-radius: 4px;
    padding:       0 5px;
    margin:        1px;
    cursor:        pointer;
    font-size:     0.875rem;
  }
  .row-button:hover:not([disabled]) { background: #e6f0ff; }
  .row-button[disabled] { opacity: 0.35; cursor: default; }
  .row-button.delete:hover { background: #fde2e2; }

  /* Run Simulation: the main action of the panel */
  .run-button {
    padding:       6px 16px;
    border:        none;
    border-radius: 8px;
    background:    #1a4fb3;
    color:         white;
    font-size:     1.0625rem;
    font-weight:   700;
    cursor:        pointer;
    white-space:   nowrap;
    box-shadow:    0 1px 3px rgba(0, 0, 0, 0.25);
  }
  .run-button:hover:not([disabled]) { background: #123b88; }
  .run-button[disabled] { opacity: 0.5; cursor: default; }

  /* Options of the simulation, folded */
  .sim-options { position: relative; }
  .sim-options summary {
    cursor:        pointer;
    list-style:    none;
    padding:       3px 10px;
    border:        1px solid #c9d6ea;
    border-radius: 6px;
    color:         #1a4fb3;
    font-weight:   600;
    white-space:   nowrap;
  }
  .sim-options summary::-webkit-details-marker { display: none; }
  .sim-options[open] summary { background: #e6f0ff; }
  .sim-options-body {
    position:       absolute;
    right:          0;
    top:            calc(100% + 4px);
    z-index:        20;
    display:        flex;
    flex-direction: column;
    gap:            8px;
    padding:        10px 12px;
    background:     white;
    border:         1px solid #c9d6ea;
    border-radius:  8px;
    box-shadow:     0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .all-columns { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }

</style>
