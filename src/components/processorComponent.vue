<script setup>
  import { ref, nextTick } from 'vue'
  import TutorialComponent from '@/components/tutorialComponent.vue';

  const showTutorial     = ref(false);
  const tutorialPosition = ref({ top: '50%', left: '50%' });
  const infoIcon         = ref(null);

  function openTutorial() {
    nextTick(() => {
      const el = infoIcon.value
      if (el) {
        const r = el.getBoundingClientRect()
        tutorialPosition.value = {
          top: `${r.bottom}px`,
          left: `${r.right}px`
        }
        showTutorial.value = true
      }
    })
  }

  function closeTutorial() {
    showTutorial.value = false
  }
</script>

<template>
  <div class="pipeline-display">
    <div class="pipeline-header">
      <div class="section-title-and-info">
        <span ref="infoIcon" class="info-icon" @click="openTutorial" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <h3>Processor Pipeline</h3>
      </div>
      <div id="settings-div">
        <select id="processors-list" name="processor-name" onchange="reloadRvcat();">
        </select>
        <div>
          <label for="rob-size"> ROB: </label>
          <input type="number" id="rob-size" name="rob-size" min="1" max="1000" value="100" onchange="reloadRvcat();">
        </div>
        <!-- added info icon -->
      </div>
    </div>
    <div class="content">
      <div class="cache-info" id="cache-info"></div>
      <div class="processor-info">
        <div class="pipeline-img" id="pipeline-graph"></div>
      </div>
    </div>

    <TutorialComponent v-if="showTutorial" :position="tutorialPosition"
    text="Provides graphical visualization of the processor microarchitecture (pipeline) characteristics.
          Modify the size of the ROB (ReOrder Buffer) or select a new processor configuration file from the list.
          Use the 'Settings' tab to modify the microarchitectural parameters."
    title="Processor MicroArchitecture"
    @close="closeTutorial"
    />
  </div>
</template>

<style scoped>
  .pipeline-display {
    height: 100%;
    width: 100%;
    background: white;
    overflow: auto;
    padding: 5px;
    border-radius: 10px;
    position: relative;
  }

  /* Header Flexbox */
  .pipeline-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .processor-info {
    display: flex;
    justify-content: center;
  }

  #processors-list {
    font-size: 2.2vh;
  }

  #rob-size {
    max-width: 50%;
    font-size: 2.2vh;
  }

  table{
    display:none;
  }
  .scale-container {
    display: flex;
    justify-content: center; /* Center horizontally */
  }
  .color-scale {
    width: 30%;
    height: 10px;
    background: linear-gradient(to right, #00FF00, #FFFF00, #FF0000);
    border-radius: 5px;
    position: relative;
  }
  #settings-div{
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 5px;
    font-size: 2.5vh;
  }

  .pipeline-img{
    margin: 0 auto;
    margin-top: 10%;
  }
  .cache-info {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 10px;
    background: #f0f0f0;
    border-radius: 6px;
    margin-top: 5px;
    font-size: 2vh;
  }
  .content {
    height: 70%;
  }
</style>
