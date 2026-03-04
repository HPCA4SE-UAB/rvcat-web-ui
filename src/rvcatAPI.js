import { inject } from 'vue';

export function useRVCAT_Api() {
  const { executePython, isReady } = inject('worker');

  const safeExecute = async (code, id) => {
    if (!isReady.value) {
      throw new Error('Worker not ready');
    }
    return executePython(code, id);
  };

  const importRVCAT = async () => {
    try {
      const code = 'import rvcat';
      const result = await safeExecute(code, 'import_rvcat');
      console.log('🧠 RVCAT: imported');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to import', error);
      throw error;
    }
  };

  const getDependenceGraph = async (JSONprogramText, n,i,l,s,f) => {
    try {
      let internal = "True";
      let latency  = "True";
      let small    = "True";
      let full     = "True";
      if (!i) {internal = "False"}
      if (!l) {latency  = "False"}
      if (!s) {small    = "False"}
      if (!f) {full     = "False"}
      const code = `rvcat._program.show_graphviz(${JSONprogramText},${n}, ${internal}, ${latency}, ${small}, ${full})`
      const result = await safeExecute(code, 'get_dependence_graph');
      console.log('🧠 RVCAT: dependence Graph (GRAPHVIZ) obtained');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get dependence graph:', error);
      throw error;
    }
  };

  const getPerformanceAnalysis = async (JSONprocessText) => {
    try {
      const code = `rvcat._program.get_performance_analysis(${JSONprocessText})`
      const result = await safeExecute(code, 'get_performance_analysis');
      console.log('🧠 RVCAT: performance analysis obtained');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get performance analysis:', error);
      throw error;
    }
  };

  const getExecutionResults = async (JSONprocessText, n_iters) => {
    try {
      const code = `rvcat._scheduler.get_results(${JSONprocessText}, ${n_iters})`
      const result = await safeExecute(code, 'get_execution_results');
      console.log('🧠 RVCAT: execution results obtained');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get execution results:', error);
      throw error;
    }
  };

   const getTimeline = async (JSONprocessText, n_iters) => {
    try {
      const code = `rvcat._scheduler.get_timeline(${JSONprocessText}, ${n_iters})`
      const result = await safeExecute(code, 'get_timeline');
      console.log('🧠 RVCAT: timeline obtained');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get timeline:', error);
      throw error;
    }
  };

  // Return all functions
  return {
    importRVCAT,
    getPerformanceAnalysis,
    getDependenceGraph,
    getExecutionResults,
    getTimeline
  };
}
