import { describe, it, expect } from 'vitest'
import { validateLesson, lessonResources, exportLesson, lessonTasks, completionCode, validStudentId,
         evaluateCondition, isLocked, normalizeLocks } from './lessons'

const stored = {
  'program.Base': { name: 'Base', instruction_list: [{ text: 'if c go back', type: 'BRANCH' }] },
  'processor.B4': { name: 'B4', dispatch: 4 },
  'tutorial.t1':  { name: 'T1', steps: [{ id: 'a', type: 'step' }, { id: 'q', type: 'question' },
                                        { id: 'p', type: 'predict' }, { id: 'g', type: 'goal' }, { id: 'o', type: 'goal', optional: true }] },
}
const storage = { get: (type, name) => stored[`${type}.${name}`] ?? null }
const lesson = {
  lesson: 'L1-test', title: 'Test', programs: ['Base', { name: 'Mine', instruction_list: [] }], processors: ['B4'],
  tutorial: 't1', start: { program: 'Base', processor: 'B4', N: 1000 },
  locks: { processor: ['dispatch'], N: { fixed: 1000 } }, completion: { secret: 'K7Q2X', idPattern: '^[0-9]{7}$' },
}

describe('lesson files', () => {
  it('validate the fields', () => {
    expect(validateLesson(lesson)).toEqual([])
    expect(validateLesson({ ...lesson, lesson: 'with space', programs: [] }).length).toBe(3)   // id, empty list, start program not listed
    expect(validateLesson({ ...lesson, start: { program: 'Other' } }).join()).toMatch(/not in "programs"/)
    expect(validateLesson({ ...lesson, locks: { processor: ['rob', 'colour'] } }).join()).toMatch(/locks.processor/)
  })

  it('resolve names and embedded objects, and export a self-contained copy', () => {
    const res = lessonResources(lesson, storage)
    expect(res.missing).toEqual([])
    expect(res.programs.map(r => [r.name, r.embedded])).toEqual([['Base', false], ['Mine', true]])
    expect(lessonResources({ ...lesson, processors: ['B9'] }, storage).missing).toEqual(['processor "B9"'])
    const out = exportLesson(lesson, storage)
    expect(out.programs[0]).toEqual(stored['program.Base'])
    expect(out.tutorial).toMatchObject({ id: 't1', name: 'T1' })
    expect(lessonResources(out, { get: () => null }).missing).toEqual([])   // no references left
  })

  it('list the tasks of the tutorial (questions, predictions and goals not optional)', () => {
    expect(lessonTasks(stored['tutorial.t1'])).toEqual(['q', 'p', 'g'])
  })
})

describe('completion code', () => {
  it('depends on the lesson, the student and the secret, not on case or spaces', () => {
    const code = completionCode('L1-test', '1234567', 'K7Q2X')
    expect(code).toMatch(/^\d{5}-\d{5}$/)
    expect(completionCode(' l1-TEST ', '1234567 ', 'k7q2x')).toBe(code)
    expect(completionCode('L1-test', '1234568', 'K7Q2X')).not.toBe(code)
    expect(completionCode('L1-test', '1234567', 'K7Q2Y')).not.toBe(code)
    // value computed by hand with the formula of the spreadsheet (regression)
    expect(completionCode('A', 'B', 'C')).toBe('20061-53428')
  })
  it('check the student identifier', () => {
    expect(validStudentId('1234567', '^[0-9]{7}$')).toBe(true)
    expect(validStudentId('123456', '^[0-9]{7}$')).toBe(false)
    expect(validStudentId('ana garcía')).toBe(false)
  })
})

describe('goal conditions', () => {
  const simState = { simulatedProcess: { name: 'V2', ROBsize: 32, latencies: { 'FLOAT.ADD': 2 } },
                     executionResults: { cycles_per_iteration: 2.1, ports: { 1: 80 } } }
  it('evaluate comparisons of live values', () => {
    expect(evaluateCondition('cyclesPerIter < 2.5', simState)).toMatchObject({ ok: true, values: { cyclesPerIter: 2.1 } })
    expect(evaluateCondition('cyclesPerIter < 2.5 && rob <= 16', simState).ok).toBe(false)
    expect(evaluateCondition('cyclesPerIter < 2 || rob * 2 == 64', simState).ok).toBe(true)
    expect(evaluateCondition('program == "V2" && {{port.P1}} >= 80', simState).ok).toBe(true)
    expect(evaluateCondition('!(latency.FLOAT.ADD > 1)', simState).ok).toBe(false)
  })
  it('are false when a value is missing or the text is wrong', () => {
    expect(evaluateCondition('ipc > 1', simState).ok).toBe(false)
    expect(evaluateCondition('cyclesPerIter <', simState)).toMatchObject({ ok: false, error: expect.any(String) })
  })
})

describe('locks', () => {
  const l = { locks: normalizeLocks(lesson.locks) }
  it('apply the locks of the lesson, except what the goal card allows', () => {
    expect(isLocked(null, 'programEditor')).toBe(false)
    expect(isLocked(l, 'tutorialEditor')).toBe(true)        // default in lessons
    expect(isLocked(l, 'loopTransforms')).toBe(true)
    expect(isLocked(l, 'programEditor')).toBe(false)
    expect(isLocked(l, 'processor.dispatch')).toBe(true)
    expect(isLocked(l, 'processor.rob')).toBe(false)
    expect(isLocked(l, 'N')).toBe(true)
    expect(isLocked(l, 'processor.dispatch', ['processor.dispatch'])).toBe(false)
    expect(isLocked({ locks: normalizeLocks({ processor: 'all' }) }, 'processor.rob', ['processor'])).toBe(false)
  })
})
