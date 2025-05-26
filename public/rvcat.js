// Save the last executed command to be able to re-run it when the selected program change
var lastExecutedCommand = null;
var processorInfo = null;
var timelineData = null;
var programData = null;

const MAX_PROGRAM_ITERATIONS = 3000;
const MAX_ROB_SIZE = 500;

const handlers = {
    'get_programs': (data) => {
        let programs = JSON.parse(data);
        // TODO: Check for errors ?
        for (let program of programs) {
            let option = document.createElement('option');
            option.value = program;
            option.innerHTML = program;
            document.getElementById('programs-list').appendChild(option);
        }
    },
    'get_processors': (data) => {
        let processors = JSON.parse(data);
        document.getElementById('processors-list').innerHTML='';
        // TODO: Check for errors ?
        for (let processor of processors) {
            let option = document.createElement('option');
            option.value = processor;
            option.innerHTML = processor;
            document.getElementById('processors-list').appendChild(option);
        }
        // Once the processors and programs are loaded show the program in the UI
        programShow();
        getProcessorInformation();
        closeLoadingOverlay();
    },
    'prog_show': (data) => {
      let array = data.split("Through");
      let prog = array[0];

      // Split into lines
      let lines = prog.split("\n");

      // Remove leading/trailing empty lines
      while (lines.length && lines[0].trim() === "") lines.shift();
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

      // Detect common leading indentation (tabs or spaces)
      const nonEmptyLines = lines.filter(line => line.trim() !== "");
      const leadingIndents = nonEmptyLines.map(line => {
        const match = line.match(/^(\s*)/);
        return match ? match[1] : "";
      });

      // Get the smallest shared indent
      const minIndentLength = Math.min(...leadingIndents.map(indent => indent.length));
      const cleanedLines = lines.map(line =>
        line.startsWith(" ") || line.startsWith("\t")
          ? line.slice(minIndentLength)
          : line
      );

      // Join cleaned lines
      const cleanedProg = cleanedLines.join("\n");

      const item = document.getElementById('rvcat-asm-code');
      item.textContent = cleanedProg;

      if (lastExecutedCommand !== null) {
        lastExecutedCommand();
      }
    },
    'prog_show_annotations': (data) => {

      let array=data.split("Through");
      let annotations = "Through"+array[1];
      let item = document.getElementById('performance-annotations');
      item.textContent = annotations;
    },
    'get_proc_settings': (data) => {
        processorInfo = JSON.parse(data);
    },
    'save_processor_info': (data) => {
        let procinfo = JSON.parse(data);
        processorInfo = procinfo;
        showProcessor();
        getSchedulerAnalysis();
    },
    'generate_dependencies_graph': (data) => {
        let item = document.getElementById('simulation-output');
        item.innerHTML = '';
        // get svg element
        let callback = () => {
            return;
        }
        createGraphVizGraph(data, item, callback);

    },
    'generate_critical_paths_graph': (data) => {
        let item = document.getElementById('simulation-output');
        item.innerHTML = '';
        createGraphVizGraph(data, item);

    },
    'generate_scheduler_analysis': (data) => {
        /*
        {"total_iterations": 10, "total_instructions": 90, "total_cycles": 91,
        "ipc": 0.989010989010989, "cycles_per_iteration": 9.1, "critical_path":
        {"instructions": [{"instruction": 0, "percentage": 4.395604395604396},
        {"instruction": 1, "percentage": 19.78021978021978}, {"instruction": 2,
        "percentage": 4.395604395604396}, {"instruction": 3, "percentage":
        21.978021978021978}, {"instruction": 4, "percentage":
        43.956043956043956}, {"instruction": 5, "percentage":
        3.2967032967032965}, {"instruction": 6, "percentage": 0.0},
        {"instruction": 7, "percentage": 0.0}, {"instruction": 8, "percentage":
        0.0}], "dispatch": 1.098901098901099, "retire": 1.098901098901099}}
        */
        let d = JSON.parse(data);
        if (d['data_type'] === 'error') {
            alert('Error running simulation');
            document.getElementById('run-simulation-spinner').style.display = 'none';
            document.getElementById('simulation-running').style.display = 'none';
            document.getElementById('simulation-graph').style.display = 'block';
            document.getElementById('run-button').style.display = 'block';
            document.getElementById('run-simulation-button').disabled = false;
            return;
        }

        document.getElementById('instructions-output').innerHTML = d["total_instructions"];
        document.getElementById('cycles-output').innerHTML = d["total_cycles"];
        document.getElementById('IPC-output').innerHTML = d["ipc"].toFixed(2);
        document.getElementById('cycles-per-iteration-output').innerHTML = d["cycles_per_iteration"].toFixed(2);


        usage = {}
        usage['dispatch'] = (d["ipc"] / processorInfo.stages.dispatch) * 100;
        usage['execute'] = (d["ipc"] / processorInfo.stages.execute) * 100;
        usage['retire'] = (d["ipc"] / processorInfo.stages.retire) * 100;
        usage.ports = {}
        let i = 0;
        let keys = Object.keys(processorInfo.ports);
        for (let key of keys) {
            usage.ports[i] = d.ports[key];
            i++;
        }
        createProcessorSimulationGraph(processorInfo.stages.dispatch, Object.keys(processorInfo.ports).length, processorInfo.stages.retire, usage);
        document.getElementById('run-simulation-spinner').style.display = 'none';
        document.getElementById('simulation-running').style.display = 'none';
        document.getElementById('simulation-graph').style.display = 'block';
        document.getElementById('run-button').style.display = 'block';
        document.getElementById('run-simulation-button').disabled = false;

    },
    'format_timeline': (data) => {
      let tmpitem = document.getElementById('simulation-output');
      tmpitem.innerHTML = '';

      let item = document.getElementById('simulation-output');
      // new div with class code-block
      let codeItem = document.createElement('div');
      codeItem.classList.add('code-block');

      let pre = document.createElement('pre');

      // \033[91m
      // \033[0m
      // replace all \033[91m with <span style="color: red">
      // replace all \033[0m with </span>
      data = data.replace(/\033\[91m/g, '<span style="color: red">');
      data = data.replace(/\033\[0m/g, '</span>');

      // new <code> with ID timeline-output
      let code = document.createElement('code');
      code.id = 'timeline-output';
      code.classList.add('large-code-output');
      code.innerHTML = data;

      // append code to codeItem
      pre.appendChild(code);
      codeItem.appendChild(pre);
      item.appendChild(codeItem);

      //timelineData = data; //TODO: canvas Timeline
    },
    'print_output': (data) => {
        let out = data.replace(/\n/g, '<br>');
        console.log(out);
    },
    'save_modified_processor': (data) => {
      console.log("Processor settings saved");
    },
    'get_program_json': async (data) => {
      programData = JSON.parse(data);
    }
}

const worker = new Worker('./worker.js');
worker.onmessage = function(message) {
    console.log('Message received from worker', message);
    if (message.data.action === 'initialized') {
        executeCode(GET_AVAIL_PROGRAMS, 'get_programs');
        executeCode(GET_AVAIL_PROCESSORS, 'get_processors');
    }
    if (message.data.action === 'loadedPackage') {
        // TODO
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
                // TODO: remove
                if (data === undefined) {
                    data = "None";
                }
                data = data.replace(/\n/g, '<br>');
                if (message.data.data_type === 'text') {
                    document.getElementById('execution-result').innerHTML = `
                    <p class="rvcat-result">${data}</p>
                    `
                } else if (message.data.data_type === 'error') {
                    // Replace newlines with <br>
                    document.getElementById('execution-result').innerHTML = `
                    <p class="rvcat-error">${data}</p>
                    `
                }
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
function programShow() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_EXECUTION,
        'prog_show'
    )

}

function programShowPerfAnnotations() {
  executeCode(
    RVCAT_HEADER() + PROG_SHOW_EXECUTION,
    'prog_show_annotations'
  )
}

function programShowDependencies() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_DEPENDENCIES,
        'print_output'
    )
    lastExecutedCommand = programShowDependencies;
}

function programShowExecution() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_EXECUTION,
        'print_output'
    )
    lastExecutedCommand = programShowExecution;
}

function programShowMemtrace() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_MEMORY,
        'print_output'
    )
    lastExecutedCommand = programShowMemtrace;
}

function programShowAnalysis() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_STATIC_PERFORMANCE,
        'print_output'
    )
    lastExecutedCommand = programShowAnalysis;
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
    // TODO: Remove
    console.log('Executing code:\n', code);
    worker.postMessage({action: 'execute', code: code, id: id});
}

// UI stuff
function openLoadingOverlay() {
  document.getElementById('loading-overlay').style.display = 'block';
  document.getElementById('blur-overlay-item').style.display = 'block';
}

function closeLoadingOverlay() {
    document.getElementById('loading-overlay').style.display = 'none';
    document.getElementById('blur-overlay-item').style.display = 'none';
}

function setLoadingOverlayMessage(message) {
    document.getElementById('loading-overlay-message').innerHTML = message;
}

function reloadRvcat() {
    programShow();
    getProcessorInformation();

}

function createGraphVizGraph(dotCode, targetElement, callback=null) {
        // Create an instance of Viz.js
        const viz = new Viz();

        // Render the graph
        viz.renderSVGElement(dotCode)
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

function createProcessorGraph(dispatch, execute, retire) {
    // Define your Graphviz DOT code
    const dotCode = construct_reduced_processor_dot(dispatch, execute, retire);
    createGraphVizGraph(dotCode, document.getElementById('pipeline-graph'));
}

let fullGraphDotCode;

function createProcessorSimulationGraph(dispatch, execute, retire, usage=null) {
  // Define your Graphviz DOT code
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

    /*
    {"name": "Baseline-2", "stages": {"dispatch": 6, "execute": 6, "retire": 8},
    "resources": {"INT": 1, "FLOAT": 2, "FLOAT.SP.MUL": 4, "FLOAT.DP.MUL": 4,
    "FLOAT.SP.FUSED": 5, "FLOAT.DP.FUSED": 5, "BRANCH": 1, "MEM.STORE": 2,
    "MEM.LOAD": 4}, "ports": {"1": ["INT", "BRANCH", "FLOAT"], "2": ["MEM.LOAD",
    "MEM.STORE"], "3": ["FLOAT", "INT"], "4": ["FLOAT", "INT"], "5":
    ["MEM.LOAD", "MEM.STORE"]}, "rports": {"INT": ["1", "3", "4"], "BRANCH":
    ["1"], "FLOAT": ["1", "3", "4"], "MEM.LOAD": ["2", "5"], "MEM.STORE": ["2",
    "5"]}, "cache": null, "nBlocks": 0, "blkSize": 8, "mPenalty": 16,
    "mIssueTime": 8}
    */

    let dispatch_width = processorInfo.stages.dispatch;
    let num_ports = Object.keys(processorInfo.ports).length;
    let retire_width = processorInfo.stages.retire;
    createProcessorGraph(dispatch_width, num_ports, retire_width);
}

function showDependenciesGraph() {
    programShowPerfAnnotations();
    let controls = document.getElementById('dependencies-controls');
    controls.style.display = 'block';
    let num_iters = document.getElementById('dependencies-num-iters').value;
    if (num_iters === '') {
        num_iters = 3;
    }
    if (num_iters > 10) {
        num_iters = 10;
        document.getElementById('dependencies-num-iters').value = 10;
    }
    executeCode(
        RVCAT_HEADER() + prog_show_dependencies_graphviz(num_iters),
        'generate_dependencies_graph'
    )
    lastExecutedCommand = showDependenciesGraph;
}

function showCriticalPathsGraph() {
    executeCode(
        RVCAT_HEADER() + PROG_SHOW_CRITICAL_PATHS_GRAPHVIZ,
        'generate_critical_paths_graph'
    )
    lastExecutedCommand = showCriticalPathsGraph;
}

function getSchedulerAnalysis() {
    showProcessor();

    document.getElementById('instructions-output').innerHTML = '?';
    document.getElementById('cycles-output').innerHTML = '?';
    document.getElementById('IPC-output').innerHTML = '?';
    document.getElementById('cycles-per-iteration-output').innerHTML = '?';

    document.getElementById('run-simulation-spinner').style.display = 'block';
    document.getElementById('simulation-running').style.display = 'block';
    document.getElementById('simulation-graph').style.display = 'none';
    document.getElementById('run-button').style.display = 'none';
    document.getElementById('run-simulation-button').disabled = true;
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

    await executeCode(
        RVCAT_HEADER() + show_timeline(num_iters),
        'format_timeline'
    )
    lastExecutedCommand = getTimeline;
    return timelineData;
}

async function saveModifiedProcessor(config) {

  await executeCode(
    RVCAT_HEADER() + addModifiedProcessor(config),
    'save_modified_processor'
  );
  await executeCode(GET_AVAIL_PROCESSORS, 'get_processors');
}

async function getProgramJSON(){
  await executeCode(
    RVCAT_HEADER() + GET_PROGRAM_JSON,
    'get_program_json'
  );
  return programData;
}
