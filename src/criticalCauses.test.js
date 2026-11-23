import { describe, expect, it } from 'vitest'
import { criticalCauses } from './criticalCauses'
import { findLastRetiredInstructionIndex } from './criticalPath'
import latency from './fixtures/timeline-latency.json'
import ports from './fixtures/timeline-ports.json'
import memory from './fixtures/timeline-memory.json'
import dynamic from './fixtures/timeline-dynamic.json'

// timelines of RVCAT (src/fixtures): the recurrence of a sum; two loads and one load port; misses with
// one fill buffer and a small ROB, with the static and the dynamic dispatch
const path = ({ timeline }) =>
  criticalCauses(timeline, findLastRetiredInstructionIndex(timeline.instructions, timeline.cycles))
const kinds = (p) => new Set(p.links.map(l => l.kind))

describe('critical path from the causes', () => {
  for (const [name, data] of Object.entries({ latency, ports, memory, dynamic })) {
    it(`${name}: goes back to the start and explains every cycle`, () => {
      const p = path(data)
      expect(p).not.toBeNull()
      expect(p.gaps).toBe(0)
      expect(p.cells.get(0)?.has(0)).toBe(true)          // the dispatch of the first instruction
      for (const l of p.links) {                         // always backwards
        expect(l.from.col <= l.to.col).toBe(true)
        expect(l.from.col < l.to.col || l.from.row < l.to.row).toBe(true)
      }
    })
  }
  it('the recurrence of a sum: a chain of data links', () => {
    expect(kinds(path(latency)).has('data')).toBe(true)
  })
  it('one load port for two loads: the port is on the path', () => {
    expect(kinds(path(ports)).has('port')).toBe(true)
  })
  it('misses with one fill buffer and a small ROB', () => {
    for (const data of [memory, dynamic]) {
      const k = kinds(path(data))
      expect(k.has('fill') || k.has('rob') || k.has('block')).toBe(true)
    }
  })
})
