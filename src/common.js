
export const RVCAT_VERSION = '1.15';

export const instructionTypes = ['INT', 'VINT', 'MEM', 'VMEM', 'FLOAT', 'VFLOAT','BRANCH'];
export const MAX_LOGICAL_ELEMENT_COUNT = 5000;
export const CACHE_BLOCK_SIZES = [8, 16, 32, 64, 128];
const MEMORY_DATA_SIZES = { byte: 1, word: 4, long: 8 };

export function createMemoryAddressColorMap(addresses = []) {
  const uniqueAddresses = [...new Set(addresses.filter(Number.isSafeInteger))]
    .sort((a, b) => a - b)

  return new Map(uniqueAddresses.map((address, index) => [
    address,
    `hsl(${Math.round(index * 360 / uniqueAddresses.length)}, 70%, 82%)`
  ]))
}

export function getLargestMemoryAccessSize(instructionList = []) {
  return instructionList.reduce((largest, instruction) => {
    if (instruction?.type !== 'MEM' && instruction?.type !== 'VMEM') return largest

    const dataSize = MEMORY_DATA_SIZES[instruction.size]
    if (!dataSize) return largest

    const lanes = instruction.type === 'VMEM'
      ? (Number.isSafeInteger(instruction.lanes) && instruction.lanes > 0
          ? instruction.lanes
          : 1)
      : 1
    return Math.max(largest, dataSize * lanes)
  }, 0)
}

export function getAllowedCacheBlockSizes(instructionList = []) {
  const largestAccessSize = getLargestMemoryAccessSize(instructionList)
  return CACHE_BLOCK_SIZES.filter(size => size >= largestAccessSize)
}

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
    'VMEM':   ['byte', 'word', 'long'],
    'FLOAT':  ['single', 'double'],
    'VFLOAT': ['single', 'double'],
    'BRANCH': []
  };

export function normalizeProgramDefaults(program) {
  if (!program || typeof program !== 'object' || Array.isArray(program) ||
      !Array.isArray(program.instruction_list)) {
    return program
  }

  return {
    ...program,
    instruction_list: program.instruction_list.map(instruction => {
      if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) {
        return instruction
      }

      const normalized = { ...instruction }
      const isMemory = instruction.type === 'MEM' || instruction.type === 'VMEM'
      if ((isMemory || instruction.type === 'BRANCH') &&
          (normalized.stride === undefined || normalized.stride === null)) {
        normalized.stride = 1
      }
      if (isMemory && (normalized.lanes === undefined || normalized.lanes === null)) {
        normalized.lanes = 1
      }
      return normalized
    })
  }
}

export function validateProgram(program, options = {}) {
  const errors = []
  const addError = (message) => errors.push(message)

  if (!program || typeof program !== 'object' || Array.isArray(program)) {
    return ['Program must be a JSON object.']
  }

  if (typeof program.name !== 'string' || !program.name.trim()) {
    addError("Program name must be a non-empty string.")
  }

  if (!Array.isArray(program.instruction_list) || program.instruction_list.length === 0) {
    addError('Program must contain a non-empty instruction_list.')
    return errors
  }

  const textFields = ['text', 'destin', 'source1', 'source2', 'source3', 'constant']
  const branches = []

  program.instruction_list.forEach((instruction, index) => {
    const prefix = `Instruction ${index + 1}: `
    const addInstructionError = (message) => addError(prefix + message)

    if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) {
      addInstructionError('must be an object.')
      return
    }

    if (typeof instruction.text !== 'string' || !instruction.text.trim()) {
      addInstructionError('text must be a non-empty string.')
    }

    for (const field of textFields.slice(1)) {
      if (instruction[field] !== undefined && typeof instruction[field] !== 'string') {
        addInstructionError(`${field} must be a string when provided.`)
      }
    }

    if (typeof instruction.type !== 'string' || !instructionTypes.includes(instruction.type)) {
      addInstructionError(`type must be one of: ${instructionTypes.join(', ')}.`)
      return
    }

    const operations = typeOperations[instruction.type]
    if (instruction.type === 'BRANCH') {
      branches.push(index)
      if (instruction.oper !== undefined && instruction.oper !== '') {
        addInstructionError('BRANCH oper must be empty.')
      }
      if (instruction.size !== undefined && instruction.size !== '') {
        addInstructionError('BRANCH size must be empty.')
      }
    } else {
      if (typeof instruction.oper !== 'string' || !operations.includes(instruction.oper)) {
        addInstructionError(`oper must be one of: ${operations.join(', ')}.`)
      }

      const sizes = typeSizes[instruction.type]
      if (typeof instruction.size !== 'string' || !sizes.includes(instruction.size)) {
        addInstructionError(`size must be one of: ${sizes.join(', ')}.`)
      }
    }

    const stride = instruction.stride === undefined ? 1 : instruction.stride
    if (!Number.isSafeInteger(stride)) {
      addInstructionError('stride must be a safe integer.')
    } else if (instruction.type === 'BRANCH' &&
               (stride <= 0 || stride > MAX_LOGICAL_ELEMENT_COUNT)) {
      addInstructionError(
        `BRANCH stride must be between 1 and ${MAX_LOGICAL_ELEMENT_COUNT}.`
      )
    }

    const lanes = instruction.lanes === undefined ? 1 : instruction.lanes
    if (!Number.isSafeInteger(lanes) || lanes <= 0) {
      addInstructionError('lanes must be a positive safe integer.')
    }

    if (instruction.type === 'MEM' || instruction.type === 'VMEM') {
      if (typeof instruction.source2 !== 'string' || !instruction.source2.trim()) {
        addInstructionError('memory instructions must name an array in source2.')
      }
      if (instruction.constant !== undefined &&
          instruction.constant !== '' &&
          (typeof instruction.constant !== 'string' ||
           !/^[+-]?\d+$/.test(instruction.constant.trim()) ||
           !Number.isSafeInteger(Number(instruction.constant.trim())))) {
        addInstructionError('memory constant must be a safe integer offset.')
      }
    }
  })

  if (branches.length !== 1) {
    addError('Program must contain exactly one BRANCH instruction.')
  } else if (branches[0] !== program.instruction_list.length - 1) {
    addError('The BRANCH instruction must be the final instruction.')
  }

  if (options.logicalElementCount !== undefined) {
    const logicalElementCount = options.logicalElementCount
    if (!Number.isSafeInteger(logicalElementCount) ||
        logicalElementCount <= 0 ||
        logicalElementCount > MAX_LOGICAL_ELEMENT_COUNT) {
      addError(
        `Logical element count must be between 1 and ${MAX_LOGICAL_ELEMENT_COUNT}.`
      )
    } else if (branches.length === 1) {
      const branch = program.instruction_list[branches[0]]
      const loopStride = branch.stride === undefined ? 1 : branch.stride
      if (Number.isSafeInteger(loopStride) && loopStride > 0) {
        const effectiveElementCount = Math.max(
          loopStride,
          logicalElementCount - (logicalElementCount % loopStride)
        )
        const iterations = effectiveElementCount / loopStride
        program.instruction_list.forEach((instruction, index) => {
          if (instruction?.type !== 'MEM' && instruction?.type !== 'VMEM') return

          const stride = instruction.stride === undefined ? 1 : instruction.stride
          const lanes = instruction.lanes === undefined ? 1 : instruction.lanes
          const elementSize = MEMORY_DATA_SIZES[instruction.size]
          const constant = instruction.constant === undefined || instruction.constant === ''
            ? 0
            : Number(instruction.constant)
          if (!Number.isSafeInteger(stride) || !Number.isSafeInteger(lanes) || lanes <= 0 ||
              !elementSize || !Number.isSafeInteger(constant)) {
            return
          }

          const firstElement = stride < 0 ? effectiveElementCount - constant : constant
          const lastElement = firstElement + (iterations - 1) * lanes * stride
          const lastLane = Math.max(firstElement, lastElement) + lanes - 1
          if (!Number.isSafeInteger(firstElement) || !Number.isSafeInteger(lastElement) ||
              !Number.isSafeInteger(lastLane)) {
            addError(
              `Instruction ${index + 1}: memory addresses exceed the supported integer range.`
            )
            return
          }
          if (Math.min(firstElement, lastElement) < 0) {
            addError(
              `Instruction ${index + 1}: memory access for array "${instruction.source2}" ` +
              `reaches before its base address at N=${effectiveElementCount}.`
            )
          }
        })
      }
    }
  }

  return errors
}

function createOperationPortMasks(ports) {
  const opToMask = {}

  if (!ports || typeof ports !== 'object' || Array.isArray(ports)) {
    return opToMask
  }

  Object.entries(ports).forEach(([portIdStr, supportedOps]) => {
    const portId = Number(portIdStr)
    if (!Number.isInteger(portId) || portId < 0 || portId > 31 || !Array.isArray(supportedOps)) {
      return
    }

    const bit = (1 << portId)
    supportedOps.forEach(op => {
      if (!opToMask[op]) opToMask[op] = 0
      opToMask[op] |= bit
    })
  })

  return opToMask
}

export function getUnsupportedInstructions(process) {
  if (!Array.isArray(process?.instruction_list)) {
    return []
  }

  const opToMask = createOperationPortMasks(process.ports)
  return process.instruction_list.flatMap((instruction, index) => {
    const keyOp = `${instruction.type}.${instruction.oper}`
    const portMask = opToMask[keyOp] ?? opToMask[instruction.type] ?? 0
    return portMask === 0 ? [{ index, instruction }] : []
  })
}

export function getLogicalElementCount(instructionList, loopIterations) {
  let loopStride = 1
  for (const instruction of instructionList) {
    if (instruction.type === 'BRANCH' && instruction.stride !== 1) {
      loopStride = instruction.stride ?? 1
    }
  }
  return loopIterations * loopStride
}

export function charToProcessingState(ch, port, addr, memoryOperation = null) {
  if (port != null) {
    if (ch === "L")
      return `Load addr ${addr} on P${port}`
    else if (ch === "S")
      return `Store addr ${addr} on P${port}`
    else
      return `Issued to P${port}`
  }
  switch (ch) {
    case "E": return "Executing";
    case "L": return "Load running";
    case "S": return "Store running";
    case "R": return "Retire (write register)";
    case "D": return "Dispatch";
    case "-": return "Wait for older instr. to retire";
    case "W": return memoryOperation === "Store to"
      ? "Write result to cache"
      : "Write result to ROB";
    case ".": return "Wait: data dependency";
    case "*": return "Wait: port conflict";
    case "^": return "Wait: issue width full";
    case "#": return "Wait: dirty writeback";
    case ":": return "Wait: block fill";
    case "!": return "Wait: cache/MM slot";
    case "2": return "Wait: matching fill";
    case "@": return "Wait for cache return: block data ready";
    case "U": return "Dirty writeback";
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

export const TUTORIAL_FLOW_VERSION = 2;

export function createTutorialStepId() {
  const id = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `step-${id}`
}

export function migrateTutorialFlow(tutorial) {
  if (!tutorial || !Array.isArray(tutorial.steps)) {
    throw new TypeError('Tutorial must contain a steps array.')
  }

  const isLegacy = tutorial.flowVersion == null || tutorial.flowVersion === 1
  if (!isLegacy && tutorial.flowVersion !== TUTORIAL_FLOW_VERSION) {
    throw new Error(`Unsupported tutorial flow version: ${tutorial.flowVersion}.`)
  }
  const steps = tutorial.steps.map(step => ({ ...step }))
  const ids = new Set()

  steps.forEach((step, index) => {
    if (typeof step.id !== 'string' || !step.id || ids.has(step.id)) {
      if (!isLegacy) {
        throw new Error(`Tutorial step ${index + 1} has a missing or duplicate id.`)
      }
      let id = `step-${index + 1}`
      let suffix = 1
      while (ids.has(id)) id = `step-${index + 1}-${suffix++}`
      step.id = id
    }
    if (step.id === 'end') {
      throw new Error(`Tutorial step ${index + 1} uses the reserved id "end".`)
    }
    ids.add(step.id)
  })

  if (isLegacy) {
    steps.forEach((step, index) => {
      step.next = index < steps.length - 1 ? [steps[index + 1].id] : []
    })
  } else {
    steps.forEach((step, index) => {
      if (step.next == null) step.next = []
      if (!Array.isArray(step.next) || step.next.length > 2) {
        throw new Error(`Tutorial step ${index + 1} must have at most two successor ids.`)
      }
      // optional button texts (nextLabels) stay aligned with their successors
      const keep = step.next.map(targetId => targetId != null && targetId !== '')
      step.next = step.next.filter((_, i) => keep[i])
      if (Array.isArray(step.nextLabels))
        step.nextLabels = step.nextLabels.filter((_, i) => keep[i]).map(l => String(l ?? ''))
      const seenTargets = new Set()
      step.next.forEach(targetId => {
        if (targetId === 'end') {
          if (seenTargets.has(targetId)) {
            throw new Error(`Tutorial step ${index + 1} has a duplicate end destination.`)
          }
          seenTargets.add(targetId)
          return
        }
        if (typeof targetId !== 'string' || !ids.has(targetId)) {
          throw new Error(`Tutorial step ${index + 1} references an unknown successor.`)
        }
        if (targetId === step.id || seenTargets.has(targetId)) {
          throw new Error(`Tutorial step ${index + 1} has a self-link or duplicate successor.`)
        }
        seenTargets.add(targetId)
      })
    })
  }

  return { ...tutorial, flowVersion: TUTORIAL_FLOW_VERSION, steps }
}

export function updateProcess(process) {

  const { latencies, ports, instruction_list } = process

  const opToMask = createOperationPortMasks(ports)
  const unsupportedInstructions = []

  // 🔹 Recalcular cada instrucción
  instruction_list.forEach((instr, index) => {

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
      unsupportedInstructions.push({ index, instruction: instr })
    }
  })

  return unsupportedInstructions
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
 *             @param {Object} validationOptions program validation options
 *             @returns {Promise<Object|null>}
 */
export async function uploadJSON(onSuccess, resourceType, validationOptions = {}) {
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
        const parsedData = JSON.parse(text);
        const data = resourceType === 'program'
          ? normalizeProgramDefaults(parsedData)
          : parsedData

        if (resourceType === 'program') {
          const validationErrors = validateProgram(data, validationOptions)
          if (validationErrors.length) {
            alert(`Invalid program:\n${validationErrors.map(error => `• ${error}`).join('\n')}`)
            resolve(null)
            return
          }
        }

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
// Distribution tutorials already offered to this user (key outside the 'tutorial.' prefix)
const DISTRIBUTION_SEEN_KEY = 'tutorialDistributionSeen'

function distributionSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(DISTRIBUTION_SEEN_KEY)) ?? []) }
  catch { return new Set() }
}

function markDistributionSeen(names) {
  const seen = distributionSeen()
  names.forEach(name => seen.add(name))
  localStorage.setItem(DISTRIBUTION_SEEN_KEY, JSON.stringify([...seen]))
}

// Loads the distribution files that are neither stored nor offered before; returns their names
export async function addNewDistributionFiles(storagePrefix, distributionFiles, storedKeys) {
  const seen  = distributionSeen()
  // tutorials stored before this mechanism existed count as already offered
  storedKeys.forEach(name => seen.add(name))
  const added = []
  for (const fileName of distributionFiles) {
    if (seen.has(fileName)) continue
    try {
      const response = await fetch(`./${storagePrefix}/${fileName}.json`)
      if (!response.ok) continue
      localStorage.setItem(`${storagePrefix}.${fileName}`, JSON.stringify(await response.json()))
      added.push(fileName)
    } catch (error) {
      console.warn(`⚠️ Could not load distribution file ${fileName}:`, error)
    }
  }
  markDistributionSeen([...seen, ...added])
  return added
}

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
    let distributionFiles = null;
    if (keys.length === 0 || resourceType === 'processor' || resourceType === 'program' ||
        resourceType === 'tutorial') {
      try {
        const response = await fetch('./index.json');
        if (!response.ok) {
          throw new Error(`Failed to load index.json: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        distributionFiles = data[storagePrefix];
      } catch (error) {
        if (keys.length === 0) throw error;
        console.warn(`${logPrefix}⚠️ Failed to load index.json; keeping local ${resourceType} order:`, error);
      }
    }

    if (keys.length === 0) {
      if (!Array.isArray(distributionFiles) || distributionFiles.length === 0) {
        console.log(`No ${storagePrefix} found in index.json`);
        keys = []
      } else {
        for (const fileName of distributionFiles) {
          const name     = `./${storagePrefix}/${fileName}.json`;
          const response = await fetch(name)
          const filedata = await response.json()
          console.log(`${logPrefix}📥 loadJSONfile: ${name}`)
          localStorage.setItem(`${storagePrefix}.${fileName}`, JSON.stringify(filedata));
        }
        keys = getResourceKeys(`${storagePrefix}.`);
        console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from distribution files`);
        if (resourceType === 'tutorial') markDistributionSeen(distributionFiles)
      }
    } else {
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from localStorage`);
      if (resourceType === 'tutorial' && Array.isArray(distributionFiles)) {
        // Tutorials added to the distribution later are offered once, even if the user
        // already has tutorials (a tutorial deleted by the user is not added again)
        const added = await addNewDistributionFiles(storagePrefix, distributionFiles, keys)
        if (added.length) {
          keys = getResourceKeys(`${storagePrefix}.`);
          console.log(`${logPrefix}✅ Added new distribution ${resourceType}s:`, added)
        }
      }
    }

    if (Array.isArray(distributionFiles)) {
      const distributionNames = new Set(distributionFiles);
      keys = [
        ...distributionFiles.filter(name => keys.includes(name)),
        ...keys.filter(name => !distributionNames.has(name))
      ];
    }

    optionsObj[availableKey] = keys;
    if (currentKey && !keys.includes(optionsObj[currentKey])) {
      optionsObj[currentKey] = keys[0] ?? '';
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

export function get_processor_dot(process, allowEdit, highlightPort = -1) {

    const ports    = process.ports
    const lat      = process.latencies
    const port_ids = Object.keys(ports)
    const ROBsize  = process.ROBsize || 20
    const sched    = process.sched
    const dispatch = process.dispatch || 1
    const retire   = process.retire || 1
    const CachePenalty   = process.mPenalty || 1
    const CacheIssueTime = process.mIssueTime || 1
    const CacheBlocks    = process.nBlocks || 0
    const CacheBlockSize = process.blkSize || 32
    const FillBuffers    = process.nFillBuffers || 2
    const WriteBuffers   = process.nWriteBuffers || 2
    const ReturnThroughput = process.rThru || 1

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
    }

    function type_color(type) {
      if (type === "INT")    return "#d6e4ff"
      if (type === "MEM")    return "#d6ffd6"
      if (type === "FLOAT")  return "#fff2b3"
      if (type === "VINT")   return "#e6e4ff"
      if (type === "VMEM")   return "#e6ffd6"
      if (type === "VFLOAT") return "#eff2b3"
      if (type === "BRANCH") return "#ffd6d6"
      return "#f0f0f0"
    }

    function op_type(op) {
      return op.split(".")[0]
    }

    function latency_tooltip(op) {

      const base = lat[op]

      const variants = Object.keys(lat)
        .filter(k => k.startsWith(op + "."))

      if (variants.length === 0)
        return base !== undefined ? `${op} latency: ${base}` : ""

      let txt = `${op} latencies:\n`

      if (base !== undefined)
        txt += `base: ${base}\n`

      for (let v of variants)
        txt += `${v}: ${lat[v]}\n`

      return txt
    }

    function compress_ops(ops) {
      const grouped = {}
      for (let op of ops) {
        const [type, sub] = op.split(".")
        if (!grouped[type]) grouped[type] = new Set()
        if (sub) grouped[type].add(sub)
      }

      const result = []
      for (let type in grouped) {
        const all_ops = typeOperations[type] || []
        if (all_ops.length === 0 || grouped[type].size === all_ops.length) {
          result.push({
            label: type,
            big: true
          })
        } else {
          for (let sub of grouped[type]) {
            result.push({
              label: `${type}.${sub}`,
              big: false
            })
          }
        }
      }
      return result
    }

    const highlight = highlightPort !== null && highlightPort !== undefined
      ? String(highlightPort)
      : null

    const port_ops = {}
    for (let p of port_ids)
      port_ops[p] = compress_ops(ports[p])

    const total_rows = Math.max(...Object.values(port_ops).map(o => o.length))

    let edit = "Edit "
    if (!allowEdit)
      edit = ""

    // ---- Dispatch + ROB ----
    let decode_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="dispatch" TITLE="${edit}Dispatch width"><FONT POINT-SIZE="20">🔄&nbsp;<B>Dispatch:&nbsp;</B>&nbsp;${dispatch}/cycle</FONT></TD>
      <TD ROWSPAN="${total_rows+5}" BGCOLOR="#f0f0f0" HREF="#" ID="rob" TITLE="${edit}ROB size" ALIGN="CENTER" VALIGN="MIDDLE"><FONT POINT-SIZE="20">🔄<BR/><BR/><B>ROB</B><BR/><BR/><B>${ROBsize}</B></FONT><BR/><FONT POINT-SIZE="16">entries</FONT></TD>
    </TR>`

    // ---- Waiting Buffer ----
    let schedLabel = "❌optimal ✅greedy"
    let toggle = "Toggle scheduler"
    if (sched !== "greedy"){
      schedLabel = "✅optimal ❌greedy"
    }
    if (!allowEdit)
      toggle = "Scheduler policy"

    let wb_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="sched" TITLE="${toggle}"><FONT POINT-SIZE="20"><B>Waiting Buffer</B></FONT>&nbsp;&nbsp;&nbsp;<FONT POINT-SIZE="16">Scheduler:&nbsp;</FONT><FONT POINT-SIZE="18"><B>${schedLabel}</B></FONT></TD>
    </TR>`

    // ---- Port headers ----
    let port_header = "<TR>"

    for (let p of port_ids) {
      const isHighlighted = (p === highlight)
      const style = isHighlighted
        ? ' BGCOLOR="#ffcccc" BORDER="1" COLOR="red"'
        : ' BGCOLOR="#f5f5f5"'

      const safePort = escapeHtml(p)
      port_header += `<TD ${style} HREF="#" ID="port:${safePort}" TITLE="Port ${safePort}"><FONT POINT-SIZE="20"><B>P${safePort}</B></FONT></TD>`
    }

    port_header += "</TR>"

    // ---- Operation rows ----
    let op_rows = ""

    for (let i = 0; i < total_rows; i++) {

      op_rows += "<TR>"

      for (let p of port_ids) {
        const isHighlighted = (p === highlight)
        const highlightAttr = isHighlighted
          ? ' BORDER="1" COLOR="red"'
          : ''

        const op = port_ops[p][i]

        if (!op) {
          op_rows += `<TD ${highlightAttr}></TD>`
          continue
        }

        const type    = op_type(op.label)
        const color   = type_color(type)
        const tooltip = latency_tooltip(op.label)
        const safeLabel = escapeHtml(op.label)
        const safeTooltip = escapeHtml(tooltip)

        op_rows += `
          <TD BGCOLOR="${color}" TITLE="${safeTooltip}" HREF="#" ID="op:${escapeHtml(p)}:${i}:${safeLabel}" ${highlightAttr}><FONT POINT-SIZE="${op.big ? 18 : 16}">${op.big ? `<B>${safeLabel}</B>` : safeLabel}</FONT></TD>`
      }

      op_rows += "</TR>"
    }

    let cacheEdit = "Cache config: click repeatedly to cycle through parameter editing"
    if (!allowEdit)
      cacheEdit = "Current Cache config"

    let cache_row = ""
    // ---- Cache configuration ----
    if (CacheBlocks > 0) {
      cache_row = `<TR>
        <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="cache" TITLE="${cacheEdit}"><FONT POINT-SIZE="20">🔄&nbsp;<B>Cache:</B>&nbsp;${CacheBlocks} blocks&nbsp;x&nbsp;${CacheBlockSize} bytes&nbsp;&nbsp;Penalty: ${CachePenalty}<BR ALIGN="LEFT"/>IssueTime: ${CacheIssueTime}&nbsp;FillBuff: ${FillBuffers}&nbsp;WrtBuff: ${WriteBuffers}&nbsp;RetThru: ${ReturnThroughput}</FONT></TD>
      </TR>`
    } else {
      cache_row = `<TR>
        <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="cache" TITLE="${cacheEdit}"><FONT POINT-SIZE="20">🔄&nbsp;<B>Cache:</B>&nbsp;No cache</FONT></TD>
      </TR>`
    }

    // ---- Retire ----
    let reg_row = `<TR>
      <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="retire" TITLE="${edit}Retire width"><FONT POINT-SIZE="20">🔄&nbsp;<B>Retire:</B>&nbsp;${retire}/cycle&nbsp;&nbsp;<B>(Architected Registers)</B></FONT></TD>
    </TR>`

    const dot = `
      digraph CPU {
        node [shape=plain fontname="Arial" width=0 height=0 margin=0]
        pipeline [
          label=<
            <TABLE WIDTH="600" BORDER="2" CELLBORDER="1" CELLSPACING="2" CELLPADDING="1">
              ${decode_row}
              ${wb_row}
              ${port_header}
              ${op_rows}
              ${cache_row}
              ${reg_row}
            </TABLE>
          >
        ]
      }`

    return dot
  }
