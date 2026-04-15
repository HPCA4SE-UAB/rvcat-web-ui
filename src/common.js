
export const instructionTypes = ['INT', 'VINT', 'MEM', 'VMEM', 'FLOAT', 'VFLOAT','BRANCH'];

export const typeOperations = {
    'INT':    ['ARITH', 'LOGIC', 'SHIFT'],
    'VINT':   ['ARITH', 'LOGIC', 'SHIFT'],
    'MEM':    ['STORE', 'LOAD'],
    'VMEM':   ['STORE', 'LOAD'],
    'FLOAT':  ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT'],
    'VFLOAT': ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT'],
    'BRANCH': []
  };

export const typeSizes = {
    'INT':    ['byte', 'word', 'long'],
    'VINT':   ['byte', 'word', 'long'],
    'MEM':    ['byte', 'word', 'long'],
    'VMEM':   [],
    'FLOAT':  ['single', 'double'],
    'VFLOAT': ['single', 'double'],
    'BRANCH': []
  };

export function charToProcessingState(ch, port) {
  if (port != null) {
    return `starting Execution on port P${port}`
  }
  switch (ch) {
    case "E": return "Execution continues on pipeline";
    case "R": return "Retire: write to architected register";
    case "D": return "Dispatch: enter execution engine";
    case "-": return "Waiting for older instructions to retire ";
    case "W": return "Write back result on ROB";
    case ".": return "Waiting due to data dependencies";
    case "*": return "Waiting due to port collision";
    case "!": return "Cache miss";
    case "2": return "Secondary cache miss";
    default:  return null;
  }
}

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
    logPrefix:     '👨‍🎓'
  },
  timeline: {
    storagePrefix: 'timeline',
    resourceName:  'timeline',
    logPrefix:     '📈'
  },
  result: {
    storagePrefix: 'results',
    resourceName:  'results',
    logPrefix:     '🕐'
  }
};

export function updateProcess(process) {

  const { latencies, ports, instruction_list } = process

  // 🔹 Precalcular mapa op → bitmask
  const opToMask = {}

  Object.entries(ports).forEach(([portIdStr, supportedOps]) => {

    const portId = Number(portIdStr)
    const bit    = (1 << portId)

    supportedOps.forEach(op => {
      if (!opToMask[op]) opToMask[op] = 0
      opToMask[op] |= bit
    })
  })

  // 🔹 Recalcular cada instrucción
  instruction_list.forEach(instr => {

    const keyFull  = `${instr.type}.${instr.oper}.${instr.size}`
    const keyOp    = `${instr.type}.${instr.oper}`
    const keyType  = instr.type

    // Latency
    instr.latency =
      latencies[keyFull] ??
      latencies[keyOp]   ??
      latencies[keyType] ??
      1

    // Ports
    instr.ports =
      opToMask[keyOp] ??
      opToMask[keyType] ??
      0

    if (instr.ports === 0) {
      console.warn(`⚠️ No ports found for instruction ${instr.id} (${keyOp}). Check processor configuration.`)
    }
  })
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

function getResourceKeys(prefix) {
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
export async function initResource (resourceType, optionsObj, currentKey, availableKey) {
  const config = resourceConfig[resourceType];
  if (!config) {
    console.error(`Unknown resource type: ${resourceType}`);
    return
  }
  const storagePrefix = config.storagePrefix;
  const logPrefix     = config.logPrefix;

  console.log(`${logPrefix}🔄 Loading ${resourceType}s ...`);
  try {
    let keys = getResourceKeys(`${storagePrefix}.`);
    if (keys.length === 0) {
      const response = await fetch('./index.json');
      const data     = await response.json();
      const fileList = data[storagePrefix];
      if (!fileList) {
        console.log(`No ${storagePrefix} found in index.json`);
        keys = []
      } else {
        for (const fileName of fileList) {
          const name     = `./${storagePrefix}/${fileName}.json`;
          const response = await fetch(name)
          const filedata = await response.json()
          console.log(`${logPrefix}📥 loadJSONfile: ${name}`)
          localStorage.setItem(`${storagePrefix}.${fileName}`, JSON.stringify(filedata));
        }
        keys = getResourceKeys(`${storagePrefix}.`);
        console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from distribution files`);
      }
    } else {
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from localStorage`);
    }
    optionsObj[availableKey] = keys;
    if (currentKey && !keys.includes(optionsObj[currentKey])) {
      optionsObj[currentKey] = keys[0];
    }
  } catch (error) {
    console.error(`${logPrefix}❌ Failed to load ${resourceType}s:`, error);
  }
};

/* ------------------------------------------------------------------
 * GraphViz conversion to SVG
 * ------------------------------------------------------------------ */
export async function createGraphVizGraph(dotCode) {
  try {
    const viz = new Viz();

    const svg = await viz.renderSVGElement(dotCode, { engine: "dot" })

    // Make SVG responsive
    let width  = svg.getAttribute("width")
    let height = svg.getAttribute("height")

    if (!svg.getAttribute("viewBox") && width && height) {

      // quitar unidades como "pt"
      width  = parseFloat(width)
      height = parseFloat(height)

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    }

    // dejar que CSS controle el tamaño
    svg.removeAttribute("width")
    svg.removeAttribute("height")
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet")

    return svg;
    } catch(error) {
      console.error("🕸️❌ GraphVizGraph: rendering error.", error);
      throw error;
    }
}

export function fitSvgToContainer(svg, container) {

  const vb        = svg.viewBox.baseVal
  const svgWidth  = vb.width
  const svgHeight = vb.height

  const containerWidth  = container.clientWidth
  const containerHeight = container.clientHeight

  const scale = Math.min(
    containerWidth  / svgWidth,
    containerHeight / svgHeight
  )

  svg.style.transformOrigin = "top left"
  svg.style.transform = `scale(${scale})`

  // ajustar tamaño del wrapper para centrar
  svg.style.width  = svgWidth + "px"
  svg.style.height = svgHeight + "px"
}
