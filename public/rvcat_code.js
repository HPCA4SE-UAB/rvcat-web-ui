const GET_AVAIL_PROGRAMS = `import rvcat
rvcat._program.list_programs_json()
`

const GET_AVAIL_PROCESSORS = `import rvcat
rvcat._processor.list_processors_json()
`

const PROG_SHOW              = 'str(rvcat._program)'
const PROG_SHOW_CRITICAL_PATHS_GRAPHVIZ = `rvcat._program.get_recurrent_paths_graphviz()`
const PROG_SHOW_EXECUTION    = `rvcat.show_program_execution()`
const PROG_SHOW_STATIC_PERFORMANCE = `rvcat.show_program_performance()`

function show_timeline(num_iters) {
    return `rvcat._scheduler.format_timeline(niters=${num_iters})`
}

const SHOW_PROCESSOR = 'rvcat._processor.json()'
const GET_PROGRAM_JSON = 'rvcat._program.json()'

const RUN_PROGRAM_PREAMBLE = function() {
    let res = `rvcat._scheduler.load_program(rvcat._program, iterations=${currentIterations()}, window_size=${currentROBSize()})\n`
    return res;
}
const RUN_PROGRAM_ANALYSIS = 'rvcat._scheduler.format_analysis_json()'

function addModifiedProcessor(config){
  let res = `rvcat._processor.import_processor_json(${JSON.stringify(config)})`;
  return res;
}

function addNewProgram(config){
  let res = `rvcat._program.import_program_json(${config})`;
  return res;
}

const RVCAT_HEADER = function() {
    let proc = currentProcessor();
    let prog = currentProgram();
    let res = `import rvcat\n`;
    if (proc !== undefined) {
      res += `rvcat.load_processor('${currentProcessor()}')\n`
    }
    if (prog !== undefined) {
    res += `rvcat.load_program('${currentProgram()}')\n`
    res += RUN_PROGRAM_PREAMBLE();
    }
    return res;
}
