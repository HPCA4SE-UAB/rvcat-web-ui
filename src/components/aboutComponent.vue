<template>
  <div class='main'>
    <div class="header">
      <h3>About</h3>
    </div>
      <p>RVCAT (Code Analysis Tool) is an educational simulation tool that demonstrates how processor architecture impacts the execution performance of program loops.</p>
      <p>RVCAT has been developed on the Computer Architecture and Operating Systems (CAOS) Department of the Universitat Autònoma de Barcelona (UAB) by Saul Adserias, Quim Aguado, Bern Vich, Aleix Jorda and Juan C. Moure.</p>
      <p>The simulator is still under active development. If you find any bugs or want to help improving the tools, please contact us (JuanCarlos.Moure@uab.es).</p>
      <p>We want to thank the support from Santiago Marco and Carmen del Toro.
      <p><b>The RVCAT developers © 2026</b></p>
    </div>
</template>

<style scoped>
  .main{
    height: 100%;
    width: 100%;
    background: white;
    overflow: auto;
    padding: 5px;
    border-radius: 10px;
    position: relative;
  }
  .header{
    position:sticky;
    top:-5px;
    background:white;
    width:100%;
  }
  p{
    font-size: 2.5vh;
  }
</style>
