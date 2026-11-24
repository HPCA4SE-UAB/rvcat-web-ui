<script setup>
  // Source code (usually C) of the program, above the table of instructions: a line with the source
  // lines that the instructions implement (unfolds into the whole code), how the compiler turned it
  // into this program (sourceNote) and the command (compile). Pointing a line of the source marks the
  // instructions that implement it, and pointing an instruction marks its lines (src/programSource.js)
  import { t, localized } from '@/i18n'
  import { computed, ref, watch } from 'vue'
  import { summaryLines, linkedLines } from '@/programSource'

  const props = defineProps({
    process: Object,
    marked:  { type: Array, default: () => [] },   // lines marked by the instruction pointed in the table
  })
  const emit = defineEmits(['hover'])   // lines pointed in the source ([] when the pointer leaves)

  const STORAGE_KEY = 'programSourceOpen'
  const open = ref(false)
  try { open.value = localStorage.getItem(STORAGE_KEY) === '1' } catch { /* closed */ }
  watch(open, (v) => { try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0') } catch { /* not kept */ } })
  const showCompile = ref(false)

  const code    = computed(() => String(props.process?.description ?? ''))
  const lines   = computed(() => code.value.replace(/\s+$/, '').split('\n'))
  const summary = computed(() => summaryLines(props.process))
  const linked  = computed(() => new Set(linkedLines(props.process)))
  const note    = computed(() => localized(props.process?.sourceNote) ?? '')
  const compile = computed(() => props.process?.compile ?? '')
  const isMarked = (n) => props.marked.includes(n)
</script>

<template>
  <div v-if="code.trim()" class="program-source" id="program-source" :class="{ open }">
    <div class="ps-bar">
      <button class="ps-toggle" id="program-source-toggle" @click="open = !open"
              :title="open ? t('Hide the source code') : t('Show the whole source code from which the program was generated')">
        {{ open ? '▾' : '▸' }} <span class="ps-lang">C</span>
      </button>
      <span v-if="!open" class="ps-summary" @click="open = true">
        <span v-for="s in summary" :key="s.line" class="ps-code"
              :class="{ linked: linked.has(s.line), marked: isMarked(s.line) }"
              @mouseenter="emit('hover', [s.line])" @mouseleave="emit('hover', [])">{{ s.text }}</span>
      </span>
    </div>
    <div v-if="note && !open" class="ps-note-inline" :title="note">{{ note }}</div>
    <template v-if="open">
      <pre class="ps-full" id="program-source-code"><span v-for="(l, i) in lines" :key="i" class="ps-line"
             :class="{ linked: linked.has(i + 1), marked: isMarked(i + 1) }"
             :title="linked.has(i + 1) ? t('Point it to mark the instructions that implement this line') : ''"
             @mouseenter="emit('hover', linked.has(i + 1) ? [i + 1] : [])"
             @mouseleave="emit('hover', [])"><span class="ps-num">{{ i + 1 }}</span>{{ l || ' ' }}</span></pre>
      <div v-if="note" class="ps-note" id="program-source-note">{{ note }}</div>
      <div v-if="compile" class="ps-compile">
        <button class="ps-toggle small" @click="showCompile = !showCompile"
                :title="t('Command that compiled the source code into this program')">
          {{ showCompile ? '▾' : '▸' }} {{ t('Compilation') }}
        </button>
        <code v-if="showCompile" class="ps-command" id="program-source-compile">{{ compile }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped>
  .program-source {
    margin: 4px 0 6px;
    padding: 3px 8px;
    background: #f7f9fc;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    font-size: 0.9rem;
  }
  .ps-bar { display: flex; align-items: baseline; gap: 0.5em; min-width: 0; }
  .ps-toggle {
    border: none; background: none; padding: 0 2px; cursor: pointer; color: #1f4e79; font-weight: 600;
    white-space: nowrap; flex: none;
  }
  .ps-toggle.small { font-weight: 500; font-size: 0.85rem; }
  .ps-lang {
    font-family: monospace; padding: 0 4px; border-radius: 3px; background: #1f4e79; color: #fff; font-size: 0.8rem;
  }
  .ps-summary {
    font-family: monospace; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    min-width: 0; flex: 1 1 auto;
  }
  .ps-code + .ps-code { margin-left: 1.2em; }
  .ps-note-inline {
    margin-left: 2.6em; color: #666; font-style: italic; font-size: 0.85em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ps-full {
    margin: 4px 0; padding: 4px 0; background: #fff; border-radius: 4px; font-size: 0.85rem; line-height: 1.4;
    overflow-x: auto;
  }
  .ps-line { display: block; padding-right: 8px; }
  .ps-num { display: inline-block; width: 2.2em; padding-right: 0.6em; text-align: right; color: #aaa; user-select: none; }
  .linked { cursor: default; border-radius: 3px; }
  .ps-line.linked:hover, .ps-code.linked:hover, .marked { background: #fff3c4; }
  .marked { box-shadow: inset 3px 0 0 #e0a800; }
  .ps-note { color: #555; font-style: italic; margin: 2px 0 2px 0.3em; }
  .ps-compile { margin: 2px 0; }
  .ps-command {
    display: block; margin: 2px 0 2px 1.2em; padding: 2px 6px; background: #fff; border-radius: 4px;
    font-size: 0.8rem; white-space: pre-wrap; overflow-wrap: anywhere; color: #333;
  }
</style>
