import { createApp, reactive }   from 'vue'
import { createPinia } from 'pinia'
import App             from './App.vue'
import router          from './router'

const app = createApp(App)

// Create reactive state BEFORE mounting
const robState = reactive({
  ROBsize: 10
})

app.use(createPinia())
app.use(router)

// Provide reactive state to all components
app.provide('robState', robState)

app.mount('#app')
