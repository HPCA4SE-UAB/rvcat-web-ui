import { describe, expect, it } from 'vitest'
import {
  createTutorialStepId,
  charToProcessingState,
  getAllowedCacheBlockSizes,
  getLargestMemoryAccessSize,
  getUnsupportedInstructions,
  get_processor_dot,
  getLogicalElementCount,
  migrateTutorialFlow,
  normalizeProgramDefaults,
  TUTORIAL_FLOW_VERSION,
  validateProgram
} from './common'

describe('timeline state tooltips', () => {
  it('uses concise English descriptions', () => {
    expect(charToProcessingState('-', null, null)).toBe('Wait for older instr. to retire')
    expect(charToProcessingState('.', null, null)).toBe('Wait: data dependency')
    expect(charToProcessingState('*', null, null)).toBe('Wait: port conflict')
    expect(charToProcessingState('^', null, null)).toBe('Wait: issue width full')
    expect(charToProcessingState('L', 2, 40)).toBe('Load addr 40 on P2')
  })
})

describe('program validation', () => {
  it('calculates the largest scalar and vector memory access in bytes', () => {
    expect(getLargestMemoryAccessSize([
      { type: 'MEM', size: 'long', lanes: 12 },
      { type: 'VMEM', size: 'word', lanes: 6 },
      { type: 'VMEM', size: 'byte', lanes: 32 },
      { type: 'FLOAT', size: 'double', lanes: 100 }
    ])).toBe(32)
  })

  it('only allows cache blocks that fit the largest memory access', () => {
    expect(getAllowedCacheBlockSizes([
      { type: 'MEM', size: 'long' },
      { type: 'VMEM', size: 'word', lanes: 6 }
    ])).toEqual([32, 64, 128])
    expect(getAllowedCacheBlockSizes([
      { type: 'VMEM', size: 'long', lanes: 17 }
    ])).toEqual([])
    expect(getAllowedCacheBlockSizes([])).toEqual([8, 16, 32, 64, 128])
  })

  it('defaults stride and lanes only on memory and branch instructions', () => {
    const program = {
      name: 'Defaults',
      instruction_list: [
        { type: 'MEM' },
        { type: 'VMEM', stride: 0, lanes: 4 },
        { type: 'FLOAT' },
        { type: 'BRANCH' }
      ]
    }

    expect(normalizeProgramDefaults(program).instruction_list).toEqual([
      { type: 'MEM', stride: 1, lanes: 1 },
      { type: 'VMEM', stride: 0, lanes: 4 },
      { type: 'FLOAT' },
      { type: 'BRANCH', stride: 1 }
    ])
    expect(program.instruction_list[0]).toEqual({ type: 'MEM' })
  })

  const validProgram = {
    name: 'SIMD example',
    instruction_list: [
      {
        text: 'tmp = V[i:i+3]',
        type: 'VMEM',
        oper: 'LOAD',
        size: 'word',
        source2: 'V',
        stride: 0,
        lanes: 4,
        constant: '-2'
      },
      {
        text: 'if c go back',
        type: 'BRANCH',
        oper: '',
        size: '',
        source1: 'c',
        stride: 4
      }
    ]
  }

  it('accepts a program with SIMD memory and one final branch', () => {
    expect(validateProgram(validProgram)).toEqual([])
  })

  it('rejects invalid structure, operation fields, and memory parameters', () => {
    const invalidProgram = {
      ...validProgram,
      instruction_list: [
        {
          ...validProgram.instruction_list[0],
          type: 'MEM',
          oper: 'FMA',
          size: 'single',
          source2: ' ',
          stride: 1.5,
          lanes: 0,
          constant: '1.2'
        },
        { ...validProgram.instruction_list[1], stride: 0 },
        { ...validProgram.instruction_list[1], stride: 1 }
      ]
    }

    const errors = validateProgram(invalidProgram)
    expect(errors).toContain('Instruction 1: oper must be one of: STORE, LOAD.')
    expect(errors).toContain('Instruction 1: size must be one of: byte, word, long.')
    expect(errors).toContain('Instruction 1: memory instructions must name an array in source2.')
    expect(errors).toContain('Instruction 1: stride must be a safe integer.')
    expect(errors).toContain('Instruction 1: lanes must be a positive safe integer.')
    expect(errors).toContain('Instruction 1: memory constant must be a safe integer offset.')
    expect(errors).toContain('Instruction 2: BRANCH stride must be between 1 and 5000.')
    expect(errors).toContain('Program must contain exactly one BRANCH instruction.')
  })

  it('requires the single branch to be the final instruction', () => {
    const program = {
      ...validProgram,
      instruction_list: [
        validProgram.instruction_list[1],
        validProgram.instruction_list[0]
      ]
    }

    expect(validateProgram(program)).toContain('The BRANCH instruction must be the final instruction.')
  })

  it('rejects loop strides outside the supported logical element range', () => {
    const program = {
      ...validProgram,
      instruction_list: [
        validProgram.instruction_list[0],
        { ...validProgram.instruction_list[1], stride: 5001 }
      ]
    }

    expect(validateProgram(program)).toContain(
      'Instruction 2: BRANCH stride must be between 1 and 5000.'
    )
  })

  it('rejects reverse memory access that passes before the array base', () => {
    const program = {
      ...validProgram,
      instruction_list: [
        { ...validProgram.instruction_list[0], stride: -2, lanes: 1 },
        { ...validProgram.instruction_list[1], stride: 1 }
      ]
    }

    expect(validateProgram(program, { logicalElementCount: 10 })).toContain(
      'Instruction 1: memory access for array "V" reaches before its base address at N=10.'
    )
  })

  it('rejects numeric values outside JavaScript safe integer range', () => {
    const program = {
      ...validProgram,
      instruction_list: [
        {
          ...validProgram.instruction_list[0],
          stride: Number.MAX_SAFE_INTEGER + 1,
          constant: '9007199254740992'
        },
        validProgram.instruction_list[1]
      ]
    }

    const errors = validateProgram(program)
    expect(errors).toContain('Instruction 1: stride must be a safe integer.')
    expect(errors).toContain('Instruction 1: memory constant must be a safe integer offset.')
  })

  it('finds instructions that have no matching processor port', () => {
    const process = {
      ports: { 0: ['VMEM.LOAD', 'BRANCH'] },
      instruction_list: [
        validProgram.instruction_list[0],
        { type: 'FLOAT', oper: 'ADD', size: 'single' },
        validProgram.instruction_list[1]
      ]
    }

    expect(getUnsupportedInstructions(process)).toEqual([
      { index: 1, instruction: process.instruction_list[1] }
    ])
  })
})

describe('logical element count', () => {
  it('uses the loop branch stride to recover the configured element count', () => {
    const scalarProgram = [
      { type: 'MEM', stride: 1, lanes: 1 },
      { type: 'BRANCH', stride: 1 }
    ]
    const simdProgram = [
      { type: 'VMEM', stride: 1, lanes: 4 },
      { type: 'BRANCH', stride: 4 }
    ]

    expect(getLogicalElementCount(scalarProgram, 100)).toBe(100)
    expect(getLogicalElementCount(simdProgram, 25)).toBe(100)
  })

  it('defaults the loop stride to one when there is no non-unit branch stride', () => {
    expect(getLogicalElementCount([{ type: 'BRANCH' }], 100)).toBe(100)
  })
})

describe('processor graph markup', () => {
  it('escapes operation data before inserting it into Graphviz HTML labels', () => {
    const dot = get_processor_dot({
      ports: { 0: ['INT.<"\'&'] },
      latencies: { 'INT.<"\'&': 2 },
      ROBsize: 20,
      sched: 'optimal'
    }, false)

    expect(dot).toContain('ID="op:0:0:INT.&lt;&quot;&#39;&amp;"')
    expect(dot).toContain('INT.&lt;&quot;&#39;&amp;</FONT>')
  })
})

describe('tutorial flow migration', () => {
  it('assigns stable ids and linear successors to legacy tutorials', () => {
    const migrated = migrateTutorialFlow({
      steps: [{ title: 'First' }, { title: 'Second' }, { title: 'Last' }]
    })

    expect(migrated.flowVersion).toBe(TUTORIAL_FLOW_VERSION)
    expect(migrated.steps.map(step => step.next)).toEqual([
      [migrated.steps[1].id],
      [migrated.steps[2].id],
      []
    ])
    expect(new Set(migrated.steps.map(step => step.id)).size).toBe(3)
  })

  it('preserves destinations in the current flow format', () => {
    const tutorial = {
      flowVersion: TUTORIAL_FLOW_VERSION,
      steps: [
        { id: 'a', next: ['c'] },
        { id: 'b', next: [] },
        { id: 'c', next: ['a', 'end'] }
      ]
    }

    expect(migrateTutorialFlow(tutorial).steps.map(step => step.next))
      .toEqual([['c'], [], ['a', 'end']])
  })

  it('rejects unknown, self-referencing, or duplicate destinations', () => {
    const makeTutorial = (next) => ({
      flowVersion: TUTORIAL_FLOW_VERSION,
      steps: [{ id: 'a', next }, { id: 'b', next: [] }]
    })

    expect(() => migrateTutorialFlow(makeTutorial(['missing']))).toThrow(/unknown successor/)
    expect(() => migrateTutorialFlow(makeTutorial(['a']))).toThrow(/self-link/)
    expect(() => migrateTutorialFlow(makeTutorial(['b', 'b']))).toThrow(/duplicate successor/)
    expect(() => migrateTutorialFlow(makeTutorial(['end', 'end']))).toThrow(/duplicate end destination/)
  })

  it('rejects unsupported flow versions instead of rewriting their links', () => {
    expect(() => migrateTutorialFlow({
      flowVersion: TUTORIAL_FLOW_VERSION + 1,
      steps: []
    })).toThrow(/Unsupported tutorial flow version/)
  })

  it('creates distinct step ids', () => {
    expect(createTutorialStepId()).not.toBe(createTutorialStepId())
  })
})
