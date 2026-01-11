function readPythonProgramsAndProcessors() {
      programShow();
      getSchedulerAnalysis(1000,100);
}

function programShow() {
    executeCode( 'rvcat._program.show_code()', 'program_show' );
}

function insert_cache_annotations(cache) {
  if (cache.nBlocks>0){
     document.getElementById('cache-info').innerHTML=`
      <b>Cache:</b><span>${cache.nBlocks} blocks of ${cache.blkSize} bytes. Miss penalty: ${cache.mPenalty}. Miss Issue time: ${cache.mIssueTime}</span>`;
  }
  else {
     document.getElementById('cache-info').innerHTML="<b>Processor does not simulate a cache memory.</b>";
  }
}

async function getProcessorGraph(processorInfo) {
  try {
    const dotCode = construct_reduced_processor_dot(
       processorInfo.stages.dispatch,
       Object.keys(processorInfo.ports).length, 
       processorInfo.stages.retire,  
       {
          'nBlocks':    processorInfo.nBlocks,
          'blkSize':    processorInfo.blkSize,
          'mPenalty':   processorInfo.mPenalty,
          'mIssueTime': processorInfo.mIssueTime
       }
    );
    const svg = await createGraphVizGraph(dotCode);  
    return svg;
    
  } catch (error) {
    throw error;
  }
}

function getSchedulerAnalysis(n_iters, rob_size) {
    document.getElementById('instructions-output').innerHTML = '?';
    document.getElementById('cycles-output').innerHTML       = '?';
    document.getElementById('IPC-output').innerHTML          = '?';
    document.getElementById('cycles-per-iteration-output').innerHTML = '?';

    document.getElementById('run-simulation-spinner').style.display = 'block';
    document.getElementById('simulation-running').style.display     = 'block';
    document.getElementById('graph-section').style.display          = 'none';
    document.getElementById('critical-path-section').style.display  = 'none';
    document.getElementById('run-simulation-button').disabled       = true;

    let res = `rvcat._scheduler.init(${n_iters}, ${rob_size}); `
    res    += 'rvcat._scheduler.format_analysis_json()';
    executeCode( res, 'generate_simulation_results' );
}

function reloadRvcat() {
    programShow();
    getProcessorInformation();
}

function programShowPerformanceLimits() {
    executeCode( 'rvcat._program.show_performance_analysis()', 'prog_show_performance' )
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
  
    let res = `rvcat._program.show_graphviz(${n}, ${internal}, ${latency}, ${small}, ${full})`
    executeCode( res, 'generate_critical_paths_graph' )
    lastExecutedCommand = showCriticalPathsGraph;
}

async function getTimeline(num_iters, rob_size) {
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

      let res = `rvcat._scheduler.init(${num_iters}, ${rob_size}); `
      res    += `rvcat._scheduler.format_timeline(niters=${num_iters})`
      executeCode( res, 'format_timeline');
      lastExecutedCommand = getTimeline;
    });
}

async function saveModifiedProcessor(config) {
   let res = `rvcat._processor.save(${JSON.stringify(config)})`
   await executeCode( res, 'save_modified_processor' )
   await executeCode('rvcat.files.list_json(True)', 'get_processors')
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

    executeCode( 'rvcat._program.json()', 'get_program_json');
  });
}

async function saveNewProgram(config) {
  const payload = typeof config === 'string' ? JSON.parse(config) : config;
  let res = `rvcat._program.save(${JSON.stringify(payload)})`
  await executeCode( res, 'add_new_program' )
  await executeCode('rvcat.files.list_json(False)',  'get_programs'  );
}

function programShowMemtrace(n_iters) {
   let res = `rvcat._scheduler.init(${n_iters}, 10); rvcat._program.show_memory_trace()`
   executeCode( res, 'print_output' )
   lastExecutedCommand = programShowMemtrace;
}

////////////////////////////////////////
////  Helping functions  ///////////////
////////////////////////////////////////

async function createGraphVizGraph(dotCode) {
  try {
    const viz = new Viz();
    const svg = await viz.renderSVGElement(dotCode, { engine: "dot" })

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
  
    return svg;
    } catch(error) {
      console.error("Error rendering graph:", error);
      throw error;
    }
}

let fullGraphDotCode;

function createProcessorSimulationGraph(dispatch, execute, retire, usage=null) {
  fullGraphDotCode = construct_full_processor_dot(dispatch, execute, retire, usage);
  svg = createGraphVizGraph(fullGraphDotCode);
  document.getElementById('simulation-graph').appendChild(svg)
}

function showFullProcessor(){
   svg = createGraphVizGraph(fullGraphDotCode);
   document.getElementById('simulation-graph').appendChild(svg)
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
