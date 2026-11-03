<script setup>
  import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

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

  const emit      = defineEmits(['close']);
  const visible   = ref(true);
  const dialogRef = ref(null);
  const fittedPos = ref(null);   // position adjusted to keep the dialog inside the window

  const MARGIN = 8;   // px between the dialog and the window border

  const positionStyle = computed(() => ({
    position: 'absolute',
    top:      fittedPos.value?.top  ?? props.position.top,
    left:     fittedPos.value?.left ?? props.position.left,
  }));

  // Place the dialog at the requested position, then move it just enough to be fully visible
  async function fitInWindow() {
    fittedPos.value = null;
    await nextTick();
    const el = dialogRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(MARGIN, window.innerWidth  - rect.width  - MARGIN);
    const maxTop  = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    fittedPos.value = {
      left: `${Math.min(Math.max(rect.left, MARGIN), maxLeft)}px`,
      top:  `${Math.min(Math.max(rect.top,  MARGIN), maxTop)}px`,
    };
  }

  onMounted(() => {
    fitInWindow();
    window.addEventListener('resize', fitInWindow);
  });
  onUnmounted(() => window.removeEventListener('resize', fitInWindow));

  function close() {
    visible.value = false;
    emit('close');
  }
</script>

<template>
  <div v-if="visible" class="help-overlay" @click.self="close">
    <div ref="dialogRef" class="help-dialog" :style="positionStyle">
      <b>Help - {{title}}</b>
      <button class="close-button" @click="close">x</button>
      <div class="dialog-content" v-html="text"></div>
    </div>
  </div>
</template>

<style scoped>
  .help-overlay {
    top:    0;
    left:   0;
    inset:  0;
    width:  100vw;
    height: 100vh;
    position: fixed;
    display:  flex;
    z-index:  10000;
    background: rgba(0,0,0,0.5);
    justify-content: center;
    align-items:     center;
  }

  .help-dialog {
    background: #ffffff;
    padding:    0.8em 1.1em;
    position:   relative;
    box-sizing: border-box;
    width:      min(40rem, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    /* Text size adapts to the window: smaller on short or narrow screens */
    font-size:  clamp(13px, min(2.3vh, 3.2vw), 18px);
    font-family: system-ui, -apple-system, BlinkMacSystemFont,
               "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .close-button {
    position:   absolute;
    top:        0.5em;
    right:      0.6em;
    background: none;
    border:     none;
    font-size:  1.2em;
    color:      #666;
    cursor:     pointer;
  }

  .close-button:hover {
    color: #000;
  }

  .dialog-content {
    margin-top:  0.6em;
    font-size:   0.95em;
    line-height: 1.5;
    text-align:  left;
    color:       #333;
  }

  .dialog-content :deep(p) {
    margin: 0.5em 0;
  }

  /* Expandable sections: <details><summary>Topic</summary><p>...</p></details> */
  .dialog-content :deep(details) {
    margin:        0.3em 0;
    border-left:   3px solid #7aa2e3;
    padding-left:  0.6em;
  }
  .dialog-content :deep(summary) {
    cursor:      pointer;
    font-weight: 600;
    color:       #1a4fb3;
  }
  .dialog-content :deep(summary:hover) {
    text-decoration: underline;
  }
  .dialog-content :deep(details[open] > summary) {
    margin-bottom: 0.2em;
  }
</style>
