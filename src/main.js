import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import App             from './App.vue'
import router          from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use({
  install(app) {
    const robState = Vue.reactive({
      ROBsize: 10
    });
    
    // Make available globally
    app.config.globalProperties.$rob = robState;
    app.provide('robState', robState);
  }
});

app.mount('#app')
