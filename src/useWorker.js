// Vue composable
import { ref, onUnmounted } from 'vue';
import { WorkerManager }    from '../public/workerManager';

// Singleton worker manager
let workerManager = null;

export function useWorker() {
  // State
  const isReady   = ref(false);
  const isLoading = ref(true);
  const error     = ref(null);
  
  // Initialize if needed
  if (!workerManager) {
    workerManager = new WorkerManager();

    // Set up ready tracking
    workerManager.waitForReady()
      .then(() => {
        isReady.value   = true;
        isLoading.value = false;
      })
      .catch(err => {
        error.value     = err;
        isLoading.value = false;
      });
  }
  
  // Safe execution (waits for ready automatically)
  const safeExecute = async (fn) => {
    if (!isReady.value) {
      await workerManager.waitForReady();
    }
    return fn();
  };
  
  // Public methods
  const executePython = (code, id, callback) => {
    return workerManager.executeWhenReady(code, id, callback);
  };
  
  const loadPackage = (pkg) => {
    return safeExecute(() => workerManager.loadPackage(pkg));
  };
  
  const registerHandler = (id, handler) => {
    workerManager.registerHandler(id, handler);
    // Return cleanup function
    return () => {
      workerManager.unregisterHandler(id);
    };
  };
  
  // Cleanup
  onUnmounted(() => {
    if (workerManager) {
      workerManager.worker.terminate();
      workerManager = null;
    }
  });
  
  return {
    // State
    isReady,
    isLoading,
    error,
    
    // Methods
    executePython,
    loadPackage,
    registerHandler,
    waitForReady: () => workerManager.waitForReady()
  };
}


