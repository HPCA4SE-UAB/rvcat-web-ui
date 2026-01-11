import { inject } from 'vue';

export function useRVCAT_Api() {
  const { executePython, isReady } = inject('worker');
  
  const safeExecute = async (code, id) => {
    if (!isReady.value) {
      throw new Error('Worker not ready');
    }
    return executePython(code, id);
  };
  
  const setProcessor = async (name) => {
    try {
      const code = `rvcat._processor.load("${name}")`;
      const result = await safeExecute(code, 'set_processor');
      console.log('Processor set successfully:', result);
      return result;
    } catch (error) {
      console.error('Failed to set processor:', error);
      throw error;
    }
  };
  
  const setROBSize = async (size) => {
    const code = `rvcat.set_rob_size(${size})`;
    return safeExecute(code, `set_rob_size_${Date.now()}`);
  };
  
  // Return all functions
  return {
    setProcessor,
    setROBSize,
    isReady
  };
}
