import { createApp, reactive } from 'vue'
import App                     from './App.vue'
import router                  from './router'
import { useWorker }           from './useWorker'

const app = createApp(App)

// Create reactive state: data shared between components; changes provoke reactions
const SimulationState = reactive({
  // 0: uninitialized, 1: RVCAT imported, 2: processor-loaded, 3: program-loaded, 4: tutorials-loaded, 5: new-tutorial edited
  state:               0,  
  ROBsize:            20,
  selectedProcessor:  '',
  selectedProgram:    ''
})

app.use(router)

app.provide('simulationState', SimulationState)
app.provide('worker', useWorker())

app.mount('#app')
