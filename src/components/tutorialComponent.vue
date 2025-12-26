<script setup>
  import { ref, computed} from 'vue';

  const props = defineProps({
    position: {
      type: Object,
      default: () => ({ top: '50%', left: '50%' }),
    },
    text: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: '',
    }
  });

  const emit    = defineEmits(['close']);
  const visible = ref(true);

  const positionStyle = computed(() => ({
    position: 'absolute',
    top:      props.position.top,
    left:     props.position.left,
  }));

  function close() {
    visible.value = false;
    emit('close');
  }
</script>

<template>
  <div v-if="visible" class="tutorial-overlay" @click.self="close">
    <div class="tutorial-dialog" :style="positionStyle">
      <b>Help - {{title}}</b>
      <button class="close-button" @click="close">x</button>
      <div class="dialog-content" v-html="text"></div>
    </div>
  </div>
</template>

<style scoped>
  .tutorial-overlay {
    top:  0;
    left: 0;
    width:  100vw;
    height: 100vh;
    position: fixed;
    display:  flex;
    z-index:  1000;
    background: rgba(0,0,0,0.5);
    justify-content: center;
    align-items:     center;
  }

  .tutorial-dialog {
    background: #ffffff;
    padding:    24px 28px;
    position:   relative;
    max-width:  32rem;
    width:      100%;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    font-family: system-ui, -apple-system, BlinkMacSystemFont,
               "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .close-button {
    position:   absolute;
    top:        12px;
    right:      12px;
    background: none;
    border:     none;
    font-size:  1.2rem;
    color:      #666;
    cursor:     pointer;
  }
  
  .close-button:hover {
    color: #000;
  }
  
  .dialog-content {
    margin-top:  12px;
    font-size:   0.9rem;
    line-height: 1.6;
    text-align:  left; 
    color:       #333;
  }
</style>
