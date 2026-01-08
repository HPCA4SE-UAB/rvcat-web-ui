///////////////////////////////////////////////////////////////////////
/////////// Functions calling PYTHON RVCAT  ///////////////////////////
///////////////////////////////////////////////////////////////////////

function readPythonProgramsAndProcessors() {
  executeCode('import rvcat; rvcat.files.list_json(False)',  'get_programs'  );
  executeCode('import rvcat; rvcat.files.list_json(True)',   'get_processors');
}

function programShow() {
    let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
    res +=    'rvcat._scheduler.init(100, 10); rvcat._program.show_code()'
    executeCode( res, 'program_show' )
}

function getProcessorInformation() {
    let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
    res +=    'rvcat._scheduler.init(100, 10); rvcat._processor.json()'
    executeCode( res, 'processor_show' )
}

function getSchedulerAnalysis() {
    // showProcessor();

    document.getElementById('instructions-output').innerHTML = '?';
    document.getElementById('cycles-output').innerHTML       = '?';
    document.getElementById('IPC-output').innerHTML          = '?';
    document.getElementById('cycles-per-iteration-output').innerHTML = '?';

    document.getElementById('run-simulation-spinner').style.display = 'block';
    document.getElementById('simulation-running').style.display     = 'block';
    document.getElementById('graph-section').style.display          = 'none';
    document.getElementById('critical-path-section').style.display  = 'none';
    document.getElementById('run-simulation-button').disabled       = true;

    let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
    res +=    'rvcat._scheduler.init(100, 10); rvcat._scheduler.format_analysis_json()'
    executeCode( res, 'generate_simulation_results' )
    );
}

function reloadRvcat() {
    programShow();
    getProcessorInformation();
}

function programShowPerformanceLimits() {
    let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
    res +=    'rvcat._program.show_performance_analysis()'
    executeCode( res, 'prog_show_performance' )
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
  
    let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
    res +=    `rvcat._program.show_graphviz(${n}, ${internal}, ${latency}, ${small}, ${full})`
    executeCode( res, 'generate_critical_paths_graph' )
    lastExecutedCommand = showCriticalPathsGraph;
}

async function getTimeline(num_iters) {
    let controls = document.getElementById('dependencies-controls');
    controls.style.display = 'block';

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

      let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
      res +=    'rvcat._scheduler.init(100, 10);'
      res +=    `rvcat._scheduler.format_timeline(niters=${num_iters})`
      executeCode( res, 'format_timeline');
      lastExecutedCommand = getTimeline;
    });
}

async function getProcessorJSON() {
   let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
   res +=    'rvcat._scheduler.init(100, 10); rvcat._processor.json()'
   await executeCode( res, 'get_proc_settings' )
   return processorInfo;
}

async function saveModifiedProcessor(config) {
   let res = 'import rvcat; rvcat._processor.load("base1"); rvcat._program.load("baseline");'
   res +=    'rvcat._scheduler.init(100, 10); rvcat._processor.save(${JSON.stringify(config)})`
   await executeCode( res, 'save_modified_processor' )
   await executeCode('import rvcat; rvcat.files.list_json(True)', 'get_processors')
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
  const payload = typeof config === 'string' ? JSON.parse(config) : config;
  await executeCode(
    RVCAT_HEADER() + addNewProgram(payload),
    'add_new_program'
  );
  await executeCode(GET_AVAIL_PROGRAMS, 'get_programs');
}


function programShowMemtrace() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_MEMORY,
        'print_output'
    )
    lastExecutedCommand = programShowMemtrace;
}


/*********************************************************
 *  MAIN Simulation Model STATE
 *************************************************************/

// Save the last executed command to be able to re-run it when the selected program changes
var lastExecutedCommand = null;
var processorInfo       = null;
var timelineData        = null;
var programData         = null;

const MAX_PROGRAM_ITERATIONS = 2000;
const MAX_ROB_SIZE           =  500;

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

/*
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
} */


/*********************************************************
 *  Message Handling from Pyodide Worker
 *************************************************************/
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
  
    'program_show': (data) => {
      const item       = document.getElementById('rvcat-asm-code');
      item.textContent = data;
      if (lastExecutedCommand !== null) {
        lastExecutedCommand();
      }
    },
  
    'processor_show': (data) => {
        processorInfo = JSON.parse(data);
        showProcessor();
        // getSchedulerAnalysis();
    },

    'generate_simulation_results': (data) => {
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
        usage['retire']   = (d["ipc"] / processorInfo.stages.retire)   * 100;
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
 
    'prog_show_performance': (data) => {
      let item         = document.getElementById('performance-limits');
      item.textContent = data;
    },
      
    'generate_critical_paths_graph': (data) => {
        let item = document.getElementById('dependence-graph');
        item.innerHTML = '';
        createGraphVizGraph(data, item);
    },
 
    'format_timeline': (data) => {
      timelineData = data;
    },

    'get_proc_settings': (data) => {
      processorInfo = JSON.parse(data);
    },
  
    'save_modified_processor': (data) => {
      console.log("Processor settings saved");
    },
  
    'get_program_json': (data) => {
      programData = JSON.parse(data);
    },
  
    'add_new_program': (data) => {
      console.log("New program saved");
    },
  
    'print_output': (data) => {
        let out = data.replace(/\n/g, '<br>');
        console.log(out);
    }
}

////////////////////////////////////////
////  Helping functions  ///////////////
////////////////////////////////////////

function createGraphVizGraph(dotCode, targetElement, callback = null) {
  const viz = new Viz()
  
  viz.renderSVGElement(dotCode, { engine: "dot" })
    .then(svg => {
      // Clear container
      targetElement.innerHTML = ''

      // 🔧 Make SVG responsive
      const width  = svg.getAttribute("width")
      const height = svg.getAttribute("height")

      if (!svg.getAttribute("viewBox") && width && height) {
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
      }

      svg.removeAttribute("width")
      svg.removeAttribute("height")

      svg.style.width  = "100%"
      svg.style.height = "100%"
      svg.style.maxWidth = "100%"
      svg.style.maxHeight = "100%"
      svg.style.display = "block"

      targetElement.appendChild(svg)

      if (callback) callback()
    })
    .catch(error => {
      console.error("Error rendering graph:", error)
    })
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
         <div style="width:100%; text-align:center;">
            ${label}    &nbsp; <···············································>   &nbsp  <b>${percentage.toFixed(1)}%</b> 
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

// UI stuff
function openLoadingOverlay() { 
  document.getElementById('loading-overlay').style.display   = 'block';
  document.getElementById('blur-overlay-item').style.display = 'block';
}

function closeLoadingOverlay() {
    document.getElementById('loading-overlay').style.display   = 'none';
    document.getElementById('blur-overlay-item').style.display = 'none';
}

function setLoadingOverlayMessage(message) {
    document.getElementById('loading-overlay-message').innerHTML = message;
}

// WORKER definition 
/* Typical Usage Flow:
 1. Main thread creates worker: new Worker('worker.js')
 2. Main thread sends {action: 'initialize'}
 3. Worker initializes Pyodide, responds {action: 'initialized'}
 4. Main thread sends {action: 'execute', code: 'print("Hello")', id: 1}
 5. Worker runs Python, sends back result or error
 6. Main thread receives response and handles it based on id and data_type
 */
const worker     = new Worker('./worker.js');
worker.onmessage = function(message) {
    console.log('Message received from worker', message);
    if (message.data.action === 'initialized') {
      readPythonProgramsAndProcessors();
    }
    if (message.data.action === 'loadedPackage') {
      // Handles confirmation when packages are loaded
      // Could be extended to trigger dependent actions
    }
    if (message.data.action === 'executed') {
        if (message.data.data_type == 'error') {
            console.log('Error executing Python code:', message.data.result);
            return;
        }
        data = message.data.result;
        if (message.data.id !== undefined) {
          handlers[message.data.id](data);
        } 
        // else { }  // No handler specified
    }
}

// Pyodide stuff
function initPyodide() {  // Main thread sends initialization request
    setLoadingOverlayMessage('Loading RVCAT');
    worker.postMessage({action: 'initialize'});
}

async function executeCode(code, id=undefined){
    console.log('Executing code:\n', code);
    worker.postMessage({action: 'execute', code: code, id: id});
}
