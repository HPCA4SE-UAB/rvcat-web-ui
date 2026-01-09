import { createApp, reactive }   from 'vue'
import { createPinia } from 'pinia'
import App             from './App.vue'
import router          from './router'

const app = createApp(App)

// Create reactive state BEFORE mounting
const SimulationState = reactive({
  ROBsize:            100,
  selectedProcessor:   '',
  availableProcessors: [],
  selectedProgram:     '',
  availablePrograms:   []
})

app.use(createPinia())
app.use(router)

// Provide reactive state to all components
app.provide('simulationState', SimulationState)

app.mount('#app')
