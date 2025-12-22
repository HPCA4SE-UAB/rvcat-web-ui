const RVCAT_HEADER = function() {
    let proc = currentProcessor();
    let prog = currentProgram();
    if (proc == "" || prog == "") 
       return "";
    let res = `import rvcat\n`;
    res += `rvcat._processor.load('${currentProcessor()}')\n`
    res += `rvcat._program.load('${currentProgram()}')\n`
    res += `rvcat._scheduler.init(iterations=${currentIterations()}, window_size=${currentROBSize()})\n`
    return res;
}

// PROGRAM
const GET_PROGRAM_JSON       = 'rvcat._program.json()'
const PROG_SHOW_EXECUTION    = `rvcat._program.show_code()`
const PROG_SHOW_MEMORY       = `rvcat._program.show_memory_trace()`
const PROG_SHOW_STATIC_PERFORMANCE = `rvcat._program.show_performance_analysis()`
const GET_AVAIL_PROGRAMS = `import rvcat
rvcat.files.list_json(False)
`
function addNewProgram(config){
  return `rvcat._program.save(${JSON.stringify(config)})`;
}
function get_graph (num_iters, constants, read_only, internal, latency) {
    return `rvcat._program.show_graphviz(${num_iters}, ${constants}, ${read_only}, ${internal}, ${latency})`
}

// PROCESSOR
const SHOW_PROCESSOR   = 'rvcat._processor.json()'
const GET_AVAIL_PROCESSORS = `import rvcat
rvcat.files.list_json(True)
`
function addModifiedProcessor(config){
  return `rvcat._processor.save(${JSON.stringify(config)})`;
}

// RUN program
const RUN_PROGRAM_ANALYSIS = 'rvcat._scheduler.format_analysis_json()'
function show_timeline(num_iters) {
    return `rvcat._scheduler.format_timeline(niters=${num_iters})`
}
