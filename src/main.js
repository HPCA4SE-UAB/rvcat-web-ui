import { createApp, reactive } from 'vue'
import App                     from './App.vue'
import router                  from './router'
import { useWorker }           from './useWorker'

const app = createApp(App)

// Create reactive state: data shared between components; changes provoke reactions
const SimulationState = reactive({
  RVCAT_imported:     false,
  ROBsize:            20,
  selectedProcessor:  '',
  selectedProgram:    ''
})

app.use(router)

app.provide('simulationState', SimulationState)
app.provide('worker', useWorker())

app.mount('#app')
