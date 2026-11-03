import { inject } from 'vue';

// Python expression that parses a JSON text inside Pyodide.
// The text travels as an escaped string literal (JSON string escapes are valid
// Python escapes), so JSON values such as true/false/null are handled by json.loads.
export function pyJSON(jsonText) {
  return `__import__('json').loads(${JSON.stringify(String(jsonText))})`;
}

const pyBool = (value) => (value ? 'True' : 'False');

export function useRVCAT_Api() {
  const { executePython, isReady } = inject('worker');

  // Runs Python code; the result is delivered to the handler registered with `id`
  const run = async (code, id, description) => {
    if (!isReady.value) {
      throw new Error('Worker not ready');
    }
    try {
      const result = await executePython(code, id);
      console.log(`🧠 RVCAT: ${description}`);
      return result;
    } catch (error) {
      console.error(`🧠❌ RVCAT: ${description} failed:`, error);
      throw error;
    }
  };

  const importRVCAT = () => run('import rvcat', 'import_rvcat', 'import');

  const graphCode = (JSONprogramText, n, internal, latency, small, full) =>
    `rvcat._program.show_graphviz(${pyJSON(JSONprogramText)}, ${n}, ` +
    `${pyBool(internal)}, ${pyBool(latency)}, ${pyBool(small)}, ${pyBool(full)})`;

  // Same Python call, delivered to different handlers (static analysis panel / program editor)
  const getDependenceGraph = (JSONprogramText, n, i, l, s, f) =>
    run(graphCode(JSONprogramText, n, i, l, s, f), 'get_dependence_graph', 'dependence graph');

  const getProgGraph = (JSONprogramText, n, i, l, s, f) =>
    run(graphCode(JSONprogramText, n, i, l, s, f), 'get_prog_graph', 'program graph');

  const getPerformanceAnalysis = (JSONprocessText) =>
    run(`rvcat._program.get_performance_analysis(${pyJSON(JSONprocessText)})`,
        'get_performance_analysis', 'performance analysis');

  const getExecutionResults = (JSONprocessText, n_iters) =>
    run(`rvcat._scheduler.get_results(${pyJSON(JSONprocessText)}, ${n_iters})`,
        'get_execution_results', 'execution results');

  const getTimeline = (JSONprocessText, n_ret) =>
    run(`rvcat._scheduler.get_timeline(${pyJSON(JSONprocessText)}, nret=${n_ret})`,
        'get_timeline', 'timeline');

  return {
    importRVCAT,
    getPerformanceAnalysis,
    getDependenceGraph,
    getProgGraph,
    getExecutionResults,
    getTimeline
  };
}
