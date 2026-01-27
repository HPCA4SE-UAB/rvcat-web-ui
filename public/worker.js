/* Why Use a Web Worker?
     Runs Python in background thread
     Doesn't block UI/main thread
     Can handle computationally intensive tasks
    Pyodide's WebAssembly runs efficiently in worker
 This pattern allows running Python code safely in the browser while maintaining responsive web applications.
*/

/* Loads the Pyodide library from CDN into the worker thread */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js')

/*Loads Python packages (like pip install but for WebAssembly)
  self refers to the worker's global scope */
async function loadPackage(pkg) {
    await self.pyodide.loadPackage(pkg);
}

/* Sets up Pyodide only once (singleton pattern) & Preloads commonly used packages */
async function initialize() {
    if (self.pyodide === undefined) {
        self.pyodide = await loadPyodide();              // Load Pyodide runtime
        await loadPackage('numpy')                       // Preload numpy
        await loadPackage('rvcat-0.1-py3-none-any.whl')  // Custom package
    }
}

/********
  Message Handling - The Core.
    The worker listens for messages from the main thread. Three Main Actions:
      A. Initialize Action: Main thread requests initialization & Worker responds when ready
      B. Load Package Action: Dynamically loads additional Python packages
      C. Execute Action (Most Important): 
      Key Features:
        Async/Await:            Everything is asynchronous to prevent blocking
        Error Handling:         Catches Python exceptions and sends them back as errors
        Message ID Tracking:    Optional id field to match requests with responses
        Separation of Concerns: Different actions for initialization, package loading, and execution
 ********/

self.onmessage = async function(message) {
    if (message.data.action === 'initialize') {
        await initialize();
        // Respond message
        self.postMessage({action: 'initialized'});
    }
    if (message.data.action === 'loadPackage') {
        await loadPackage(message.data.package);
        self.postMessage({action: 'loadedPackage', package: message.data.package});
    }
    if (message.data.action === 'execute') {
        // catch python errors
        try {
            console.log('🐍➡️ execute: ', message.data.code)
            let res = await self.pyodide.runPythonAsync(message.data.code);
            console.log('🐍✅ results:', res);
            // Send successful result back
            if (message.data.id !== undefined) {
                self.postMessage({action: 'executed', result: res, data_type: 'text', id: message.data.id});
            } else {
                self.postMessage({action: 'executed', result: res, data_type: 'text'});
            }
        } catch (err) {
            if (message.data.id !== undefined) {
                self.postMessage({action: 'executed', result: err.toString(), data_type: 'error', id: message.data.id});
            }
            else {
                self.postMessage({action: 'executed', result: err.toString(), data_type: 'error'});
            }
        }
    }
}
