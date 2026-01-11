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

  const getProcessors = async () => {
    try {
      const code = 'rvcat.files.list_json(True)';
      const result = await safeExecute(code, 'get_processors');
      console.log('List of processor names:', result);
      return result;
    } catch (error) {
      console.error('Failed to get processor names:', error);
      throw error;
    }
  };

  const getPrograms = async () => {
    try {
      const code = 'rvcat.files.list_json(False)';
      const result = await safeExecute(code, 'get_programs');
      console.log('List of program names:', result);
      return result;
    } catch (error) {
      console.error('Failed to get program names:', error);
      throw error;
    }
  };
  
  const setProcessor = async (name) => {
    try {
      const code = `rvcat._processor.load("${name}")`;
      const result = await safeExecute(code, 'set_processor');
      console.log('Processor set:', result);
      return result;
    } catch (error) {
      console.error('Failed to set processor:', error);
      throw error;
    }
  };

  const setProgram = async (name) => {
    try {
      const code = `rvcat._program.load("${name}")`;
      const result = await safeExecute(code, 'set_program');
      console.log('Program set:', result);
      return result;
    } catch (error) {
      console.error('Failed to set program:', error);
      throw error;
    }
  };
  
  const setROBSize = async (size) => {
    const code = `rvcat.set_rob_size(${size})`;
    return safeExecute(code, `set_rob_size_${Date.now()}`);
  };
  
  // Return all functions
  return {
    importRVCAT,
    getProcessors,
    getPrograms,
    setProcessor,
    setProgram,
    setROBSize
  };
}

export function getProcessorGraph(processorInfo) {
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
