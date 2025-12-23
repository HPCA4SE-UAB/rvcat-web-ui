// Save the last executed command to be able to re-run it when the selected program change
var lastExecutedCommand = null;
var processorInfo       = null;
var timelineData        = null;
var programData         = null;

const MAX_PROGRAM_ITERATIONS = 2000;
const MAX_ROB_SIZE           =  500;

const handlers = {
    'get_programs': (data) => {
        let programs = JSON.parse(data);
        document.getElementById('programs-list').innerHTML="";
        for (let program of programs) {
            let option       = document.createElement('option');
            option.value     = program;
            option.innerHTML = program;
            document.getElementById('programs-list').appendChild(option);
        }
    },
  
    'get_processors': (data) => {
        let processors = JSON.parse(data);
        document.getElementById('processors-list').innerHTML='';
        for (let processor of processors) {
            let option       = document.createElement('option');
            option.value     = processor;
            option.innerHTML = processor;
            document.getElementById('processors-list').appendChild(option);
        }
        // Once the processors and programs are loaded show the program in the UI
        reloadRvcat();
        closeLoadingOverlay();
    },
  
    'prog_show': (data) => {
      const item       = document.getElementById('rvcat-asm-code');
      item.textContent = data;
      if (lastExecutedCommand !== null) {
        lastExecutedCommand();
      }
    },
  
    'prog_show_performance': (data) => {
      let item         = document.getElementById('performance-limits');
      item.textContent = data;
    },
  
    'get_proc_settings': (data) => {
      processorInfo = JSON.parse(data);
    },
  
    'save_processor_info': (data) => {
        processorInfo = JSON.parse(data);
        getSchedulerAnalysis();
    },
   
    'generate_critical_paths_graph': (data) => {
        let item = document.getElementById('dependence-graph');
        item.innerHTML = '';
        createGraphVizGraph(data, item);
    },
  
    'generate_scheduler_analysis': (data) => {
        let d = JSON.parse(data);
        if (d['data_type'] === 'error') {
            alert('Error running simulation');
            document.getElementById('run-simulation-spinner').style.display = 'none';
            document.getElementById('simulation-running').style.display     = 'none';
            document.getElementById('graph-section').style.display          = 'block';
            document.getElementById('critical-path-section').style.display  = 'block';
            document.getElementById('run-simulation-button').disabled       = false;
            return;
        }

        document.getElementById('instructions-output').innerHTML = d["total_instructions"];
        document.getElementById('cycles-output').innerHTML       = d["total_cycles"];
        document.getElementById('IPC-output').innerHTML          = d["ipc"].toFixed(2);
        document.getElementById('cycles-per-iteration-output').innerHTML = d["cycles_per_iteration"].toFixed(2);
        document.getElementById('critical-path').innerHTML       = createCriticalPathList(d['critical_path']);
      
        usage = {}
        usage['dispatch'] = (d["ipc"] / processorInfo.stages.dispatch) * 100;
        usage['retire']   = (d["ipc"] / processorInfo.stages.retire) * 100;
        usage.ports       = {}
        let i = 0;
        let keys = Object.keys(processorInfo.ports);
        for (let key of keys) {
            usage.ports[i] = d.ports[key];
            i++;
        }
        createProcessorSimulationGraph(processorInfo.stages.dispatch, Object.keys(processorInfo.ports).length, processorInfo.stages.retire, usage);

        document.getElementById('run-simulation-spinner').style.display = 'none';
        document.getElementById('simulation-running').style.display     = 'none';
        document.getElementById('graph-section').style.display          = 'block';
        document.getElementById('critical-path-section').style.display  = 'block';
        document.getElementById('run-simulation-button').disabled       = false;
    },
  
    'format_timeline': (data) => {
      timelineData = data;
    },
  
    'print_output': (data) => {
        let out = data.replace(/\n/g, '<br>');
        console.log(out);
    },
  
    'save_modified_processor': (data) => {
      console.log("Processor settings saved");
    },
  
    'get_program_json': (data) => {
      programData = JSON.parse(data);
    },
  
    'add_new_program': (data) => {
      console.log("New program saved");
    }
}

const worker     = new Worker('./worker.js');
worker.onmessage = function(message) {
    console.log('Message received from worker', message);
    if (message.data.action === 'initialized') {
        executeCode(GET_AVAIL_PROGRAMS,   'get_programs');
        executeCode(GET_AVAIL_PROCESSORS, 'get_processors');
    }
    if (message.data.action === 'loadedPackage') {
    }
    if (message.data.action === 'executed') {
        if (message.data.data_type == 'error') {
            console.log('Error:', message.data.result);
            return;
        }
        data = message.data.result;
        if (message.data.id !== undefined) {
            if (message.data.id !== undefined) {
                handlers[message.data.id](data);
            } else {
            }
        }
    }
}

// Get selected values (program, processor... etc)
function currentProgram() {
    let p = document.getElementById('programs-list').value;
    return p;
}

function currentProcessor() {
    let p = document.getElementById('processors-list').value;
    return p;
}

function currentIterations() {
  if (document.getElementById("num-iters")){
    let elem = document.getElementById('num-iters');
    let i = elem.value;
    if (i === '') {
        elem.value = 100;
    }
    if (i > MAX_PROGRAM_ITERATIONS) {
        elem.value = MAX_PROGRAM_ITERATIONS;
    }
    return elem.value;
  }
  else {
    return 200;
  }
}

function currentROBSize() {
  if (document.getElementById("rob-size")){
    let elem = document.getElementById('rob-size');
    let rs = elem.value;
    if (rs === '') {
        elem.value = rs;
    }
    if (rs > MAX_ROB_SIZE) {
        elem.value = rs;
    }
    return elem.value;
  }
  else {
    return 100;
  }
}

// Commands
function reloadRvcat() {
    programShow();
    getProcessorInformation();
}

function programShow() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_EXECUTION,
        'prog_show'
    )
}

function programShowPerformanceLimits() {
  executeCode(
    RVCAT_HEADER() + PROG_SHOW_STATIC_PERFORMANCE,
    'prog_show_performance'
  )
}

function programShowMemtrace() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_MEMORY,
        'print_output'
    )
    lastExecutedCommand = programShowMemtrace;
}

async function getProcessorJSON() {
  await executeCode(
    RVCAT_HEADER() + SHOW_PROCESSOR,
    'get_proc_settings'
  )
  return processorInfo;
}

function getProcessorInformation() {
    executeCode(
        RVCAT_HEADER() + SHOW_PROCESSOR,
        'save_processor_info'
    )
}

// Pyodide stuff
function initPyodide() {
    setLoadingOverlayMessage('Loading RVCAT');
    worker.postMessage({action: 'initialize'});
}

async function executeCode(code, id=undefined){
    console.log('Executing code:\n', code);
    worker.postMessage({action: 'execute', code: code, id: id});
}

// UI stuff
function openLoadingOverlay() { 
  document.getElementById('loading-overlay').style.display  = 'block';
  document.getElementById('blur-overlay-item').style.display = 'block';
}

function closeLoadingOverlay() {
    document.getElementById('loading-overlay').style.display   = 'none';
    document.getElementById('blur-overlay-item').style.display = 'none';
}

function setLoadingOverlayMessage(message) {
    document.getElementById('loading-overlay-message').innerHTML = message;
}

function createGraphVizGraph(dotCode, targetElement, callback=null) {
  // Create an instance of Viz.js
  const viz = new Viz();

  // Render the graph
  viz.renderSVGElement(dotCode, { engine: "dot" })
    .then(function(element) {
        // Append the SVG element to the container
        // Remove any existing SVG elements
        targetElement.innerHTML = '';
        targetElement.appendChild(element);

        if (callback !== null) {
            callback();
        }
    })
    .catch(error => {
        // Handle any errors
        console.error("Error rendering graph:", error);
    });
}

function createProcessorGraph(dispatch, execute, retire, cache) {
    const dotCode = construct_reduced_processor_dot(dispatch, execute, retire, cache);
    createGraphVizGraph(dotCode, document.getElementById('pipeline-graph'));
}

let fullGraphDotCode;

function createProcessorSimulationGraph(dispatch, execute, retire, usage=null) {
  fullGraphDotCode = construct_full_processor_dot(dispatch, execute, retire, usage);
  createGraphVizGraph(fullGraphDotCode, document.getElementById('simulation-graph'));
}

function showFullProcessor(){
  createGraphVizGraph(fullGraphDotCode, document.getElementById('simulation-graph'));
}

function showProcessor() {
    if (processorInfo === null) {
        return;
    }
    let dispatch_width = processorInfo.stages.dispatch;
    let num_ports      = Object.keys(processorInfo.ports).length;
    let retire_width   = processorInfo.stages.retire;
    let cache = {'nBlocks':    processorInfo.nBlocks,
                 'blkSize':    processorInfo.blkSize,
                 'mPenalty':   processorInfo.mPenalty,
                 'mIssueTime': processorInfo.mIssueTime};
    createProcessorGraph(dispatch_width, num_ports, retire_width, cache);
}

function showCriticalPathsGraph(n,i,l,s,f) {
    let internal = "True";
    let latency  = "True";
    let small    = "True";
    let full     = "True";
    if (!i) {internal = "False"}
    if (!l) {latency  = "False"}
    if (!s) {small    = "False"}
    if (!f) {full     = "False"}
    executeCode(
        RVCAT_HEADER() + get_graph(n, internal, latency, small, full),
        'generate_critical_paths_graph'
    )
    lastExecutedCommand = showCriticalPathsGraph;
}

function getSchedulerAnalysis() {
    showProcessor();

    document.getElementById('instructions-output').innerHTML = '?';
    document.getElementById('cycles-output').innerHTML       = '?';
    document.getElementById('IPC-output').innerHTML          = '?';
    document.getElementById('cycles-per-iteration-output').innerHTML = '?';

    document.getElementById('run-simulation-spinner').style.display = 'block';
    document.getElementById('simulation-running').style.display     = 'block';
    document.getElementById('graph-section').style.display          = 'none';
    document.getElementById('critical-path-section').style.display  = 'none';
    document.getElementById('run-simulation-button').disabled       = true;
    executeCode(
        RVCAT_HEADER() + RUN_PROGRAM_ANALYSIS,
        'generate_scheduler_analysis'
    );
}

async function getTimeline() {
    let controls = document.getElementById('dependencies-controls');
    controls.style.display = 'block';
    let num_iters = document.getElementById('dependencies-num-iters').value;
    if (num_iters === '') {
        num_iters = 3;
    }
    if (num_iters > 50) {
        num_iters = 50;
        document.getElementById('dependencies-num-iters').value = 50;
    }

    return new Promise((resolve, reject)=>{
      const original = handlers['format_timeline'];

      handlers['format_timeline'] = (data) => {
        try {
          timelineData = data;
          resolve(data);
        } catch (err) {
          reject(err);
        } finally {
          // restore the old handler
          handlers['format_timeline'] = original;
        }
      };

      // fire off the code to the worker
      executeCode(
        RVCAT_HEADER() + show_timeline(num_iters), 
        'format_timeline'
      );
      lastExecutedCommand = getTimeline;
    });
}

async function saveModifiedProcessor(config) {
  await executeCode(
    RVCAT_HEADER() + addModifiedProcessor(config),
    'save_modified_processor'
  );
  await executeCode(GET_AVAIL_PROCESSORS, 'get_processors');
}

async function getProgramJSON(){
  return new Promise((resolve, reject) => {
    // Temporarily override the handler for this one request:
    const original = handlers['get_program_json'];

    handlers['get_program_json'] = (data) => {
      try {
        const obj = JSON.parse(data);
        programData = obj;
        resolve(obj);
      } catch (err) {
        reject(err);
      } finally {
        // restore the old handler
        handlers['get_program_json'] = original;
      }
    };

    // fire off the code to the worker
    executeCode(GET_PROGRAM_JSON, 'get_program_json');
  });
}

async function saveNewProgram(config) {
  await executeCode(
    RVCAT_HEADER() + addNewProgram(config),
    'add_new_program'
  );
  await executeCode(GET_AVAIL_PROGRAMS, 'get_programs');
}

async function showCellInfo(instrID, cycle) {
  //TO DO: Create Python function that returs additional info
  return 'TO DO'
}

function createCriticalPathList(data) {
  const COLORS = [
    "#ffffff", "#fff3f3", "#ffe7e7", "#ffdbdb", "#ffcece", "#ffc2c2",
    "#ffb6b6", "#ffaaaa", "#ff9e9e", "#ff9292", "#ff8686", "#ff7979",
    "#ff6d6d", "#ff6161", "#ff5555", "#ff4949", "#ff3d3d", "#ff3131",
    "#ff2424", "#ff1818", "#ff0c0c", "#ff0000"
  ]

  const baseStyle = `
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         2px;
    border-top:      1px solid black;
    border-left:     1px solid black;
    border-right:    1px solid black;
    box-sizing:      border-box;
  `
  const getColor = (p) =>
    p && p !== 0 ? COLORS[Math.floor(p / 5)] : "white"

  const row = (label, percentage, isLast = false) => `
    <li style="background-color:${getColor(percentage)}; list-style:none; margin:0; padding:0">
      <div style="${baseStyle}${isLast ? "border-bottom:1px solid black;" : ""}">
         <div style="min-width:3ch; text-align:right;">
           <b>${percentage.toFixed(1)}%</b>
        </div>
        <div style="margin-left:0.5rem;">
           ${label}
        </div>
      </div>
    </li>
  `
  let out = "<list>"

  // DISPATCH
  out += row("DISPATCH", data.dispatch)

  // INSTRUCTIONS
  out += data.instructions
    .map(i => row(i.instruction, i.percentage))
    .join("")

  // RETIRE
  out += row("RETIRE", data.retire, true)

  out += "</list>"
  return out
}
