import { createApp, reactive } from 'vue'
import App                     from './App.vue'
import router                  from './router'
import { useWorker }           from './useWorker'
import { useRVCAT_Api }        from './rvcatAPI';

const app = createApp(App)

// Create reactive state: data shared between components; changes provoke reactions
const SimulationState = reactive({
  ROBsize:            100,
  selectedProcessor:   '',
  availableProcessors: [],
  selectedProgram:     '',
  availablePrograms:   []
})

app.use(router)

app.provide('simulationState', SimulationState)
app.provide('worker', useWorker())
app.provide('rvcat',  useRVCAT_Api())

app.mount('#app')
