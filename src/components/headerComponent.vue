<script setup>
// Props
const props = defineProps({
  activeView: {
    type: String,
    required: true
  }
});
// Emitted event
const emit = defineEmits([ 'requestSwitch' ]);
</script>

<template>
  <div id="top">
    <div class="header-title">
      <img src="/img/favicon.png" class="title-img">
      <h1>RVCAT-WEB</h1>
    </div>
    <nav>
      <ul>
        <li>
          <button
            class="blue-button"
            :class="{ active: activeView === 'simulationComponent' }"
            @click="emit('requestSwitch', 'simulationComponent')"
          >
            Simulation
          </button>
        </li>
        <li>
          <button
            class="blue-button"
            :class="{ active: activeView === 'staticAnalysisComponent' }"
            @click="emit('requestSwitch', 'staticAnalysisComponent')"
          >
            Static Analysis
          </button>
        </li>
        <li>
          <button
            class="blue-button"
            :class="{ active: activeView === 'timelineComponent' }"
            @click="emit('requestSwitch', 'timelineComponent')"
          >
            Timeline
          </button>
        </li>
        <li>
          <button
            class="blue-button"
            :class="{ active: activeView === 'procSettingsComponent' }"
            @click="emit('requestSwitch', 'procSettingsComponent')"
          >
            Processor
          </button>
        </li>
        <li>
          <button
            class="blue-button"
            :class="{ active: activeView === 'aboutComponent' }"
            @click="emit('requestSwitch', 'aboutComponent')"
          >
            About
          </button>
        </li>
      </ul>
    </nav>
  </div>
</template>

<style scoped>
#top {
  max-height: 5vh;
  width: 100vw;
  padding: 0.6%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #007acc;
  color: white;
  padding: 15px 20px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  box-sizing: border-box;
}

h1 {
  margin: 0;
  font-size: 4vh;
}

nav ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
}
nav ul li {
  margin: 0 5px;
}
.title-img {
  height: 4vh;
  margin-top: 0.25vh;
}
.header-title {
  display:flex;
  gap: 5px;
}
</style>
