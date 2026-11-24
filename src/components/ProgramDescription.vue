<script setup>
  import { t, localized } from '@/i18n'
  // Source code of the loop (usually C) from which the program was generated. It is saved in the
  // program JSON ("description") and shown in the header of the Program panel.
  // Also how the compiler turned it into the program (note: a string, or { en, es, ca } that is kept
  // and only shown here) and the command that compiled it (src/programSource.js)
  import { computed, reactive, watch } from 'vue'

  const model   = defineModel({ type: String, default: '' })
  const note    = defineModel('note', { type: [String, Object], default: '' })
  const compile = defineModel('compile', { type: String, default: '' })
  const noteIsLocalized = computed(() => note.value !== null && typeof note.value === 'object')
  const noteText = computed({
    get: () => localized(note.value) ?? '',
    set: (v) => { if (!noteIsLocalized.value) note.value = v },
  })

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
    <template v-if="options.open">
      <label class="desc-field">
        <span>{{ t('Compiled as') }}</span>
        <input v-model="noteText" id="program-source-note-input" :disabled="noteIsLocalized"
               :placeholder="t('e.g. unrolled 4 times with 4 accumulators')"
               :title="noteIsLocalized ? t('Text in several languages: edit it in the JSON file of the program')
                                       : t('How the compiler turned the source code into this program (one sentence)')">
      </label>
      <label class="desc-field">
        <span>{{ t('Command') }}</span>
        <input v-model="compile" id="program-source-compile-input" spellcheck="false" class="mono"
               placeholder="gcc -O3 -march=native sum.c"
               :title="t('Command that compiled the source code into this program')">
      </label>
      <div class="desc-hint">{{ t('Each instruction can name the line of source code it implements (cLine, in the JSON file of the program).') }}</div>
    </template>
  </div>
</template>

<style scoped>
  .program-description {
    flex-shrink:   0;
    margin-top:    4px;
    border:        1px solid #ddd;
    border-radius: 5px;
    font-size:     0.875rem;
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
    font-size:   0.875rem;
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
  .desc-field { display: flex; align-items: center; gap: 0.6em; margin: 0 6px 4px; }
  .desc-field span { flex: 0 0 7em; color: #555; }
  .desc-field input { flex: 1 1 auto; min-width: 0; font-size: 0.875rem; }
  .desc-field input.mono { font-family: monospace; }
  .desc-hint { margin: 0 6px 6px; color: #777; font-size: 0.8rem; }
  textarea {
    display:     block;
    width:       calc(100% - 12px);
    margin:      0 6px 6px;
    box-sizing:  border-box;
    font-family: monospace;
    font-size:   0.875rem;
    tab-size:    4;
    resize:      vertical;
  }
</style>
