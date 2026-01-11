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

  const showProgram = async (name) => {
    try {
      const code = 'rvcat._program.show_code()';
      const result = await safeExecute(code, 'program_show');
      console.log('Program shown:', result);
      return result;
    } catch (error) {
      console.error('Failed to show program:', error);
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
    showProgram,
    setROBSize
  };
}
