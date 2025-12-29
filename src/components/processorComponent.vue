<script setup>
  import { ref, nextTick } from 'vue'
  import TutorialComponent from '@/components/tutorialComponent.vue';

  const showTutorial     = ref(false);
  const tutorialPosition = ref({ top: '0%', left: '40%' });
  const infoIcon         = ref(null);

  function openTutorial() {
    nextTick(() => {
      const el = infoIcon.value
      if (el) {
        const r = el.getBoundingClientRect()
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
    <div class="header">
      <div class="section-title-and-info">
        <span ref="infoIcon" class="info-icon" @click="openTutorial" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Processor Pipeline</span>
      </div>
      
      <div id="settings-div">
        <select id="processors-list" name="processor-name" title="Select Processor" onchange="reloadRvcat();"></select>
        <div>
          <label for="rob-size"> ROB: </label>
          <input type="number" title="ROB size" id="rob-size" name="rob-size" min="1" max="200" value="100" onchange="reloadRvcat();">
        </div>
      </div>
    </div>

    <div class="cache-info" id="cache-info"></div>
    
    <div class="processor-info">
      <div class="pipeline-img" id="pipeline-graph"></div>
    </div>
    
    <TutorialComponent v-if="showTutorial" :position="tutorialPosition"
    text="Provides graphical visualization of the <strong>processor microarchitecture</strong> (pipeline) characteristics.
          <p>Modify the size of the <strong>ROB</strong> (ReOrder Buffer) or select a new <em>processor configuration</em> file from the list.
          Use the <strong>Processor</strong> tab to modify the microarchitectural parameters.</p>"
    title="Processor MicroArchitecture"
    @close="closeTutorial" />
    
  </div>
</template>

<style scoped>
  .pipeline-display {
    height:     100%;
    width:      100%;
    overflow:   hidden;
    background: white;
    padding:    5px;
    position:   relative;
    border-radius: 10px;
  }
  .processor-info {
    width:   100%;
    height:  100%;
    display: flex;
    align-items:     flex-start;
    justify-content: stretch;
  }
  /*
    display:         flex;
    justify-content: center;
    align-items:     center;
  */
  
  #processors-list {
    font-size: 2.2vh;
  }
  #rob-size {
    max-width: 40%;
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
    width:      30%;
    height:     10px;
    background: linear-gradient(to right, #00FF00, #FFFF00, #FF0000);
    position:   relative;
    border-radius: 5px;
  }
  #settings-div{
    justify-content: center;
    display:     flex;
    align-items: center;
    gap:         5px;
    font-size:   2.5vh;
  }
  .pipeline-img {
    flex:   1;
    width:  100%;
    height: 100%;
    overflow: hidden;
    display:  block;
    position: relative;
    margin:   0 auto;
    margin-top: 10%;
  }
  .pipeline-img svg {
    width:  100%;
    height: auto;
    top:    0;
    left:   0;
    max-width:  100%;
    max-height: 50%;
    display:    block;
    position:   absolute;
  }
  .cache-info {
    flex:          1;
    display:       flex;
    align-items:   center;
    padding:       4px 10px;
    background:    #f8f8f8;
    border-radius: 6px;
    margin-top:    5px;
    font-size:     0.9rem;
    justify-content: space-between;
  }
</style>
