const GRAPH_STAGES = ['dispatch', 'execute', 'retire']

function getLongestPath(graph, targetNode) {
  const { node_count: nodeCount, source, dependencies_by_node: dependenciesByNode } = graph
  const distances = Array(nodeCount).fill(Number.NEGATIVE_INFINITY)
  const nextNodes = Array(nodeCount).fill(-1)
  const nextWeights = Array(nodeCount).fill(0)
  distances[targetNode] = 0

  for (let node = targetNode; node > source; node--) {
    for (const [dependency, weight] of dependenciesByNode[node]) {
      const candidateDistance = distances[node] + weight
      if (distances[dependency] < candidateDistance) {
        distances[dependency] = candidateDistance
        nextNodes[dependency] = node
        nextWeights[dependency] = weight
      }
    }
  }

  if (!Number.isFinite(distances[source]))
    throw new Error(`Critical-path graph has no path from source to node ${targetNode}.`)

  const path = [[targetNode, 1]]
  const sourceToSink = []
  let node = source
  while (node !== targetNode) {
    const next = nextNodes[node]
    if (next <= node)
      throw new Error('Critical-path graph cannot reconstruct a forward path.')
    sourceToSink.push([node, nextWeights[node]])
    node = next
  }
  path.push(...sourceToSink.reverse())
  return path
}

function validateGraph(graph, instructionRows) {
  if (!graph || graph.version !== 1)
    throw new Error('Unsupported or missing critical-path graph version.')
  if (!Number.isInteger(graph.dynamic_instruction_count) || graph.dynamic_instruction_count < 1)
    throw new Error('Critical-path graph has an invalid dynamic instruction count.')
  if (graph.node_count !== graph.dynamic_instruction_count * GRAPH_STAGES.length)
    throw new Error('Critical-path graph node count does not match its instruction count.')
  if (graph.source !== 0 || graph.sink !== graph.node_count - 1)
    throw new Error('Critical-path graph has invalid source or sink nodes.')
  if (!Array.isArray(graph.stages) || graph.stages.join(',') !== GRAPH_STAGES.join(','))
    throw new Error('Critical-path graph has an unsupported stage layout.')
  if (!Array.isArray(graph.dependencies_by_node) || graph.dependencies_by_node.length !== graph.node_count)
    throw new Error('Critical-path graph has an invalid dependency list.')
  if (!Array.isArray(instructionRows) || instructionRows.length !== graph.dynamic_instruction_count)
    throw new Error('Timeline rows do not match the critical-path graph.')

  graph.dependencies_by_node.forEach((dependencies, node) => {
    if (!Array.isArray(dependencies))
      throw new Error(`Critical-path graph node ${node} has invalid dependencies.`)
    dependencies.forEach(([dependency, weight]) => {
      if (!Number.isInteger(dependency) || dependency < 0 || dependency >= node
          || !Number.isFinite(weight)) {
        throw new Error(`Critical-path graph node ${node} has an invalid weighted dependency.`)
      }
    })
  })

  instructionRows.forEach((row, index) => {
    if (!Array.isArray(row) || typeof row[4] !== 'string')
      throw new Error(`Timeline row ${index} has an invalid state sequence.`)
  })
}

export function findLastRetiredInstructionIndex(instructionRows, visibleCycles) {
  for (let index = instructionRows.length - 1; index >= 0; index--) {
    const [,, startCycle, , states] = instructionRows[index]
    const retireOffset = states.lastIndexOf('R')
    const retireCycle = startCycle + retireOffset
    if (retireOffset >= 0 && retireCycle >= 0 && retireCycle < visibleCycles)
      return index
  }
  return null
}

export function computeInstructionCriticalPercentages(
  instructionRows,
  criticalCycles,
  visibleCycles,
  visibleInstructions,
  staticInstructionCount
) {
  const counts = Array(staticInstructionCount).fill(0)
  let totalCriticalCycles = 0

  for (let rowIndex = 0; rowIndex < visibleInstructions; rowIndex++) {
    const row = instructionRows[rowIndex]
    if (!row) continue
    const staticIndex = row[1]
    if (!Number.isInteger(staticIndex) || staticIndex < 0 || staticIndex >= staticInstructionCount)
      continue

    for (const cycleOffset of criticalCycles[rowIndex] ?? []) {
      const cycle = row[2] + cycleOffset
      if (Number.isInteger(cycleOffset) && cycle >= 0 && cycle < visibleCycles) {
        counts[staticIndex]++
        totalCriticalCycles++
      }
    }
  }

  if (!totalCriticalCycles) return null
  return counts.map(count => 100 * count / totalCriticalCycles)
}

export function computeCriticalCycles(graph, instructionRows, targetInstructionIndex = instructionRows.length - 1) {
  validateGraph(graph, instructionRows)
  if (!Number.isInteger(targetInstructionIndex)
      || targetInstructionIndex < 0
      || targetInstructionIndex >= instructionRows.length) {
    throw new Error('Critical-path target instruction index is out of range.')
  }
  const path = getLongestPath(graph, (targetInstructionIndex + 1) * GRAPH_STAGES.length - 1)
  const criticalCycles = []
  let pathIndex = path.length - 1

  for (let dynamicIndex = 0; dynamicIndex <= targetInstructionIndex; dynamicIndex++) {
    const stages = [...instructionRows[dynamicIndex][4]]
    const cycles = []
    if (!stages.length)
      throw new Error(`Timeline row ${dynamicIndex} has no state sequence.`)

    stages.shift()
    let node = path[pathIndex]
    if (node && Math.floor(node[0] / GRAPH_STAGES.length) === dynamicIndex && node[0] % 3 === 0) {
      if (node[1] === 1) cycles.push(0)
      pathIndex--
    }

    let cycle = 1
    while (stages[0] === '.') {
      stages.shift()
      cycle++
    }

    let executeCount = 0
    node = path[pathIndex]
    if (node && Math.floor(node[0] / GRAPH_STAGES.length) === dynamicIndex && node[0] % 3 === 1) {
      executeCount = node[1] - 1
      cycles.push(cycle)
      pathIndex--
    }

    while (stages.length && stages[0] !== 'R') {
      stages.shift()
      cycle++
      if (executeCount > 0) {
        executeCount--
        cycles.push(cycle)
      }
    }

    node = path[pathIndex]
    if (node && Math.floor(node[0] / GRAPH_STAGES.length) === dynamicIndex && node[0] % 3 === 2) {
      if (node[1] === 1) cycles.push(cycle)
      pathIndex--
    }

    criticalCycles.push(cycles)
  }

  if (pathIndex !== -1)
    throw new Error('Critical-path graph contains stages that could not be mapped to timeline rows.')

  while (criticalCycles.length < instructionRows.length)
    criticalCycles.push([])

  return criticalCycles
}
