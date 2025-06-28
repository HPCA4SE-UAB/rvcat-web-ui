<template>
  <div class='main'>
    <div class="header">
      <h3>About</h3>
    </div>

      <p>
          RVCAT (RISC-V Code Analysis Tool) is an educational simulation tool that demonstrates how processor architecture impacts the execution performance of program loops.
      </p>
      <p>
          RVCAT and its web interface (RVCAT-Web) have been developed on
          the Computer Architecture and Operating Systems (CAOS) Department of
          the Universitat Autònoma de Barcelona (UAB) by Saul Adserias,
          Quim Aguado Puig, Bern Vich Susanna, and Juan C. Moure.
      </p>
      <p>
          The simulator and web interface are still under active
          development. If you find any bugs or want to help improving the
          tools (for example, as part of a final degree project), please
          contact your professors.
      </p>
      <p>
          <b>The RVCAT developers © 2025</b>
      </p>
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
