import { ref } from 'vue';

/* ------------------------------------------------------------------ 
 * Estado reactivo compartido para modales
 * ------------------------------------------------------------------ */
export const modalState = {
  showSaveModal:    ref(false),
  showUploadModal:  ref(false),
  showChangeModal:  ref(false),
  modalName:        ref(''),
  modalError:       ref(''),
  saveToFile:       ref(true),
  pendingAction:    ref(null),
  confirmOperation: ref(null)
};

/* ------------------------------------------------------------------ 
 * Configuraciones específicas por tipo de recurso
 * ------------------------------------------------------------------ */
export const resourceConfig = {
  processor: {
    storagePrefix: 'processor',
    resourceName:  'processor configuration',
    logPrefix:     '💻'
  },
  program: {
    storagePrefix: 'program',
    resourceName:  'program',
    logPrefix:     '📄'
  },
  tutorial: {
    storagePrefix: 'tutorial',
    resourceName:  'tutorial',
    logPrefix:     '🎓'
  }
};

/**
 * Open Save/Upload Modal    @param {String} defaultName   @param {String} resourceType 
 */
export function openSaveModal(defaultName, resourceType) {
  modalState.modalName.value     = defaultName;
  modalState.modalError.value    = '';
  modalState.saveToFile.value    = true;
  modalState.showSaveModal.value = true;
  console.log(`${resourceConfig[resourceType]?.logPrefix}💾❓Opening save modal`);
}
export function openUploadModal(defaultName, resourceType) {
  modalState.modalName.value       = defaultName;
  modalState.modalError.value      = '';
  modalState.showUploadModal.value = true;
  console.log(`${resourceConfig[resourceType]?.logPrefix}📤❓ Opening upload modal`);
}

/**
 * Close all Modals 
 */
export function closeAllModals() {
  modalState.showSaveModal.value   = false;
  modalState.showUploadModal.value = false;
  modalState.showChangeModal.value = false;
  modalState.modalError.value      = '';
  modalState.pendingAction.value   = null;
}

/**
 *  handlePendingAction  @param {Boolean} isModified + @param {Function} actionCallback + @param {String} actionType 
            - Tipo de acción ('upload', 'load', 'clear', etc.)
 */
export function handlePendingAction(isModified, actionCallback, actionType) {
  if (isModified) {
    modalState.pendingAction.value    = actionType;
    modalState.showChangeModal.value  = true;
    modalState.confirmOperation.value = actionCallback;
  } else {
    actionCallback();
  }
}

/**
 * Confirma una operación pendiente
 */
export function confirmPendingAction() {
  if (modalState.confirmOperation.value) {
    modalState.confirmOperation.value();
  }
  closeAllModals();
}

/**
 * Cancela una operación pendiente
 */
export function cancelPendingAction() {
  closeAllModals();
}


/**
 * @param {Object} data +  @param {String} filename + @param {String} resourceType
 */
export async function downloadJSON(data, filename, resourceType) {
  try {
    const jsonString   = JSON.stringify(data, null, 2);
    const config       = resourceConfig[resourceType];
    const fullFilename = `${filename}.json`;
    
    // File System Access API -> force a Save As...
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fullFilename,
        types: [{
          description: 'JSON files',
          accept: { 'application/json': ['.json'] }
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
    } else {
      // Fallback: traditional anchor download
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }   
    console.log(`${config?.logPrefix}💾✅ Downloaded ${config?.resourceName}: ${filename}`);
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(`${resourceConfig[resourceType]?.logPrefix}💾❌ Failed to download:`, error);
    }
    return false;
  }
}

/**
 * uploadJSON  @param {Function} onSuccess (Callback) @param {String} resourceType 
 *             @returns {Promise<Object|null>}
 */
export async function uploadJSON(onSuccess, resourceType) {
  return new Promise((resolve) => {
    const input         = document.createElement('input');
    input.type          = 'file';
    input.accept        = 'application/json';
    input.style.display = 'none';
    
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (!data.name && !data.id) {
          alert(`The JSON file must contain a 'name' or 'id' field.`);
          resolve(null);
          return;
        }
        
        const config = resourceConfig[resourceType];
        console.log(`${config?.logPrefix}📥✅ Uploaded ${config?.resourceName}:`, data.name || data.id);
        
        if (onSuccess)
          onSuccess(data, file.name.replace(/\.[^.]+$/, ''));
        resolve(data);
      } catch (error) {
        console.error(`${resourceConfig[resourceType]?.logPrefix}📥❌ Failed to upload&parse JSON:`, error);
        alert('Could not load JSON file. Please check the file format.');
        resolve(null);
      }
    };
    
    document.body.appendChild(input);
    input.click();
    setTimeout(() => document.body.removeChild(input), 1000);
  });
}

/**
 * saveToLocalStorage @param {String} resourceType + @param {String} id + @param {Object} data + @param {Array} availableList 
 *                @returns {Boolean} True si se guardó exitosamente
 */
export function saveToLocalStorage(resourceType, id, data, availableList) {
  try {
    const config = resourceConfig[resourceType];
    if (!config) {
      console.error(`Unknown resource type: ${resourceType}`);
      return false;
    }
    
    const key        = `${config.storagePrefix}.${id}`;
    const jsonString = JSON.stringify(data, null, 2);   
    localStorage.setItem(key, jsonString);
    
    // Update available list
    if (availableList && !availableList.includes(id)) {
      availableList.push(id);
    }
    
    console.log(`${config.logPrefix}✅ Saved ${config.resourceName}: ${id}`);
    return true;
  } catch (error) {
    console.error(`${resourceConfig[resourceType]?.logPrefix}❌ Failed to save to localStorage:`, error);
    return false;
  }
}

/**
 * removeFromLocalStorage @param {String} resourceType + @param {String} id + @param {Array} availableList
 *          @returns {Boolean} True si se eliminó exitosamente
 */
export function removeFromLocalStorage(resourceType, id, availableList) {
  try {
    const config = resourceConfig[resourceType];
    if (!config) {
      console.error(`Unknown resource type: ${resourceType}`);
      return false;
    }
    
    const key = `${config.storagePrefix}.${id}`;
    localStorage.removeItem(key);
    
    // Remover de la lista de disponibles
    if (availableList) {
      const index = availableList.indexOf(id);
      if (index > -1) {
        availableList.splice(index, 1);
      }
    }
    
    // Delete related keys
    const relatedKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey.startsWith(`${key}.`)) {
        relatedKeys.push(storageKey);
      }
    }
    
    relatedKeys.forEach(relatedKey => {
      localStorage.removeItem(relatedKey);
      console.log(`${config.logPrefix}🗑️ Removed related: ${relatedKey}`);
    });
    
    console.log(`${config.logPrefix}🧹 Removed ${config.resourceName}: ${id}`);
    return true;
  } catch (error) {
    console.error(`${resourceConfig[resourceType]?.logPrefix}❌ Failed to remove from localStorage:`, error);
    return false;
  }
}

/**
 * loadFromLocalStorage   @param {String} resourceType + @param {String} id
 *       @returns {Object|null}
 */
export function loadFromLocalStorage(resourceType, id) {
  try {
    const config = resourceConfig[resourceType];
    if (!config) {
      console.error(`Unknown resource type: ${resourceType}`);
      return null;
    }
    
    const key        = `${config.storagePrefix}.${id}`;
    const jsonString = localStorage.getItem(key);
    
    if (!jsonString) return null;
    
    const data = JSON.parse(jsonString);
    console.log(`${config.logPrefix}📥 Loaded ${config.resourceName}: ${id}`);
    return data;
  } catch (error) {
    console.error(`${resourceConfig[resourceType]?.logPrefix}❌ Failed to load from localStorage:`, error);
    return null;
  }
}

/**
 * getResourceKeys @param {String} resourceType 
 *       @returns {Array} Lista de IDs disponibles
 */
export function getResourceKeys(prefix) {
  const keys = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(prefix)) {
      const id = key.substring(prefix.length);
      keys.push(id);
    }
  }
  
  return keys;
}


/* ------------------------------------------------------------------ 
 * Initialize Programs/Processors/Tutorials resources using data from 
 *  distribution files if not already in localStorage
 * ------------------------------------------------------------------ */
const initResource = async ({resourceType, optionsObj, currentKey, availableKey, errorHandler = null }) => {
  const config = resourceConfig[resourceType];
  if (!config) {
    console.error(`Unknown resource type: ${resourceType}`);
    return [];
  }
  const storagePrefix = config.storagePrefix;
  const logPrefix     = config.logPrefix;
  
  console.log(`${logPrefix}🔄 Loading ${resourceName}s ...`);
  try {
    let keys = getResourceKeys(`${storagePrefix}.`);
    if (keys.length === 0) {
      const response = await fetch('./index.json');
      const data     = await response.json();
      const fileList = data[storagePrefix];
      if (!fileList) {
        throw new Error(`No ${storagePrefix} found in index.json`);
      }
      for (const fileName of fileList) {
        const name     = `./${storagePrefix}/${fileName}.json`;
        const response = await fetch(name)
        const filedata = await response.json()
        console.log(`${logPrefix}📥 loadJSONfile: ${name}`)
        localStorage.setItem(`${storagePrefix}.${fileName}`, JSON.stringify(filedata));
      }
      keys = getResourceKeys(`${storagePrefix}.`);
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from distribution files`);
    } else {
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from localStorage`);
    }
    optionsObj[availableKey] = keys;
    if (currentKey && !keys.includes(optionsObj[currentKey])) {
      optionsObj[currentKey] = keys[0];
    }
  } catch (error) {
    console.error(`${logPrefix}❌ Failed to load ${resourceType}s:`, error); 
    if (errorHandler) errorHandler(error);
  }
};

/* ------------------------------------------------------------------ 
 * GraphViz conversion to SVG
 * ------------------------------------------------------------------ */

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
    svg.style.width     = "100%"
    svg.style.height    = "100%"
    svg.style.maxWidth  = "100%"
    svg.style.maxHeight = "100%"
    svg.style.display   = "block"
  
    return svg;
    } catch(error) {
      console.error("🕸️❌ GraphVizGraph: rendering error.", error);
      throw error;
    }
}
