
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

// CVT converts to the type and size of the instruction (the destination): INT.CVT float -> int,
// FLOAT.CVT int -> float or single <-> double
export const typeOperations = {
    'INT':    ['ARITH', 'LOGIC', 'SHIFT', 'CVT'],
    'VINT':   ['ARITH', 'LOGIC', 'SHIFT', 'CVT', 'SHUFFLE', 'PERMUTE'],
    'MEM':    ['STORE', 'LOAD'],
    'VMEM':   ['STORE', 'LOAD'],
    'FLOAT':  ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT', 'CVT', 'CMP'],
    'VFLOAT': ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT', 'CVT', 'SHUFFLE', 'PERMUTE', 'CMP'],
    'BRANCH': []
  };

// SHUFFLE (VINT, VFLOAT) combines the lanes of one or two vector registers within each 128-bit
// block; PERMUTE moves them across 128-bit blocks (x86 AVX).
// Processors written before CVT or SHUFFLE existed get default values:
//   CVT:     3 cycles in the ports of FLOAT.ADD (VFLOAT.ADD for vector conversions)
//   SHUFFLE: 1 cycle in the ports of VINT.LOGIC (the vector integer ALU; float and integer shuffles
//            use the same ports, as in Intel processors)
//   PERMUTE: 3 cycles in the same ports as SHUFFLE
export const DEFAULT_CVT_LATENCY = 3
export const DEFAULT_SHUFFLE_LATENCY = 1
export const DEFAULT_PERMUTE_LATENCY = 3
const FALLBACK = {
  CVT:     { latency: DEFAULT_CVT_LATENCY, op: { INT: 'FLOAT.ADD', FLOAT: 'FLOAT.ADD', VINT: 'VFLOAT.ADD', VFLOAT: 'VFLOAT.ADD' } },
  SHUFFLE: { latency: DEFAULT_SHUFFLE_LATENCY, op: { VINT: 'VINT.LOGIC', VFLOAT: 'VINT.LOGIC' } },
  PERMUTE: { latency: DEFAULT_PERMUTE_LATENCY, op: { VINT: 'VINT.LOGIC', VFLOAT: 'VINT.LOGIC' } },
  // comparison of FLOAT data (result: an INT condition): ports and latency of the FP addition
  CMP:     { latency: null, op: { FLOAT: 'FLOAT.ADD', VFLOAT: 'VFLOAT.ADD' } },
}

// Latencies of each size were saved by older versions of the processor editor as "TYPE-OPER-size";
// the simulator reads "TYPE.OPER.size". Converts the old keys (in place) and returns the object.
export function normalizeLatencyKeys(latencies) {
  if (!latencies || typeof latencies !== 'object') return latencies
  for (const key of Object.keys(latencies)) {
    const m = /^([A-Z]+)-([A-Z]+)-([a-z]+)$/.exec(key)
    if (!m) continue
    const dotted = `${m[1]}.${m[2]}.${m[3]}`
    if (!(dotted in latencies)) latencies[dotted] = latencies[key]
    delete latencies[key]
  }
  return latencies
}

// ---- Execution ports of a processor ({ "0": ["INT", "FLOAT.ADD", ...], ... }) ----
export const MAX_PORTS = 10

// operations of a port entry: a whole type ("INT") stands for all its operations
const expandPortEntry = (entry) => (entry.includes('.') || !(typeOperations[entry] ?? []).length)
  ? [entry] : typeOperations[entry].map(op => `${entry}.${op}`)

// all the operations of the instruction types ("INT.ARITH", ..., "BRANCH")
export const allOperationNames = () => instructionTypes.flatMap(type =>
  (typeOperations[type] ?? []).length ? typeOperations[type].map(op => `${type}.${op}`) : [type])

// Operations that no port executes. CVT, SHUFFLE, PERMUTE and CMP without a port of their own use
// the ports of another operation (FALLBACK), so they only count when that one has no port either.
export function unassignedOperations(ports = {}) {
  const executed = new Set(Object.values(ports).flatMap(list => (list ?? []).flatMap(expandPortEntry)))
  return allOperationNames().filter(op => {
    if (executed.has(op)) return false
    const [type, oper] = op.split('.')
    const fallbackOp = oper ? FALLBACK[oper]?.op[type] : null
    return !(fallbackOp && executed.has(fallbackOp))
  })
}

// Ports after removing port `id`: the remaining ports are renumbered P0, P1, ... and the
// operations that only the removed port executed are assigned to P0.
export function removePortFrom(ports, id) {
  const removed  = (ports[id] ?? []).flatMap(expandPortEntry)
  const remaining = Object.keys(ports).filter(p => p !== String(id))
    .sort((a, b) => Number(a) - Number(b)).map(p => [...(ports[p] ?? [])])
  if (!remaining.length) return { ports: { ...ports }, moved: [] }
  const executed = new Set(remaining.flatMap(list => list.flatMap(expandPortEntry)))
  const moved = removed.filter(op => !executed.has(op))
  remaining[0].push(...moved)
  return { ports: Object.fromEntries(remaining.map((list, i) => [String(i), list])), moved }
}

const validLatency = (value) => (Number.isFinite(value) && value >= 1 ? value : undefined)

// Latency and port mask of an instruction in a processor (latencies, opToMask from its ports)
export function instructionTiming(instr, latencies = {}, opToMask = {}) {
  const keyOp = `${instr.type}.${instr.oper}`
  const fallback = FALLBACK[instr.oper]
  const fallbackOp = fallback?.op[instr.type] ?? null
  const latency =
    validLatency(latencies[`${keyOp}.${instr.size}`]) ??
    validLatency(latencies[`${instr.type}-${instr.oper}-${instr.size}`]) ??
    validLatency(latencies[keyOp]) ??
    (fallbackOp ? (fallback.latency ?? validLatency(latencies[fallbackOp]) ?? 1) : undefined) ??
    validLatency(latencies[instr.type]) ??
    1
  const ports = opToMask[keyOp] ?? (fallbackOp ? opToMask[fallbackOp] : undefined) ?? opToMask[instr.type] ?? 0
  return { latency, ports }
}

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

  if (program.N !== undefined &&
      (!Number.isSafeInteger(program.N) || program.N <= 0 || program.N > MAX_LOGICAL_ELEMENT_COUNT)) {
    addError(`Program N (algorithmic operations) must be an integer between 1 and ${MAX_LOGICAL_ELEMENT_COUNT}.`)
  }

  if (program.description !== undefined && typeof program.description !== 'string') {
    addError('Program description (source code of the loop) must be a string.')
  }

  if (program.vlen !== undefined && ![8, 16, 32, 64].includes(program.vlen)) {
    addError('Program vlen (vector register width) must be 8, 16, 32 or 64 bytes.')
  }

  if (program.declarations !== undefined) {
    if (!Array.isArray(program.declarations)) {
      addError('Program declarations must be a list.')
    } else {
      program.declarations.forEach((d, k) => {
        const where = `Declaration ${k + 1}: `
        if (!d || typeof d !== 'object' || typeof d.name !== 'string' || !d.name.trim()) {
          addError(where + 'must have a variable name.')
          return
        }
        if (d.type !== undefined && !['INT', 'FLOAT'].includes(d.type))
          addError(where + `type of ${d.name} must be INT or FLOAT.`)
        const sizes = d.type === 'FLOAT' ? ['single', 'double'] : d.type === 'INT' ? ['byte', 'word', 'long']
                                         : ['byte', 'word', 'long', 'single', 'double']
        if (d.size !== undefined && !sizes.includes(d.size))
          addError(where + `size of ${d.name} must be one of: ${sizes.join(', ')}.`)
        if (d.lanes !== undefined && !(Number.isSafeInteger(d.lanes) && d.lanes >= 1))
          addError(where + `lanes of ${d.name} must be a positive integer.`)
      })
    }
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
      if (index < program.instruction_list.length - 1) {    // conditional branch "if c skip k"
        const n = program.instruction_list.length
        const k = Number(String(instruction.constant ?? '').trim() || 1)
        if (!Number.isInteger(k) || k < 1 || index + k > n - 2)
          addInstructionError(`a conditional branch skips k ≥ 1 instructions of the loop body (constant), at most ${n - 2 - index}.`)
        for (const field of ['prob', 'mispredict']) {
          const v = instruction[field]
          if (v !== undefined && v !== null && v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1))
            addInstructionError(`${field} of a conditional branch must be a number between 0 and 1.`)
        }
      }
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

    if (instruction.mask !== undefined && instruction.mask !== '' &&
        (typeof instruction.mask !== 'string' || instruction.type !== 'VMEM' || instruction.oper !== 'STORE')) {
      addInstructionError('only a vector store (VMEM.STORE) can have a mask.')
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

  // the loop branch is the final instruction; other BRANCH instructions are conditional ("if c skip k")
  const finalIsBranch = program.instruction_list.at(-1)?.type === 'BRANCH'
  if (!branches.length) {
    addError('Program must contain a BRANCH instruction.')
  } else if (!finalIsBranch) {
    addError('The BRANCH instruction must be the final instruction.')
  }

  if (options.logicalElementCount !== undefined) {
    // A program with its own N is checked with it (it becomes the current N when uploaded)
    const logicalElementCount = Number.isSafeInteger(program.N) && program.N > 0
      ? program.N : options.logicalElementCount
    if (!Number.isSafeInteger(logicalElementCount) ||
        logicalElementCount <= 0 ||
        logicalElementCount > MAX_LOGICAL_ELEMENT_COUNT) {
      addError(
        `Logical element count must be between 1 and ${MAX_LOGICAL_ELEMENT_COUNT}.`
      )
    } else if (finalIsBranch) {
      const branch = program.instruction_list.at(-1)
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
    const portMask = instructionTiming(instruction, process.latencies ?? {}, opToMask).ports
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
    case "x": return "Squashed: wrong path of a mispredicted branch";
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

    // Latency (TYPE.OPER.size, TYPE.OPER, TYPE) and ports (TYPE.OPER, TYPE)
    const timing  = instructionTiming(instr, latencies ?? {}, opToMask)
    instr.latency = timing.latency
    instr.ports   = timing.ports

    if (instr.ports === 0) {
      console.warn(`⚠️ No ports found for instruction ${index} (${instr.type}.${instr.oper}). Check processor configuration.`)
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

// options.collapsed: hide the operation types of the ports (only their headers are shown)
export function get_processor_dot(process, allowEdit, highlightPort = -1, options = {}) {

    const ports    = process.ports
    const lat      = process.latencies
    const port_ids = Object.keys(ports)
    const ROBsize  = process.ROBsize || 20
    const bPenalty = process.bPenalty ?? 5
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

    const max_rows   = Math.max(0, ...Object.values(port_ops).map(o => o.length))
    const total_rows = options.collapsed ? 0 : max_rows


    const unassigned = allowEdit ? unassignedOperations(ports) : []   // warning row below

    // ---- Dispatch + ROB ----
    const click = allowEdit ? ' Click to edit it.' : ''
    let decode_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="dispatch" TITLE="Dispatch width: up to ${dispatch} instruction(s) per cycle enter the ROB and the waiting buffer, in program order.${click}"><FONT POINT-SIZE="20">🔄&nbsp;<B>Dispatch:&nbsp;</B>&nbsp;${dispatch}/cycle</FONT></TD>
      <TD ROWSPAN="${total_rows + 6 + (unassigned.length ? 1 : 0)}" BGCOLOR="#f0f0f0" HREF="#" ID="rob" CELLPADDING="10" TITLE="ROB (reorder buffer): up to ${ROBsize} instructions in flight, from dispatch to retire; when it is full, dispatch stops.${click}" ALIGN="CENTER" VALIGN="MIDDLE"><FONT POINT-SIZE="20">🔄<BR/><BR/><B>ROB</B><BR/><BR/><B>${ROBsize}</B></FONT><BR/><FONT POINT-SIZE="16">entries</FONT></TD>
    </TR>`

    // ---- Waiting Buffer (the scheduler policy is an option of the simulation) ----
    // (the editable panel shows controls: hide/show the operation types, add a port)
    // (and warns about operations that no port executes: their instructions cannot be simulated)
    const toggleText = options.collapsed ? `▼&nbsp;show operation types (${max_rows} rows)` : '▲&nbsp;hide operation types'
    const toggleCell = (span) => `<TD COLSPAN="${span}" BGCOLOR="#e8eef6" HREF="#" ID="toggleops" TITLE="${options.collapsed ? 'Show' : 'Hide'} the operation types that each port executes"><FONT POINT-SIZE="16">${toggleText}</FONT></TD>`
    const warnRow = unassigned.length
      ? `<TR><TD COLSPAN="${port_ids.length}" BGCOLOR="#fff3cd" HREF="#" ID="unassigned" TITLE="No port executes ${unassigned.join(', ')}: programs that use ${unassigned.length > 1 ? 'them' : 'it'} cannot be simulated. Click a port header to insert ${unassigned.length > 1 ? 'them' : 'it'}."><FONT POINT-SIZE="16" COLOR="#8a5a00">⚠&nbsp;${unassigned.length} operation type${unassigned.length > 1 ? 's' : ''} without port</FONT></TD></TR>`
      : ''
    const addCell = port_ids.length < MAX_PORTS
      ? `<TD BGCOLOR="#e8eef6" HREF="#" ID="addport" TITLE="Add a new execution port (then click its header to insert operation types)"><FONT POINT-SIZE="16">＋&nbsp;port</FONT></TD>`
      : `<TD BGCOLOR="#eeeeee" HREF="#" ID="maxports" TITLE="At most ${MAX_PORTS} execution ports"><FONT POINT-SIZE="16" COLOR="#888888">${MAX_PORTS} ports</FONT></TD>`
    let wb_row = allowEdit
      ? (port_ids.length >= 2
          ? `<TR>${toggleCell(port_ids.length - 1)}${addCell}</TR>`
          : `<TR>${toggleCell(port_ids.length)}</TR>`) + warnRow
      : `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" ID="sched" TITLE="Instructions wait here for their operands and a free port"><FONT POINT-SIZE="20"><B>Waiting Buffer</B></FONT></TD>
    </TR>`

    // ---- Port headers ----
    let port_header = "<TR>"

    for (let p of port_ids) {
      const isHighlighted = (p === highlight)
      const style = isHighlighted
        ? ' BGCOLOR="#ffcccc" BORDER="1" COLOR="red"'
        : ' BGCOLOR="#f5f5f5"'

      const safePort = escapeHtml(p)
      const nOps = (ports[p] ?? []).length
      port_header += `<TD ${style} HREF="#" ID="port:${safePort}" TITLE="Port P${safePort}: executes ${nOps} operation type(s), one instruction per cycle.${allowEdit ? ' Click to insert an operation type or remove the port.' : ''}"><FONT POINT-SIZE="20"><B>P${safePort}</B></FONT></TD>`
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
        const tooltip = latency_tooltip(op.label) + (allowEdit ? `\nClick to edit the latency, or to move or remove ${op.label} from P${p}.` : '')
        const safeLabel = escapeHtml(op.label)
        const safeTooltip = escapeHtml(tooltip)

        op_rows += `
          <TD BGCOLOR="${color}" TITLE="${safeTooltip}" HREF="#" ID="op:${escapeHtml(p)}:${i}:${safeLabel}" ${highlightAttr}><FONT POINT-SIZE="${op.big ? 18 : 16}">${op.big ? `<B>${safeLabel}</B>` : safeLabel}</FONT></TD>`
      }

      op_rows += "</TR>"
    }

    let cacheEdit = CacheBlocks > 0
      ? `L1 data cache: ${CacheBlocks} blocks of ${CacheBlockSize} bytes; a miss costs ${CachePenalty} cycles, memory accepts a request every ${CacheIssueTime} cycle(s); ${FillBuffers} fill and ${WriteBuffers} write buffers; ${ReturnThroughput} return(s) per cycle.`
      : 'No cache: every memory access takes the latency of its instruction.'
    if (allowEdit)
      cacheEdit += ' Click repeatedly to edit each parameter (0 blocks: no cache).'

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

    // ---- Branch misprediction penalty ----
    let penalty_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="bpenalty" TITLE="Branch penalty: ${bPenalty} cycles to refill the front-end after a mispredicted conditional branch (if c skip k) resolves.${click}"><FONT POINT-SIZE="20">🔄&nbsp;<B>Branch penalty:&nbsp;</B>&nbsp;&nbsp;${bPenalty} cycles</FONT></TD>
    </TR>`

    // ---- Retire ----
    let reg_row = `<TR>
      <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="retire" TITLE="Retire width: up to ${retire} completed instruction(s) per cycle leave the ROB in program order, updating the architected registers.${click}"><FONT POINT-SIZE="20">🔄&nbsp;<B>Retire:&nbsp;</B>&nbsp;${retire}/cycle</FONT></TD>
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
              ${penalty_row}
              ${reg_row}
            </TABLE>
          >
        ]
      }`

    return dot
  }
