// Vue composable
import { WorkerManager }    from '@/public/workerManager';
import { ref, onUnmounted } from 'vue';

// Singleton worker manager
let workerManager = null;

export function useWorker() {
  // Create singleton instance
  if (!workerManager) {
    workerManager = new WorkerManager();
    workerManager.initialize();
  }

  const isReady = ref(false);
  
  // Function to register a Vue component handler
  const registerHandler = (id, handler) => {
    if (workerManager) {
      workerManager.registerHandler(id, handler);
      
      // Return cleanup function
      return () => {
        workerManager.unregisterHandler(id);
      };
    }
  };

  // Execute Python code
  const executePython = (code, id, callback) => {
    if (workerManager) {
      workerManager.execute(code, id, callback);
    }
  };

  // Load Python package
  const loadPackage = (pkg) => {
    if (workerManager) {
      workerManager.loadPackage(pkg);
    }
  };

  // Cleanup on app unmount
  onUnmounted(() => {
    if (workerManager) {
      workerManager.worker.terminate();
      workerManager = null;
    }
  });

  return {
    isReady,
    registerHandler,
    executePython,
    loadPackage
  };

}
