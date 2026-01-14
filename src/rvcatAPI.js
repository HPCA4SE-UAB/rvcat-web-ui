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
      console.log('import rvcat');
      return result;
    } catch (error) {
      console.error('Failed to import RVCAT:', error);
      throw error;
    }
  };
  
  const setProcessor = async (jsontext) => {
    try {
      const code = `rvcat._processor.load("${jsontext}")`;
      const result = await safeExecute(code, 'set_processor');
      console.log('Processor set:', result);
      return result;
    } catch (error) {
      console.error('Failed to set processor:', error);
      throw error;
    }
  };

  const setProgram = async (jsontext) => {
    try {
      const code = `rvcat._program.load("${jsontext}")`;
      const result = await safeExecute(code, 'set_program');
      console.log('Program set:', result);
      return result;
    } catch (error) {
      console.error('Failed to set program:', error);
      throw error;
    }
  };

  const showProgram = async () => {
    try {
      const code = 'rvcat._program.show_code()';
      const result = await safeExecute(code, 'show_program');
      console.log('Program shown:', result);
      return result;
    } catch (error) {
      console.error('Failed to show program:', error);
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
      console.log('Dependence Graph (GRAPHVIZ) obtained');
      return result;
    } catch (error) {
      console.error('Failed to get dependence graph: ', error);
      throw error;
    }
  };

  const getExecutionResults = async (n_iters, rob_size) => {
    try {
      const code = `rvcat._scheduler.get_results(${n_iters}, ${rob_size})`
      const result = await safeExecute(code, 'get_execution_results');
      console.log('Execution Results obtained');
      return result;
    } catch (error) {
      console.error('Failed to get execution results: ', error);
      throw error;
    }
  };

   const getTimeline = async (n_iters, rob_size) => {
    try {
      const code = `rvcat._scheduler.get_timeline(${n_iters}, ${rob_size})`
      const result = await safeExecute(code, 'get_timeline');
      console.log('Timeline obtained');
      return result;
    } catch (error) {
      console.error('Failed to get timeline: ', error);
      throw error;
    }
  };
   
  // Return all functions
  return {
    importRVCAT,
    setProcessor,
    setProgram,
    showProgram,
    getDependenceGraph,
    getExecutionResults,
    getTimeline
  };
}
