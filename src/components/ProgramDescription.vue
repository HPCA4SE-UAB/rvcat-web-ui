<script setup>
  import { t } from '@/i18n'
  // Source code of the loop (usually C) from which the program was generated. It is saved in the
  // program JSON ("description") and shown in the header of the Program panel.
  import { reactive, watch } from 'vue'

  const model = defineModel({ type: String, default: '' })

  const STORAGE_KEY = 'programDescriptionOptions'
  const options = reactive({ open: false })
  try { Object.assign(options, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')) } catch { /* defaults */ }
  watch(options, () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)) } catch { /* not persisted */ }
  })
</script>

<template>
  <div class="program-description" id="program-description">
    <div class="desc-header">
      <button class="desc-toggle" id="program-description-toggle" @click="options.open = !options.open"
              :title="t('Show/hide the source code (e.g. C) of the loop from which the program was generated. It is saved with the program and shown in the header of the Program panel')">
        {{ options.open ? '▾' : '▸' }} Source code
      </button>
      <span v-if="!options.open" class="desc-summary">
        {{ model.trim() ? model.trim().split('\n')[0] : 'none' }}
      </span>
    </div>
    <textarea v-if="options.open" v-model="model" id="program-description-text" spellcheck="false"
              rows="7" placeholder="for (int i = 0; i < N; i++)&#10;  sum += V[i] + W[i];"
              :title="t('Source code of the loop (e.g. C), saved with the program')"></textarea>
  </div>
</template>

<style scoped>
  .program-description {
    flex-shrink:   0;
    margin-top:    4px;
    border:        1px solid #ddd;
    border-radius: 5px;
    font-size:     small;
  }
  .desc-header {
    display:     flex;
    align-items: center;
    gap:         1.2em;
    padding:     2px 6px;
    min-width:   0;
  }
  .desc-toggle {
    background:  none;
    border:      none;
    padding:     2px 0;
    font-weight: 600;
    font-size:   small;
    color:       #0b2e5c;
    cursor:      pointer;
    flex-shrink: 0;
  }
  .desc-summary {
    color:         #555;
    font-family:   monospace;
    white-space:   nowrap;
    overflow:      hidden;
    text-overflow: ellipsis;
  }
  textarea {
    display:     block;
    width:       calc(100% - 12px);
    margin:      0 6px 6px;
    box-sizing:  border-box;
    font-family: monospace;
    font-size:   13px;
    tab-size:    4;
    resize:      vertical;
  }
</style>
