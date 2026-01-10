// Pure JavaScript, no Vue dependencies
export class WorkerManager {
  constructor(workerPath = './worker.js') {
    this.worker           = new Worker(workerPath);
    this.messageCallbacks = new Map(); // Store callbacks by message ID
    this.globalHandlers   = {}; // Will be set by Vue components
    
    this.isReady      = false; // Track initialization state
    this.readyPromise = null; // Promise for waiting
    this.readyResolve = null;
    
    this.setupMessageHandler();
    this.initialize();
  }

  setupMessageHandler() {
    this.worker.onmessage = (message) => {
      const { action, id, result, data_type } = message.data;     
      console.log('Worker message:', message.data);
      
      if (action === 'initialized') {
        this.isReady = true;
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
        console.log('Worker initialized and ready');
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

