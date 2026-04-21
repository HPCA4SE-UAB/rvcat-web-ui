<script setup>
  import { ref, toRaw, computed, onMounted, onUnmounted, onBeforeUnmount,
           nextTick, inject, watch, reactive }                       from "vue"
  import HelpComponent                    from '@/components/helpComponent.vue'
  import { useRVCAT_Api }                                     from '@/rvcatAPI'
  import { createGraphVizGraph, downloadJSON, uploadJSON,
           saveToLocalStorage, removeFromLocalStorage, initResource} from '@/common'

  const { getExecutionResults } = useRVCAT_Api();
  const { registerHandler }     = inject('worker');
  const simState                = inject('simulationState');

 /* ------------------------------------------------------------------
   * Simulation Results options (persistent in localStorage)
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'simulationOptions'
  const MAX_ITERS    = 2000

  const defaultOptions = {
    iters:            100,
    autorun:          false,
    availableResults: [],
    resultName:       ''
  }

  const simulationOptions = reactive(defaultOptions)

  const resultsSvg            = ref('')
  let   cleanupHandleResults  = null
  let   resultsTimeout        = null
  const showResultsInfo       = ref({})

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

/* ------------------------------------------------------------------
  * Simulation Results (persistent in localStorage)
  * ------------------------------------------------------------------ */
  let simResults = {}
  let simProcess = {}
  const isArray  = (arr) => Array.isArray(arr);

  const areInstructionsEqual = (instr1, instr2) => {
    if (instr1.latency !== instr2.latency)  return false;
    if (instr1.ports   !== instr2.ports)    return false;
    if (instr1.destin  !== instr2.destin)   return false;
    if (instr1.source1 !== instr2.source1)  return false;
    if (instr1.source2 !== instr2.source2)  return false;
    if (instr1.source3 !== instr2.source3)  return false;
    return true; // ✅ all are equal
  }

  const areProcessorsEqual = (proc1, proc2) => {
    if (proc1 == {} || proc2 == {}) return false
    if (proc1.dispatch !== proc2.dispatch) return false;
    if (proc1.retire !== proc2.retire)     return false;
    if (proc1.sched !== proc2.sched)       return false;
    if (proc1.ROBsize !== proc2.ROBsize)   return false;
    if (proc1.nBlocks !== proc2.nBlocks)   return false;
    if (proc1.nBlocks > 0) {
      if (proc1.blkSize    !== proc2.blkSize)    return false;
      if (proc1.mIssueTime !== proc2.mIssueTime) return false;
      if (proc1.mPenalty   !== proc2.mPenalty)   return false;
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
// INPUT VALIDATION: iterations field
// ============================================================================

  const inputValue   = ref('');
  const isInvalid    = ref(false);
  let   errorTimeout = null;

  const validateField = () => {
    const min = 1;
    const max = MAX_ITERS;
    let rawValue = inputValue.value;

    if (errorTimeout) clearTimeout(errorTimeout);

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      const lastValidValue = simulationOptions.iters;
      inputValue.value = lastValidValue ?? min;
      isInvalid.value = false;
      return;
    }

    let numValue = Number(rawValue);

    if (isNaN(numValue)) {
      const lastValidValue = simulationOptions.iters;
      inputValue.value = lastValidValue ?? min;
      isInvalid.value = false;
      return;
    }

    if (numValue < min) {
      numValue = min;
      inputValue.value = numValue;
      showTemporaryError(`Minimum is ${min}`);
    } else if (numValue > max) {
      numValue = max;
      inputValue.value = numValue;
      showTemporaryError(`Maximum is ${max}`);
    }

    if (simulationOptions.iters !== numValue) {
      simulationOptions.iters = numValue;
    }
  }

  const showTemporaryError = (message) => {
    isInvalid.value = true;
    errorTimeout = setTimeout(() => {
      isInvalid.value = false;
    }, 2000);
    console.warn(message);
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      event.target.blur();
    }
  };

  const handleInput = (event) => {
    if (isInvalid.value) {
      isInvalid.value = false;
    }
    let value = event.target.value;
    if (value !== '' && !/^\d*$/.test(value)) {
      event.target.value = value.replace(/\D/g, '');
      inputValue.value = event.target.value;
    }
  };

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================

  let unwatch            = null;
  let isComponentMounted = false;

  const updateResults= () => {
    if (simState.state >= 3 && simState.simulatedProcess) {
      const equalProcs = areProcessorsEqual(simState.simulatedProcess, simProcess)
      const equalIters = simResults.total_iterations == simulationOptions.iters
      if (equalProcs && equalIters) {
        if (simState.executionResults == null) simState.executionResults = simResults
        console.log('🕐✅ Same simulated proces && number of iterations: execution results are valid');
        drawProcessorResults();
      } else if (simulationOptions?.autorun) {
        console.log('🕐🔄 Something changed: re-running simulation', equalProcs, equalIters)
        reloadExecutionResults()
      } else {
        simState.executionResults = null; // Clear results to avoid showing outdated data
        resultsSvg.value = ''; // Clear graph
        console.log('🕐🧹 Process/Iterations changed but autorun is disabled: clear simulation results')
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

  const handleOptionsChange = (newVal, oldVal) => {
    // Verify that component is mounted and necessary data is available before executing the watch logic
    if (!isComponentMounted || !simulationOptions || !simState) {
      console.log('🕐 Component not ready, skipping watch execution')
      return
    }
    try {
      if (newVal.iters !== oldVal?.iters) {
        console.log('🕐🔄 Iterations changed:', newVal.iters);
        if (inputValue) inputValue.value = newVal.iters ?? '';
        if (typeof isInvalid !== 'undefined') isInvalid.value = false;
      }
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
          iters:        simulationOptions?.iters,
          autorun:      simulationOptions?.autorun,
          name:         simulationOptions?.resultName
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
      simResults = JSON.parse(data)
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

  function toggleAutorun()  { simulationOptions.autorun      = !simulationOptions.autorun }

  const formattedResults = computed(() => {
    const results = simState.executionResults || {};

    return {
      iters:        results["total_iterations"]?.toLocaleString() ?? 'X',
      instructions: results["total_instructions"]?.toLocaleString() ?? 'X',
      cycles:       results["total_cycles"]?.toLocaleString() ?? 'X',
      cpi:          results["cycles_per_iteration"]?.toFixed(2) ?? 'X',
      ipc:          results["ipc"]?.toFixed(3) ?? 'X',
      loads:        results["total_loads"]?.toLocaleString() ?? 'X'
    };
  });

  let iterControl = {
    lastTime:  0,
    direction: null, // 'up' | 'down'
    stepLevel: 0,    // 0:1, 1:10, 2:100, 3:1000
    streak:    0
  };

  const STEP_VALUES     = [1, 10, 100];
  const FAST_THRESHOLD  = 300;  // ms → considera "rápido"
  const RESET_THRESHOLD = 1200; // ms → reinicia velocidad

  function getStep(direction) {
    const now = Date.now();

    // Si pasa mucho tiempo → reset
    if (now - iterControl.lastTime > RESET_THRESHOLD) {
      iterControl.stepLevel = 0;
      iterControl.streak    = 0;
    }

    // Si cambia la dirección → reset parcial
    if (iterControl.direction !== direction) {
      iterControl.stepLevel = 0;
      iterControl.streak    = 0;
      iterControl.direction = direction;
    }

    // Si es rápido → aumentar racha
    if (now - iterControl.lastTime < FAST_THRESHOLD) {
      iterControl.streak++;
    } else {
      iterControl.streak = 0;
    }

    // Increase step level every 6 rapid repetitions
    if (iterControl.streak >= 6 && iterControl.stepLevel < STEP_VALUES.length - 1) {
      iterControl.stepLevel++;
      iterControl.streak = 0; // reset para siguiente escalado
    }

    iterControl.lastTime = now;

    return STEP_VALUES[iterControl.stepLevel];
  }

  function roundToStep(value, step, direction) {
    if (direction === 'up') {
      return Math.ceil(value / step) * step;
    } else {
      return Math.floor(value / step) * step;
    }
  }

  function increaseIterations() {
    const step   = getStep('up')
    let newValue = simulationOptions.iters + step
    if (step > 1) newValue = roundToStep(newValue, step, 'up')
    simulationOptions.iters = Math.min(newValue, MAX_ITERS)
  }

  function decreaseIterations() {
    const step   = getStep('down')
    if (simulationOptions.iters < step*2) {
      if (iterControl.stepLevel > 0) {
        iterControl.stepLevel--;
        iterControl.streak = -10000; // disable scaling
        step = STEP_VALUES[iterControl.stepLevel];
      }
    }
    let newValue = simulationOptions.iters - step
    if (step > 1) newValue = roundToStep(newValue, step, 'down')
    simulationOptions.iters = Math.max(newValue, 1)
  }


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

  const reloadExecutionResults = async () => {
    simProcess = {
      dispatch: simState.simulatedProcess.dispatch,
      retire:   simState.simulatedProcess.retire,
      sched:    simState.simulatedProcess.sched,
      ROBsize:  simState.simulatedProcess.ROBsize,
      nBlocks:  simState.simulatedProcess.nBlocks,
      blkSize:  simState.simulatedProcess.blkSize,
      mIssueTime: simState.simulatedProcess.mIssueTime,
      mPenalty: simState.simulatedProcess.mPenalty,
      instruction_list: JSON.parse(JSON.stringify(simState.simulatedProcess.instruction_list))
    }
    clearTimeout(resultsTimeout)
    try {
      resultsTimeout = setTimeout(() => {
        document.getElementById('run-simulation-spinner').style.display = 'block';
        document.getElementById('simulation-running').style.display     = 'block';
        document.getElementById('run-simulation-button').disabled       = true;
        resultsSvg.value = `<div class="error">Waiting to generate simulation results graph</div>`;

        const { ROBsize, dispatch, retire, sched, blksize, nBlocks, mPenalty, mIssueTime, instruction_list } = simState.simulatedProcess
        getExecutionResults(JSON.stringify( { ROBsize, dispatch, retire, sched, blksize, nBlocks, mPenalty, mIssueTime,
                                              instruction_list: toRaw(instruction_list)}, null, 2),
                            simulationOptions.iters) // Call Python RVCAT
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
      <TD ROWSPAN="3" BGCOLOR="#f0f0f0" HREF="#" ID="rob" TITLE="Pending: usage of ROB capacity" ALIGN="CENTER" VALIGN="MIDDLE"><FONT POINT-SIZE="20"><B>ROB</B><BR/>${ROBsize}</FONT><BR/><FONT POINT-SIZE="16">entries</FONT></TD>
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

    // ---- Registers & Retire ----
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
        let   baseName = 'current';
        let   name = baseName;
        let   counter = 1;
        while (simulationOptions.availableResults.includes(name)) {
          name = `${baseName} (${counter})`;
          counter++;
        }
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

/* ------------------------------------------------------------------
 * Button Support: press & hold
 * ------------------------------------------------------------------ */
  let holdTimeout = null;
  let holdInterval= null;
  let savedAutorun = false;

  function startHold(action) {
    const INITIAL_DELAY = 400;   // tiempo hasta que empieza la repetición
    const REPEAT_INTERVAL = 250; // velocidad de repetición

    savedAutorun = simulationOptions.autorun; // save autorun state to restore later
    simulationOptions.autorun = false; // disable autorun while manually changing iterations
    action()    // first click

    // wait until repetition
    holdTimeout = setTimeout(() => {
      holdInterval = setInterval(() => {
        action();
      }, REPEAT_INTERVAL);
    }, INITIAL_DELAY);
  }

  function stopHold() {
    clearTimeout(holdTimeout);
    clearInterval(holdInterval);
    simulationOptions.autorun = savedAutorun; // restore autorun state after manual change
  }

</script>

<template>
  <div class="main">
    <div class="header">
      <div class="section-title-and-info">
        <span ref="helpIcon1" class="info-icon" @click="openHelp1" title="Show help">
           <img src="/img/info.png" class="info-img">
        </span>
        <span class="header-title">Simulate Execution of {{ simState.programName }} on {{ simState.processorName }}</span>
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

        <div class="iters-group">
          <span class="iters-label" :title="`Rang: 1 - ${MAX_ITERS} iters`">
            Iterations:
          </span>
          <input
            type=      "text"
            inputmode= "numeric"
            pattern=   "[0-9]*"
            :placeholder="100"
            v-model=  "inputValue"
            @blur=    "validateField"
            @keypress="handleKeyPress"
            @input=   "handleInput"
            id=       "simulation-iterations"
            :class=   "{ 'invalid': isInvalid }"
            :title=   "`Rang: 1 - ${MAX_ITERS} iters`"
          />
          <button
            class="blue-button small-btn"
            @mousedown="startHold(increaseIterations)"
            @mouseup="stopHold"
            @mouseleave="stopHold"
            @touchstart.prevent="startHold(increaseIterations)"
            @touchend="stopHold"
            title="Increase iterations (press and hold for faster incrementing)"
          >
            ▲
          </button>

          <button
            class="blue-button small-btn"
            @mousedown="startHold(decreaseIterations)"
            @mouseup="stopHold"
            @mouseleave="stopHold"
            @touchstart.prevent="startHold(decreaseIterations)"
            @touchend="stopHold"
            title="Decrease iterations (press and hold for faster decrementing)"
          >
            ▼
          </button>
        </div>
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
          <label for="cycles-per-iteration">Cycles/iteration:</label>
          <span id="cycles-per-iteration-output" title="Clock cycles per loop iteration">{{ formattedResults.cpi }}</span>
        </div>
      </div>
      <div class="row">
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
        <div class="simulation-inline-item">
          <label for="Loads">Loads:</label>
          <span id="Loads-output" title="Total executed LOADs">{{ formattedResults.loads }}</span>
        </div>
      </div>
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
              <th style="width: 100px;"> C/iter </th>
              <th style="width: 100px;"> IPC    </th>
            </tr>
          </thead>
          <tbody v-if="simulationOptions.resultName">
            <tr v-for="(name, index) in simulationOptions.availableResults" :key="index">
              <td title="Name of the stored results">
                <input type="text"
                  v-model="simulationOptions.availableResults[index]"
                  class="iters-group"
                  title="Modify File Name if required"
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
                {{ showResultsInfo[index]?.cycles_per_iteration?.toLocaleString() ?? 'X' }}
              </td>
              <td title="Instructions Per cycle (IPC)">
                {{ showResultsInfo[index]?.ipc?.toLocaleString() ?? 'X' }}
              </td>
            </tr>
          </tbody>
        </table>
    </div>
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
    text="<strong>Simulate</strong> the execution of a specified number of program loop iterations and view aggregate performance metrics,
      including the total number of executed <em>instructions</em>, total clock <em>cycles</em>, cycles <em>per loop iteration</em>,
      and <em>Instructions Per Cycle</em> (IPC). To obtain meaningful results, ensure a representative number of loop iterations is selected,
      as very low iteration counts may not fully capture the program's behavior and performance characteristics.
      <p>The table below provides statistics of the utilization of core processor resources: dispatch and retire widths, and usage of execution ports.
        These metrics are crucial for identifying potential performance bottlenecks in the simulated execution.</p>
    "
    title="Overall Simulation Results"
    @close="closeHelp1"/>
  </Teleport>

  <Teleport to="body">
    <HelpComponent v-if="showHelp2" :position="helpPosition"
    text="Visualize the <strong>performance results</strong> from previous simulations.
      This table allows you to compare the current simulation results with those from previous runs,
      enabling you to track performance changes over time or after modifications to the processor configuration
      or program.
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

  .iters-group .iters-label {
    white-space: nowrap;
  }

  .iters-group input {
    width:         70px;
    border:        1px solid #ccc;
    border-radius: 4px;
    text-align:    center;
    transition:    all 0.2s ease;
  }

  .iters-group input:focus {
    outline:       none;
    border-color: #4a90e2;
    box-shadow:    0 0 0 2px rgba(74, 144, 226, 0.2);
  }

  .iters-group input.invalid {
    border-color: #ff4444;
    background-color: #fff0f0;
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
    font-size:   16px;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  .results-info .row {
    display:         flex;
    gap:             5px;
    margin-bottom:   8px;
    flex-wrap:       wrap;
    justify-content: space-between;
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
    margin-right: 10px;
    font-weight:  600;
    color:       #333;
    font-size:    1.2em;
  }
  .simulation-inline-item span {
    text-align:  right;
    flex-shrink: 0;
    font-weight: bold;
    font-size:   1.1em;
    transition:  color 0.3s ease;
  }

  #IPC-output {
    font-weight: bold;
    font-size: 1.2em;
    padding: 2px 6px;
    border-radius: 4px;
    transition: all 0.3s ease;
    display: inline-block;
    min-width: 60px;
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

  .processor-img {
    width:        100%;
    height:       100%;
    max-width:    150%;
    max-height:   150%;
    align-items:  center;
    object-fit:   contain;
    transform-box: fill-box;
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
