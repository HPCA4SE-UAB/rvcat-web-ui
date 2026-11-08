<script setup>
  import { t } from '@/i18n'
  // Text area for tutorial texts: a small formatting toolbar (inserts HTML tags around the
  // selection) and a live preview that looks like the tutorial card.
  import { ref, nextTick } from 'vue'

  const props = defineProps({
    modelValue:  { type: String, default: '' },
    placeholder: { type: String, default: '' },
    title:       { type: String, default: '' },
  })
  const emit = defineEmits(['update:modelValue'])

  const area        = ref(null)
  const showPreview = ref(true)

  async function apply(transform) {
    const el = area.value
    const text = props.modelValue ?? ''
    const start = el.selectionStart ?? text.length
    const end   = el.selectionEnd ?? text.length
    const { value, selStart, selEnd } = transform(text, start, end)
    emit('update:modelValue', value)
    await nextTick()
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  }

  // <tag>selection</tag> (or the placeholder word when nothing is selected)
  const wrap = (before, after, placeholder = 'text') => apply((text, s, e) => {
    const inner = text.slice(s, e) || placeholder
    return {
      value:    text.slice(0, s) + before + inner + after + text.slice(e),
      selStart: s + before.length,
      selEnd:   s + before.length + inner.length,
    }
  })

  // Insert at the cursor
  const insert = (snippet) => apply((text, s, e) => ({
    value:    text.slice(0, s) + snippet + text.slice(e),
    selStart: s + snippet.length,
    selEnd:   s + snippet.length,
  }))

  const bold      = () => wrap('<b>', '</b>')
  const italic    = () => wrap('<i>', '</i>')
  const highlight = () => wrap('<span style="color:#e53935;font-weight:bold">', '</span>')
  const bullet    = () => insert('<br>&bull; ')
  const newLine   = () => insert('<br>')
</script>

<template>
  <div class="rich-text">
    <div class="rich-toolbar" role="toolbar" aria-label="Text format">
      <button type="button" @click="bold"      :title="t('Bold: key words (wraps the selected text in &lt;b&gt;)')"><b>B</b></button>
      <button type="button" @click="italic"    :title="t('Italic (wraps the selected text in &lt;i&gt;)')"><i>I</i></button>
      <button type="button" @click="highlight" :title="t('Highlight in red: the most important idea')"><span class="red">A</span></button>
      <button type="button" @click="bullet"    :title="t('New line with a bullet point')">&bull; Item</button>
      <button type="button" @click="newLine"   :title="t('Line break (&lt;br&gt;)')">↵ Line</button>
      <span class="rich-hint">{{ t('HTML allowed') }}</span>
      <label class="rich-preview-toggle" :title="t('Show how the text will look in the tutorial card')">
        <input type="checkbox" v-model="showPreview"> Preview
      </label>
    </div>
    <textarea ref="area" :value="modelValue" :placeholder="placeholder" :title="title"
              @input="emit('update:modelValue', $event.target.value)"></textarea>
    <div v-if="showPreview" class="rich-preview" aria-label="Preview">
      <div v-if="modelValue" v-html="modelValue"></div>
      <div v-else class="rich-empty">{{ t('(empty)') }}</div>
    </div>
  </div>
</template>

<style scoped>
  .rich-text {
    display:        flex;
    flex-direction: column;
    gap:            3px;
  }
  .rich-toolbar {
    display:     flex;
    flex-wrap:   wrap;
    align-items: center;
    gap:         4px;
  }
  .rich-toolbar button {
    min-width:     28px;
    padding:       1px 6px;
    border:        1px solid #c6d3ea;
    border-radius: 4px;
    background:    #f4f7fd;
    cursor:        pointer;
    font-size:     0.85em;
  }
  .rich-toolbar button:hover { background: #e3ebfa; }
  .red { color: #e53935; font-weight: bold; }
  .rich-hint { font-size: 0.75em; color: #888; margin-left: 4px; }
  .rich-preview-toggle { margin-left: auto; font-size: 0.8em; color: #444; }
  textarea { min-height: 5em; }
  .rich-preview {
    padding:       6px 10px;
    border:        1px dashed #c6d3ea;
    border-radius: 6px;
    background:    #fff;
    color:         #444;
    font-size:     0.95em;
    line-height:   1.6;
  }
  .rich-empty { color: #aaa; font-style: italic; }
</style>
