import { createApp, reactive } from 'vue'
import App                     from './App.vue'

const app = createApp(App)

// Options of the simulation (not of the processor): instruction scheduler, and what the processor does
// after a mispredicted conditional branch ("stall": stop dispatch; "wrong-path": execute the wrong path)
function loadSimulationSettings() {
  const settings = { sched: 'optimal', speculation: 'stall' }
  try { Object.assign(settings, JSON.parse(localStorage.getItem('simulationSettings') ?? '{}')) } catch { /* defaults */ }
  if (!['optimal', 'greedy'].includes(settings.sched)) settings.sched = 'optimal'
  if (!['stall', 'wrong-path'].includes(settings.speculation)) settings.speculation = 'stall'
  return settings
}

// Create reactive state: data shared between components; changes provoke reactions
const SimulationState = reactive({
  // 0: uninitialized, 1: RVCAT imported, 2: processor-loaded, 3: program-loaded, 4: tutorials-loaded, 5: new-tutorial edited
  state:                0,
  processorName:       '',
  instrHighlightedIdx: -1,
  highlightedPort:     -1,
  timelineCriticalPathEnabled: false,
  timelineCriticalPathPercentages: null,
  simulatedProcess:    {},
  executionResults:    {},
  performanceAnalysis: null,                               // last static analysis (tutorial live values)
  analysisView:        { graphOpen: false, chain: null },  // dependence graph window and selected chain
  lesson:              null,      // lesson in progress (LessonPanel): resources, locks, tasks, progress
  simulationBlocked:   '',        // reason why a tutorial card does not allow simulating now
  lessonAllow:         [],        // locks lifted by the goal card shown (e.g. "processor.rob")
  lessonTutorial:      null,      // { id, action: start|stop, nonce }: the lesson drives its tutorial
  reloadNonce:         0,         // changed to reload the current program and processor from storage
  programSaved:        null,      // { name, nonce }: program saved in the program editor
  simulationSettings:  loadSimulationSettings()
})

app.provide('simulationState', SimulationState)

app.mount('#app')
