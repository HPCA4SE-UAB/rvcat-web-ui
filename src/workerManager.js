// Pure JavaScript, no Vue dependencies
export class WorkerManager {
  constructor(workerPath = './worker.js') {
    this.workerPath       = workerPath;
    this.worker           = new Worker(workerPath);
    this.messageCallbacks = new Map(); // Store callbacks by message ID
    this.globalHandlers   = {}; // Will be set by Vue components
    this.progressHandlers = {}; // Progress of long tasks (simulations), by message ID

    this.isReady      = false; // Track initialization state
    this.readyPromise = null; // Promise for waiting
    this.readyResolve = null;

    this.setupMessageHandler();
    this.initialize();
  }

  setupMessageHandler() {
    this.worker.onmessage = (message) => {
      const { action, id, result, data_type } = message.data;
      if (action === 'initialized') {
        this.isReady = true;
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
        console.log('📦🎯 Worker initialized and ready');
      }

      if (action === 'progress' && id && this.progressHandlers[id]) {
        this.progressHandlers[id](message.data.fraction);
      }

      if (action === 'executed' && id) {
        // Call specific callback if exists
        if (this.messageCallbacks.has(id)) {
          const callback = this.messageCallbacks.get(id);
          callback(result, data_type);
          this.messageCallbacks.delete(id); // Clean up
        }

        if (this.globalHandlers[id]) {
          this.globalHandlers[id](result, data_type);
        }
      }
    };
  }

  // Register global handlers from Vue components
  registerHandler(id, handler) {
    this.globalHandlers[id] = handler;
  }

  // Unregister handler
  unregisterHandler(id) {
    delete this.globalHandlers[id];
  }

  // Progress of a long task (a simulation): handler(fraction done)
  registerProgressHandler(id, handler) {
    this.progressHandlers[id] = handler;
  }
  unregisterProgressHandler(id) {
    delete this.progressHandlers[id];
  }

  // Abort what the worker is running: Python cannot be interrupted while it simulates, so the
  // worker is terminated and a new one is started (it loads Pyodide and RVCAT again; the files
  // are in the cache of the browser). The pending requests are forgotten.
  restart() {
    this.worker.terminate();
    this.messageCallbacks.clear();
    this.isReady      = false;
    this.readyPromise = null;
    this.readyResolve = null;
    this.worker       = new Worker(this.workerPath);
    this.setupMessageHandler();
    this.initialize();
    return this.waitForReady();
  }

  // Execute code with callback
  execute(code, id, callback) {
    if (callback) {
      this.messageCallbacks.set(id, callback);
    }

    this.worker.postMessage({
      action: 'execute',
      code: code,
      id: id
    });
  }


  // Wait for initialization
  async waitForReady() {
    if (this.isReady) return true;

    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });
    }

    return this.readyPromise;
  }

  // Execute only when ready
  async executeWhenReady(code, id, callback) {
    await this.waitForReady();
    return this.execute(code, id, callback);
  }

  initialize() {
    this.worker.postMessage({ action: 'initialize' });
  }

  loadPackage(pkg) {
    this.worker.postMessage({
      action: 'loadPackage',
      package: pkg
    });
  }

}





