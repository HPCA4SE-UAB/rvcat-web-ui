<script setup>
  import { ref, toRaw, computed, onMounted, onUnmounted, onBeforeUnmount,
           nextTick, inject, watch, reactive }                       from "vue"
  import HelpComponent                    from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'
  import { createGraphVizGraph, downloadJSON, uploadJSON,
           saveToLocalStorage, removeFromLocalStorage, initResource,
           getLogicalElementCount, getUnsupportedInstructions,
           validateProgram } from '@/common'
  import { buildResultContext, defaultResultName,
           resultMemoryColumns, resultContextLines } from '@/resultContext'

  const { getExecutionResults } = useRVCAT_Api();
  const { registerHandler }     = inject('worker');
  const simState                = inject('simulationState');

 /* ------------------------------------------------------------------
   * Simulation Results options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'simulationOptions'

  const defaultOptions = {
    autorun:          false,
    availableResults: [],
    resultName:       ''
  }

  const simulationOptions = reactive(defaultOptions)

  const resultsSvg            = ref('')
  const executionError        = ref('')
  let   cleanupHandleResults  = null
  let   resultsTimeout        = null
  const showResultsInfo       = ref({})

  // Memory columns of the stored-results table, by row index
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
    return `Simulate Execution of ${simState.simulatedProcess.name} on ${simState.processorName}`
  })

/* ------------------------------------------------------------------
  * Simulation Results (persistent in localStorage)
  * ------------------------------------------------------------------ */
  let simResults = {}
  let simProcess = {}
  let pendingContext = null   // context of the simulation sent to RVCAT, attached to its results
  const isArray  = (arr) => Array.isArray(arr);

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
    return true; // ✅ all are equal
  }

  const areProcessorsEqual = (proc1, proc2) => {
    if (proc1 == {} || proc2 == {})        return false
    if (proc1.iters !== proc2.iters)       return false;
    if (proc1.Nloop !== proc2.Nloop)       return false;
    if (proc1.dispatch !== proc2.dispatch) return false;
    if (proc1.retire !== proc2.retire)     return false;
    if (proc1.sched !== proc2.sched)       return false;
    if (proc1.ROBsize !== proc2.ROBsize)   return false;
    if (proc1.nBlocks !== proc2.nBlocks)   return false;
    if (proc1.nBlocks > 0) {
      if (proc1.blkSize    !== proc2.blkSize)    return false;
      if (proc1.mIssueTime !== proc2.mIssueTime) return false;
      if (proc1.mPenalty   !== proc2.mPenalty)   return false;
      if (proc1.nFillBuffers !== proc2.nFillBuffers) return false;
      if (proc1.nWriteBuffers !== proc2.nWriteBuffers) return false;
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
      const equalProcs = areProcessorsEqual(simState.simulatedProcess, simProcess)
      if (equalProcs) {
        if (simState.executionResults == null) simState.executionResults = simResults
        console.log('🕐✅ Same simulated proces: execution results are valid');
        drawProcessorResults();
      } else if (simulationOptions?.autorun) {
        console.log('🕐🔄 Something changed: re-running simulation', equalProcs)
        reloadExecutionResults()
      } else {
        simState.executionResults = null; // Clear results to avoid showing outdated data
        resultsSvg.value = ''; // Clear graph
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

  const CONFIRM_KEY = 'confirmDeleteResults';

  function removeResult () {
    if (simulationOptions.availableResults.length === 0) return;

    const askConfirmation = localStorage.getItem(CONFIRM_KEY) !== 'false';

    if (askConfirmation) {
      const confirmed = confirm(
        `Results named "${simulationOptions.resultName}" will disappear. Are you sure?\n\n` +
        `Press OK to confirm, Cancel to abort.`
      );

      if (!confirmed) {
        alert('Removal cancelled.');
        return;
      }

      const dontAskAgain = confirm("Do you want to skip this confirmation next time?");
      if (dontAskAgain) {
        localStorage.setItem(CONFIRM_KEY, 'false');
      }
    }

    removeFromLocalStorage('result', simulationOptions.resultName, simulationOptions.availableResults );

    if (simulationOptions.availableResults.length > 0) {
      simulationOptions.resultName = simulationOptions.availableResults[0];
    }
  }

  onMounted(() => {
    cleanupHandleResults  = registerHandler('get_execution_results', handleResults)
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
    console.log('🕐👋 SimulationComponent unMounted')
  })

// ============================================================================
// WATCHES: simulatedProcess, rvcat results
// ============================================================================

  watch( () => simState.simulatedProcess, () => { updateResults() },
    { deep: true, immediate: false }
  )

  // Handler for 'get_execution_results' message (fired by RVCAT getPerformanceAnalysis function)
  const handleResults = async (data, dataType) => {
    if (dataType === 'error') {
      console.error('🕐❌Failed to get execution results:', data);
      return;
    }
    try {
      console.log('🕐✅ Execution Results received')
      // Results + snapshot of the simulated program/processor (shown when stored results are hovered)
      simResults = { ...JSON.parse(data), context: pendingContext }
      saveResults()
      if (resultsTimeout) clearTimeout(resultsTimeout)
      resultsTimeout = setTimeout(() => {
        drawProcessorResults()
        document.getElementById('run-simulation-spinner').style.display = 'none';
        document.getElementById('simulation-running').style.display     = 'none';
        document.getElementById('run-simulation-button').disabled       = false;
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

    // "a+b = a+b total", or 'X' when a value is missing
    const formatSum = (a, b) => (Number.isFinite(a) && Number.isFinite(b))
      ? `${a.toLocaleString()}+${b.toLocaleString()} = ${(a + b).toLocaleString()}`
      : 'X'

    const mmUsagePercent = Number.isFinite(results.MM_usage_percent)
      ? results.MM_usage_percent
      : totalCycles > 0
        ? 100 * (MM_reads + MM_writes) * simState.simulatedProcess.mIssueTime / totalCycles
        : 0
    const mmTransfers = formatSum(MM_reads, MM_writes)

    return {
      iters:        nIters.toLocaleString(),
      instructions: totalInstrs.toLocaleString(),
      cycles:       totalCycles.toLocaleString(),
      cpi:          cpi.toFixed(2),
      ipc:          ipc.toFixed(3),
      primary:      formatSum(results.read_primary_misses,   results.write_primary_misses),
      secondary:    formatSum(results.read_secondary_misses, results.write_secondary_misses),
      MM:           mmTransfers === 'X' ? 'X' : `${mmTransfers} (${mmUsagePercent.toFixed(1)}%)`
    };
  });

  const ipcColor = computed(() => {
    const ipc = simState.executionResults?.["ipc"] ?? 0
    const dw  = simState.simulatedProcess?.dispatch || 1

    if (!ipc || !dw || dw === 0) return '#666';

    const ratio = ipc / dw;

    // close to maximum (>= 80% of dispatch width) -> Green
    if (ratio >= 0.8) return '#00cc44';

    // Very low (<= 10% of dispatch width) -> Red
    if (ratio <= 0.1) return '#ff3333';

    // Intermediate: gradient from red to green
    const t     = (ratio - 0.1) / 0.7; // Normalize 0.1-0.8 to 0-1
    const red   = Math.floor(255 * (1 - t));
    const green = Math.floor(255 * t);

    return `rgb(${red}, ${green}, 0)`;
  });

  const ipcStyle = computed(() => ({
    color:      ipcColor.value,
    fontWeight: 'bold',
    fontSize:   '1.2em',
    backgroundColor: `${ipcColor.value}10`,
    padding:    '2px 6px',
    borderRadius: '4px',
    transition: 'all 0.3s ease'
  }));

  const ipcTooltip = computed(() => {
    const ipc = simState.executionResults?.["ipc"] ?? 0;
    const dw  = simState.simulatedProcess?.dispatch || 1;
    const efficiency = ((ipc / dw) * 100).toFixed(1);
    return `IPC: ${ipc.toFixed(3)} | Dispatch Width: ${dw}\nEfficiency: ${efficiency}% of maximum possible IPC`;
  });

  const repeatingCriticalPath = computed(() =>
    simState.executionResults?.critical_path?.repeating_pattern ?? null
  )

  const repeatingCriticalPathText = computed(() => {
    const nodes = repeatingCriticalPath.value?.nodes
    if (!nodes?.length) return ''
    return nodes.map(node =>
      `#${node.instruction_index + 1} ${node.instruction} [${node.stage}, ${node.cycles} cycles]`
    ).join(' → ')
  })

  const reloadExecutionResults = async () => {
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
      executionError.value = `Cannot simulate invalid program: ${validationErrors.join(' ')}`
      console.error('🕐❌ Cannot simulate invalid program:', validationErrors)
      simState.executionResults = null
      resultsSvg.value = ''
      return
    }

    const unsupportedInstructions = getUnsupportedInstructions(process)
    if (unsupportedInstructions.length) {
      const instructionList = unsupportedInstructions
        .map(({ index, instruction }) => `#${index + 1} (${instruction.type}.${instruction.oper})`)
        .join(', ')
      executionError.value =
        `Cannot simulate: the active processor has no execution port for ${instructionList}.`
      console.error('🕐❌ Cannot simulate unsupported instructions:', unsupportedInstructions)
      simState.executionResults = null
      resultsSvg.value = ''
      return
    }

    simProcess = {
      iters:    process.iters,
      Nloop,
      dispatch: process.dispatch,
      retire:   process.retire,
      sched:    process.sched,
      ROBsize:  process.ROBsize,
      nBlocks:  process.nBlocks,
      blkSize:  process.blkSize,
      mIssueTime: process.mIssueTime,
      mPenalty: process.mPenalty,
      nFillBuffers: process.nFillBuffers ?? 2,
      nWriteBuffers: process.nWriteBuffers ?? 2,
      rThru: process.rThru ?? 1,
      instruction_list: JSON.parse(JSON.stringify(instructionList))
    }
    clearTimeout(resultsTimeout)
    try {
      resultsTimeout = setTimeout(() => {
        document.getElementById('run-simulation-spinner').style.display = 'block';
        document.getElementById('simulation-running').style.display     = 'block';
        document.getElementById('run-simulation-button').disabled       = true;
        resultsSvg.value = `<div class="error">Waiting to generate simulation results graph</div>`;

        const { iters, ROBsize, dispatch, retire, sched, blkSize, nBlocks, mPenalty, mIssueTime,
                nFillBuffers, nWriteBuffers, rThru } = process
        pendingContext = buildResultContext(toRaw(process), simState.processorName)
        getExecutionResults(JSON.stringify( { Nloop, ROBsize, dispatch, retire, sched, blkSize, nBlocks, mPenalty, mIssueTime,
                                              nFillBuffers: nFillBuffers ?? 2,
                                              nWriteBuffers: nWriteBuffers ?? 2,
                                              rThru: rThru ?? 1,
                                              instruction_list: toRaw(instructionList)}, null, 2),
                            iters) // Call Python RVCAT
        console.log('🕐✅ Reloading execution results')
       }, 200)
    } catch (error) {
      console.error('🕐❌Failed to request execution results:', error)
    }
  }

  const drawProcessorResults = async () => {
    try {
      const dotCode      = get_proc_results_dot (simState.simulatedProcess, simResults)
      const svg          = await createGraphVizGraph(dotCode);
      resultsSvg.value = svg.outerHTML;
    } catch (error) {
      console.error('🕐❌ Failed to draw results+processor:', error)
      resultsSvg.value = `<div class="error">Failed to render graph</div>`;
    }
  }

  function get_proc_results_dot (process, results) {

    const ports    = process.ports
    const port_ids = Object.keys(ports)
    const ROBsize  = process.ROBsize || 20
    const dispatch = process.dispatch
    const retire   = process.retire
    const nblocks   = process.nBlocks
    const blkSize   = process.blkSize
    const mIssueTime = process.mIssueTime
    const mPenalty   = process.mPenalty
    const MM_reads   = results["MM_Reads"]
    const MM_writes  = results["MM_Writes"]
    const totalCycles = results["total_cycles"]

    const percentage = (100 * (MM_reads + MM_writes) * mIssueTime / totalCycles)

    // Colorscale from grey to red
    const color = [
      "#e0e0e0",  "#c8e6c9",  "#a5d6a7",  "#81c784",  "#66bb6a",  "#4caf50",  "#43a047",  "#388e3c",
      "#2e7d32",  "#558b2f",  "#7cb342",  "#9e9d24",  "#c0ca33",  "#d4b000",  "#c49000",  "#b37400",
      "#a35a00",  "#933f00",  "#832600",  "#731200",  "#630000",  "#4a0000"    ];

    let usage = 0
    if (results !== null)
      usage = (results.ipc / dispatch) * 100
    let dispatch_color = color[Math.floor(usage/5)]

    let message =  usage !== 0
      ? `&nbsp;&nbsp;&nbsp;Usage:<B><FONT COLOR="${dispatch_color}">${usage.toFixed(1)}%</FONT></B>`
      : ""

    // ---- Decode ----
    let decode_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="dispatch" TITLE="Usage of dispatch capacity"><FONT POINT-SIZE="20"><B>Dispatch:&nbsp;</B>&nbsp;${dispatch}/cycle${message}</FONT></TD>
      <TD ROWSPAN="4" BGCOLOR="#f0f0f0" HREF="#" ID="rob" TITLE="Pending: usage of ROB capacity" ALIGN="CENTER" VALIGN="MIDDLE"><FONT POINT-SIZE="20"><B>ROB</B><BR/>${ROBsize}</FONT><BR/><FONT POINT-SIZE="16">entries</FONT></TD>
    </TR>`

    // ---- Port headers ----
    let port_header = "<TR>"

    for (let p of port_ids) {
      const style = ` BGCOLOR="#f5f5f5" HREF="#" TITLE="Usage of port ${p}"`
      usage = 0
      if (results?.ports?.[p] != null)
        usage = results.ports[p]
      let port_color = color[Math.floor(usage/5)]
      let message = usage !== 0
        ? `<FONT COLOR="${port_color}">${usage.toFixed(0)}%</FONT>`
        : ""
      port_header += `<TD${style}><FONT POINT-SIZE="20"><B>P${p} ${message}</B></FONT></TD>`
    }

    port_header += "</TR>"

    // ---- Cache & Retire ----
    usage = 0
    if (results !== null)
      usage = percentage
    let cache_color = color[Math.floor(usage/5)]

    message =  usage !== 0
      ? `&nbsp;&nbsp;Usage:<B><FONT COLOR="${cache_color}">${usage.toFixed(1)}%</FONT></B>`
      : ""

    let cache_row = `<TR>
      <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="cache" TITLE="Usage of cache capacity"><FONT POINT-SIZE="20"><B>Cache:&nbsp;</B>(${nblocks}, ${blkSize}, ${mIssueTime}, ${mPenalty})${message}</FONT></TD>
    </TR>`

    if (nblocks === 0) {
      cache_row = `<TR>
        <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="cache" TITLE="Cache always hits"><FONT POINT-SIZE="20"><B>Cache:&nbsp;</B>No Cache</FONT></TD>
      </TR>`
    }

    usage = 0
    if (results !== null)
      usage = (results.ipc / retire) * 100
    let retire_color = color[Math.floor(usage/5)]

    message =  usage !== 0
      ? `&nbsp;&nbsp;&nbsp;Usage:<B><FONT COLOR="${retire_color}">${usage.toFixed(1)}%</FONT></B>`
      : ""

    let reg_row = `<TR>
      <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="retire" TITLE="Usage of retire capacity"><FONT POINT-SIZE="20"><B>Retire:&nbsp;</B>&nbsp;${retire}/cycle${message}</FONT></TD>
    </TR>`

    const dot = `
      digraph CPU {
        node [shape=plain fontname="Arial" width=0 height=0 margin=0]
        pipeline [
          label=<
            <TABLE WIDTH="600" BORDER="2" CELLBORDER="1" CELLSPACING="2" CELLPADDING="1">
              ${decode_row}
              ${port_header}
              ${cache_row}
              ${reg_row}
            </TABLE>
          >
        ]
      }  `
    return dot
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

  const showModalDownload = ref(false)
  const modalName         = ref("")
  const nameError         = ref("")

  async function confirmDownload() {
    const name   = modalName.value.trim();
    const stored = localStorage.getItem(`results.${simulationOptions.resultName}`)
    if (stored) {
      const data = JSON.parse(stored)
      data.name = name
      await downloadJSON(data, name, 'result')
    }
    showModalDownload.value = false;
  }

  const uploadResults = async (oldResult) => {
    try {
      const data = await uploadJSON(null, 'result')
      if (data) {
        const exists = simulationOptions.availableResults.includes(data.name)
        if (exists && !confirm(`A result with the name "${data.name}" is already loaded. Do you want to overwrite it?`)) {
          alert('Upload cancelled.')
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
        simulationOptions.resultName = newName
        updateShowResults()
      } catch (e) {
        console.error(`❌ Failed to rename results:`, e);
      }
    }
  }

  function moveResultsUp() {
    if (simulationOptions.resultName !== simulationOptions.availableResults[0]) {
      const index = simulationOptions.availableResults.indexOf(simulationOptions.resultName);
      const temp = simulationOptions.availableResults[index];
      simulationOptions.availableResults[index] = simulationOptions.availableResults[index - 1];
      simulationOptions.availableResults[index - 1] = temp;
      updateShowResults();
    }
  }

  function moveResultsDown() {
    if (simulationOptions.resultName !== simulationOptions.availableResults[simulationOptions.availableResults.length - 1]) {
      const index = simulationOptions.availableResults.indexOf(simulationOptions.resultName);
      const temp = simulationOptions.availableResults[index];
      simulationOptions.availableResults[index] = simulationOptions.availableResults[index + 1];
      simulationOptions.availableResults[index + 1] = temp;
      updateShowResults();
    }
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
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">{{displayText}}</span>
      </div>
      <div class="iters-run">
        <button class="blue-button" @click="reloadExecutionResults"
          title="Run Simulation" id="run-simulation-button" >
          Run Simulation
        </button>
        <span>AutoRun:</span>
        <input type="checkbox"
              title="Set to run the simulation every time the processor/program/#iterations is modified"
              id="automatic-simulation-check"
              :checked="simulationOptions.autorun"
              @change="toggleAutorun"
          />
      </div>
    </div>

    <div id="simulation-results-info" class="results-info">
      <div class="row">
        <div class="simulation-inline-item">
          <label for="instructions">Iterations:</label>
          <span id="iterations-output" title="Total loop iterations">{{ formattedResults.iters }}</span>
        </div>
        <div class="simulation-inline-item">
          <label for="instructions">Instructions:</label>
          <span id="instructions-output" title="Total executed instructions">{{ formattedResults.instructions }}</span>
        </div>
        <div class="simulation-inline-item">
          <label for="cycles">Clock Cycles:</label>
          <span id="cycles-output" title="Total clock cycles">{{ formattedResults.cycles }}</span>
        </div>
        <div class="simulation-inline-item">
          <label for="cycles-per-iteration">Cycles/iter:</label>
          <span id="cycles-per-iteration-output" title="Clock cycles per loop iteration">{{ formattedResults.cpi }}</span>
        </div>
        <div class="simulation-inline-item">
          <label for="IPC">IPC:</label>
          <span
            id="IPC-output"
            :style="ipcStyle"
            :data-tooltip="ipcTooltip"
          >
            {{ formattedResults.ipc }}
          </span>
        </div>
      </div>
      <div class="row">
        <div class="simulation-inline-item">
          <label for="PrimaryMiss">Primary Misses:</label>
          <span id="PrimaryMiss-output" title="LD+ST = Total. Primary misses start a new fill: LD = caused by a LOAD, ST = caused by a STORE.">{{ formattedResults.primary }}</span>
        </div>
        <div class="simulation-inline-item">
          <label for="SecondaryMiss">Secondary Misses:</label>
          <span id="SecondaryMiss-output" title="LD+ST = Total. Secondary misses join an existing or queued fill of the same block: LD = caused by a LOAD, ST = caused by a STORE.">{{ formattedResults.secondary }}</span>
        </div>
        <div class="simulation-inline-item">
          <label for="MM">MM Transfers:</label>
          <span id="MM-output" title="Rd+Wr = Total (%). Rd = Main Memory reads caused by cache misses (including STORE read-for-write); Wr = writes of dirty blocks evicted from the cache; % = fraction of total cycles in which Main Memory is busy.">{{ formattedResults.MM }}</span>
        </div>
      </div>
    </div>
    <div v-if="executionError" class="execution-validation-error" role="alert">
      {{ executionError }}
    </div>
    <div v-if="repeatingCriticalPath" id="critical-path-pattern" class="critical-path-pattern">
      <strong>Repeated critical-path pattern from Loop Iteration {{ repeatingCriticalPath.start_iteration.toLocaleString() }} to {{ repeatingCriticalPath.end_iteration.toLocaleString() }} ({{ repeatingCriticalPath.cycles_per_iteration.toLocaleString() }} critical cycles per repetition).</strong>
      <p>{{ repeatingCriticalPathText }}</p>
    </div>

    <div class="sim-running-msg">
      <div class="running-group">
        <div id="run-simulation-spinner" class="spinner" style="display: none;"></div>
        <div id="simulation-running"><p>Simulation on course...</p></div>
      </div>
    </div>
    <div class="graph-section">
      <div class="processor-container">
        <div class="processor-img" v-html="resultsSvg" v-if="resultsSvg"></div>
      </div>
    </div>
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon2" class="info-icon" @click="openHelp2" title="Show help">
          <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Previous simulation results</span>
      </div>
      <div class="iters-run">
        <button class="blue-button" @click="copyResults"
            title="Store current simulation results"
            id="store-results-button">
          Store Results
        </button>
        <select v-model="simulationOptions.resultName" class="form-select"
            id="results-list" title="Visualize previously obtained results">
          <option value="" disabled>Select</option>
          <option v-for="result in simulationOptions.availableResults" :key="result" :value="result" >
            {{ result }}
          </option>
          <option value="_add_new_">Add new</option>
        </select>
        <button
          class="blue-button small-btn"
          @click="moveResultsUp()"
          title="Move results up"
        >
          ▲
        </button>

        <button
          class="blue-button small-btn"
          @click="moveResultsDown()"
          title="Move results down"
        >
          ▼
        </button>
        <button class="blue-button small-btn" @click="removeResult"
          id="remove-results-button"
          title="Remove simulation results from list (and local storage)">
        🧹
        </button>
        <button class="blue-button small-btn" @click="showModalDownload = true"
          id="save-results-button"
          title="Save current simulation results">
        💾
        </button>
      </div>
    </div>
    <div class="table-container">
        <table class="results-table">
          <thead>
            <tr>
              <th style="width: 100px;"> Name  </th>
              <th style="width: 100px;"> Iters  </th>
              <th style="width: 100px;"> Instr  </th>
              <th style="width: 100px;"> Cycles </th>
              <th style="width: 100px;"> Cycles/iter </th>
              <th style="width: 100px;"> IPC    </th>
              <th style="width: 100px;" title="Primary cache misses (LOAD + STORE)"> Primary </th>
              <th style="width: 100px;" title="Secondary cache misses (LOAD + STORE)"> Secondary </th>
              <th style="width: 120px;" title="Main Memory transfers: Rd+Wr (% of cycles MM is busy)"> MM </th>
            </tr>
          </thead>
          <tbody v-if="simulationOptions.resultName">
            <tr v-for="(name, index) in simulationOptions.availableResults" :key="index">
              <td @mouseenter="showResultContext($event, index)" @mouseleave="hideResultContext"
                  @focusin="showResultContext($event, index)" @focusout="hideResultContext">
                <input type="text"
                  v-model="simulationOptions.availableResults[index]"
                  class="iters-group"
                  @focus="captureOldValue(index)"
                  @blur="renameResult(index)"
                />
              </td>
              <td title="Total loop iterations executed">
                {{ showResultsInfo[index]?.total_iterations?.toLocaleString() ?? 'X' }}
              </td>
              <td title="Total machine instructions executed">
                {{ showResultsInfo[index]?.total_instructions?.toLocaleString() ?? 'X' }}
              </td>
              <td title="Total clock cycles taken">
                {{ showResultsInfo[index]?.total_cycles?.toLocaleString() ?? 'X' }}
              </td>
              <td title="Cycles per loop iteration">
                {{ showResultsInfo[index]?.cycles_per_iteration?.toFixed(2) ?? 'X' }}
              </td>
              <td title="Instructions Per cycle (IPC)">
                {{ showResultsInfo[index]?.ipc?.toFixed(3) ?? 'X' }}
              </td>
              <td :title="storedMemoryColumns[index]?.primaryDetail || 'Primary cache misses'">
                {{ storedMemoryColumns[index]?.primary ?? 'X' }}
              </td>
              <td :title="storedMemoryColumns[index]?.secondaryDetail || 'Secondary cache misses'">
                {{ storedMemoryColumns[index]?.secondary ?? 'X' }}
              </td>
              <td title="Rd = MM reads for cache misses; Wr = writes of evicted dirty blocks; % = cycles in which MM is busy">
                {{ storedMemoryColumns[index]?.MM ?? 'X' }}
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

  <div v-if="showModalDownload" class="modal-overlay">
    <div class="modal">
      <h4>Save Results As</h4>
      <label for="results-name">Name:</label>
      <input v-model="modalName" type="text" id="save-results-name"
           title="file name of new simulation results" placeholder="Enter name for results"
        />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Accept Download" @click="confirmDownload"> Yes </button>
        <button class="blue-button" title="Cancel Download" @click="showModalDownload=false">  Cancel </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp1" :position="helpPosition"
    text="<strong>Simulate</strong> the execution of N/loop-stride loop iterations and view aggregate performance metrics,
      including the total number of executed <em>instructions</em>, total clock <em>cycles</em>, cycles <em>per loop iteration</em>,
      <em>Instructions Per Cycle</em> (IPC), <em>cache misses</em>, and <em>MM transfers</em>.
      Cache misses are shown as <em>LD+ST = Total</em>, where LD and ST are the misses caused by LOAD and
      STORE instructions. <em>Primary misses</em> start a new fill; <em>secondary misses</em> join an existing
      or queued fill of the same block.
      MM transfers are shown as <em>Rd+Wr = Total (%)</em>: Rd are reads of blocks for cache misses (including
      STORE read-for-write misses), Wr are writes of dirty blocks evicted from the cache, and the percentage is
      the fraction of total cycles in which Main Memory is busy.
      To obtain meaningful results, ensure a representative number of loop iterations, N, is selected,
      as very low iteration counts may not fully capture the program's behavior and performance characteristics.
      <p>The table below provides statistics of the utilization of core processor resources: dispatch and retire widths,
        and usage of execution ports and cache/MM hierarchy.
        These metrics are crucial for identifying potential performance bottlenecks in the simulated execution.</p>
    "
    title="Overall Simulation Results"
    @close="closeHelp1"/>
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp2" :position="helpPosition"
    text="Visualize the <strong>performance results</strong> from previous simulations.
      This list allows you to compare the current simulation results with those from previous runs,
      enabling you to track performance changes over time or after modifications to the processor configuration
      or program.
      <p><em>Primary</em> and <em>Secondary</em> show the total cache misses (hover a cell to see the LOAD/STORE split);
        <em>MM</em> shows Main Memory reads+writes and the percentage of cycles in which MM is busy.
        Hover a result's <strong>name</strong> to see the program, N and the complete processor configuration
        that produced it. New results are named <em>Program-Processor-N</em>.</p>
      <p>You can also manage your stored results by renaming them, reordering them for better comparison,
        saving them for later usage, or removing those that are no longer needed.</p>"
    title="Previous Performance Results"
    @close="closeHelp2"/>
  </Teleport>

</template>

<style scoped>

  .iters-run span {
    white-space: nowrap;
  }

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
    font-size:        medium;
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
    font-size:       clamp(9px, 1.6cqi, 16px);
  }

  .critical-path-pattern {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0 10px;
    padding: 8px 10px;
    border-left: 4px solid #d99000;
    background: #fff8e6;
    color: #242424;
    overflow-wrap: anywhere;
  }
  .critical-path-pattern p {
    margin: 0;
  }
  .critical-path-pattern small {
    color: #555;
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

  #IPC-output {
    font-weight: bold;
    padding: 0.1em 0.4em;
    border-radius: 4px;
    transition: all 0.3s ease;
    display: inline-block;
    min-width: 3.5em;
    text-align: center;
  }

  #IPC-output {
    cursor: help;
    position: relative;
  }

  #IPC-output:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    z-index: 1000;
    pointer-events: none;
  }

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

  .graph-section {
    display:         flex;
    justify-content: center;
    align-items:     center;
  }

  /* The SVG scales with its container: cap the width so the text keeps a normal size */
  .processor-img {
    width:        100%;
    max-width:    40rem;
    margin:       0 auto;
  }

  .processor-img svg text {
    font-size:   12px !important;
    font-family: Arial, sans-serif !important;
  }

  .processor-img svg polygon,
  .processor-img svg path {
    stroke-width: 2px !important;
  }

  .processor-container {
    width:     100%;
    height:    100%;
    display:   flex;
    margin-top: 2px;
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
    font-size:     12px;
    line-height:   1.4;
    white-space:   pre-wrap;
    overflow-wrap: anywhere;
    pointer-events: none;
  }

  .results-table {
    width:           100%;
    border-collapse: collapse;
    font-size:       small;
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
    font-size:      medium;
  }
  .results-table tbody tr:nth-child(even) {
    background: #f9f9f9;
  }
  .results-table tbody tr:hover {
    background: #e8f4fd;
  }

</style>
