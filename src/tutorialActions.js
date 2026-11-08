// Actions of the tutorial cards on the simulator. A card has
//   actions: [...]   run when the card is shown (preparation: program, processor, N, panel)
//   showMe:  [...]   run by its "▶ Show me" button (exploration: the student can do it instead)
// (the old field "action" is a single action, run when the card is shown).
// Each action is a string "type:argument"; TUTORIAL_ACTIONS describes them (tutorial editor).

export const TUTORIAL_ACTIONS = [
  ['switchTo:PANEL',           'show a panel: simulationComponent, staticAnalysisComponent, timelineComponent, aboutComponent'],
  ['selectProgram:NAME',       'select a program of the list'],
  ['selectProcessor:NAME',     'select a processor of the list'],
  ['setN:NUMBER',              'set N (algorithmic operations)'],
  ['setOption:KEY=VALUE',      'simulation option: sched=optimal|greedy, speculation=stall|wrong-path'],
  ['runSimulation',            'run the simulation and wait for the results'],
  ['clickChain:VAR',           'select the latency bound of variable VAR (opens the dependence graph)'],
  ['openGraph',                'open the dependence graph window'],
  ['closeGraph',               'close the dependence graph window'],
  ['timeline:critical=on|off', 'timeline option: critical, ports, cache (on/off), or cycles=NUMBER'],
  ['expandPorts',              'show the operation types of the processor ports'],
  ['collapsePorts',            'hide the operation types of the processor ports'],
  ['setLatency:TYPE.OPER=N',   'change a latency of the current processor (all ports)'],
  ['revertProcessor',          'discard the changes made to the current processor'],
  ['click:SELECTOR',           'click an element of the page'],
  ['waitFor:SELECTOR',         'wait until an element is shown'],
  ['wait:MS',                  'wait some milliseconds'],
  ['restoreState',             'restore the program, processor, N and options of before the tutorial'],
  ['reveal:PART,PART',         'show parts of the simulator hidden by the lesson'],
  ['hide:PART,PART',           'hide parts of the simulator during the lesson'],
  ['setProcessor:FIELD=VALUE', 'change a parameter of the current processor: dispatch, retire, ROBsize, bPenalty, nBlocks...'],
]

// "type:argument" -> { type, arg, key, value } (key=value arguments are split)
export function parseAction(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  const i = s.indexOf(':')
  const type = (i < 0 ? s : s.slice(0, i)).trim()
  const arg  = i < 0 ? '' : s.slice(i + 1).trim()
  const eq = arg.indexOf('=')
  return { type, arg, key: eq < 0 ? arg : arg.slice(0, eq).trim(), value: eq < 0 ? '' : arg.slice(eq + 1).trim() }
}

// Lists of actions of a card: an array, or text with one action per line
export function actionList(value) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split('\n').map(s => s.trim()).filter(Boolean)
  return []
}

export const isKnownAction = (text) => {
  const a = parseAction(text)
  return !!a && TUTORIAL_ACTIONS.some(([pattern]) => pattern.split(':')[0] === a.type)
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function waitUntil(condition, timeout = 5000, step = 50) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { if (condition()) return true } catch { /* not ready */ }
    await sleep(step)
  }
  return false
}

// Executor of actions. ctx: { simState, switchPanel(name), snapshot: { save, restore } }
export function createActionRunner(ctx) {
  const { simState } = ctx
  const $ = (sel) => document.querySelector(sel)

  function clickElement(el) {
    if (!el) return false
    if (typeof el.click === 'function' && !(el instanceof SVGElement)) el.click()
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  }

  function selectOption(selector, value) {
    const el = $(selector)
    if (!el) return false
    if (![...el.options].some(o => o.value === value)) {
      console.warn(`👨‍🎓⚠️ ${selector} has no option "${value}"`)
      return false
    }
    if (el.value !== value) {
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  }

  async function switchPanel(name) {
    ctx.switchPanel(name)
    await sleep(250)
  }

  async function setTimelineToggle(id, on) {
    if (!await waitUntil(() => $(`#timeline-${id}`))) return
    const button = $(`#timeline-${id}`)
    const active = button.textContent.includes('✔') || button.classList.contains('active')
    if (active !== on) { clickElement(button); await sleep(300) }
  }

  async function setInput(selector, value) {
    const el = $(selector)
    if (!el) return
    el.value = String(value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur'))
    await sleep(200)
  }

  const handlers = {
    async switchTo(a)        { await switchPanel(a.arg) },
    async selectProgram(a) {
      if (selectOption('#programs-list', a.arg))
        await waitUntil(() => simState.simulatedProcess?.name === a.arg, 8000)
      await sleep(200)
    },
    async selectProcessor(a) {
      if (selectOption('#processors-list', a.arg))
        await waitUntil(() => simState.processorName === a.arg, 8000)
      await sleep(200)
    },
    async setN(a)            { await setInput('#program-iterations', a.arg) },
    async setOption(a) {
      if (simState.simulationSettings && a.key in simState.simulationSettings) simState.simulationSettings[a.key] = a.value
    },
    async runSimulation() {
      if (!$('#run-simulation-button')) await switchPanel('simulationComponent')
      if (!await waitUntil(() => $('#run-simulation-button') && !$('#run-simulation-button').disabled, 10000)) return
      const before = simState.executionResults
      clickElement($('#run-simulation-button'))
      await waitUntil(() => simState.executionResults && simState.executionResults !== before, 120000, 100)
      await sleep(700)     // the results diagram is drawn after the results arrive
    },
    async clickChain(a) {
      if (!$('#latency-bounds')) await switchPanel('staticAnalysisComponent')
      const sel = `#latency-bounds [data-chain="${a.arg}"]`
      if (!await waitUntil(() => $(sel), 8000)) return
      if (simState.analysisView?.chain !== a.arg) clickElement($(sel))
      await sleep(600)
    },
    async openGraph() {
      if (!simState.analysisView?.graphOpen && await waitUntil(() => $('#open-dependence-graph')))
        clickElement($('#open-dependence-graph'))
      await sleep(600)
    },
    async closeGraph() {
      if (simState.analysisView?.graphOpen && $('#open-dependence-graph')) clickElement($('#open-dependence-graph'))
      await sleep(200)
    },
    async timeline(a) {
      if (!$('#timeline-critical')) await switchPanel('timelineComponent')
      if (a.key === 'cycles') {
        await waitUntil(() => $('#timeline-cycles'))
        await setInput('#timeline-cycles', a.value)
      } else {
        await setTimelineToggle(a.key, a.value !== 'off')
      }
    },
    async expandPorts()   { await togglePorts(true) },
    async collapsePorts() { await togglePorts(false) },
    async setLatency(a) {
      const lat = simState.simulatedProcess.latencies ??= {}
      const value = Number(a.value)
      if (!a.key || !Number.isFinite(value)) return
      lat[a.key] = value
      for (const key of Object.keys(lat)) if (key.startsWith(`${a.key}.`)) lat[key] = value
      await sleep(300)
    },
    async revertProcessor() {
      clickElement($('#revert-processor-button'))
      await sleep(800)
    },
    async click(a)   { await waitUntil(() => $(a.arg)); clickElement($(a.arg)); await sleep(300) },
    async waitFor(a) { await waitUntil(() => { const el = $(a.arg); return el && el.getClientRects().length > 0 }, 10000) },
    async wait(a)    { await sleep(Number(a.arg) || 300) },
    async restoreState() { await ctx.snapshot?.restore() },
    async reveal(a) { setHidden(a.arg, false) },
    async hide(a)   { setHidden(a.arg, true) },
    async setProcessor(a) {
      const value = Number(a.value)
      if (a.key && Number.isFinite(value) && simState.simulatedProcess) simState.simulatedProcess[a.key] = value
      await sleep(300)
    },
  }

  // parts hidden by the lesson in progress (outside a lesson there is nothing to show or hide)
  function setHidden(arg, hidden) {
    const lesson = simState.lesson
    if (!lesson) return
    const parts = arg.split(',').map(s => s.trim()).filter(Boolean)
    const now = new Set(lesson.hidden ?? [])
    for (const p of parts) hidden ? now.add(p) : now.delete(p)
    lesson.hidden = [...now]
  }

  async function togglePorts(show) {
    const toggle = $('g[id="a_toggleops"]')
    if (!toggle) return
    const collapsed = /show/.test(toggle.textContent)
    if (collapsed === show) { clickElement(toggle); await sleep(500) }
  }

  // Runs the actions in order; unknown actions are reported and skipped
  return async function run(list) {
    for (const text of actionList(list)) {
      const a = parseAction(text)
      const handler = a && handlers[a.type]
      if (!handler) { console.warn(`👨‍🎓⚠️ Unknown tutorial action: ${text}`); continue }
      try {
        await handler(a)
      } catch (e) {
        console.error(`👨‍🎓❌ Tutorial action ${text} failed:`, e)
      }
    }
  }
}

// ---- State of the simulator before a tutorial with actions, restored when it ends ----
const SNAPSHOT_KEY = 'tutorialSnapshot'

export function takeSnapshot(simState, view, processorConfig) {
  const snapshot = {
    program:   simState.simulatedProcess?.name ?? '',
    processor: simState.processorName ?? '',
    N:         document.querySelector('#program-iterations')?.value ?? '',
    settings:  { ...(simState.simulationSettings ?? {}) },
    view,
    processorConfig,          // configuration of the processor (it may have unsaved changes)
  }
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot)) } catch { /* ignore */ }
  return snapshot
}

export function savedSnapshot() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null') } catch { return null }
}

export function clearSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY) } catch { /* ignore */ }
}
