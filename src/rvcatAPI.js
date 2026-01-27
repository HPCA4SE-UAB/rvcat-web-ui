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
  
  const setProcessor = async (jsontext) => {
    try {
      const code = `rvcat._processor.load(${jsontext})`;
      const result = await safeExecute(code, 'set_processor');
      console.log('🧠 RVCAT: processor set');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to set processor:', error);
      throw error;
    }
  };

  const setProgram = async (jsontext) => {
    try {
      const code = `rvcat._program.load(${jsontext})`;
      const result = await safeExecute(code, 'set_program');
      console.log('🧠 RVCAT: program set');
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to set program:', error);
      throw error;
    }
  };

  const showProgram = async () => {
    try {
      const code = 'rvcat._program.show_code()';
      const result = await safeExecute(code, 'show_program');
      console.log('🧠 RVCAT: show program:\n', result);
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to show program:', error);
      throw error;
    }
  };

  const getDependenceGraph = async (n,i,l,s,f) => {
    try {
      let internal = "True";
      let latency  = "True";
      let small    = "True";
      let full     = "True";
      if (!i) {internal = "False"}
      if (!l) {latency  = "False"}
      if (!s) {small    = "False"}
      if (!f) {full     = "False"}
      const code = `rvcat._program.show_graphviz(${n}, ${internal}, ${latency}, ${small}, ${full})`
      const result = await safeExecute(code, 'get_dependence_graph');
      console.log('🧠 RVCAT: get dependence Graph (GRAPHVIZ):\n', result);
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get dependence graph:', error);
      throw error;
    }
  };

  const getPerformanceAnalysis = async () => {
    try {
      const code = `rvcat._program.get_performance_analysis()`
      const result = await safeExecute(code, 'get_performance_analysis');
      console.log('🧠 RVCAT: get performance analysis:\n', result);
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get performance analysis:', error);
      throw error;
    }
  };

  const getExecutionResults = async (n_iters, rob_size) => {
    try {
      const code = `rvcat._scheduler.get_results(${n_iters}, ${rob_size})`
      const result = await safeExecute(code, 'get_execution_results');
      console.log('🧠 RVCAT: Execution Results obtained\n', result);
      return result;
    } catch (error) {
      console.error('🧠❌ RVCAT: failed to get execution results:', error);
      throw error;
    }
  };

   const getTimeline = async (n_iters, rob_size) => {
    try {
      const code = `rvcat._scheduler.get_timeline(${n_iters}, ${rob_size})`
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
    setProcessor,
    setProgram,
    showProgram,
    getPerformanceAnalysis,
    getDependenceGraph,
    getExecutionResults,
    getTimeline
  };
}
