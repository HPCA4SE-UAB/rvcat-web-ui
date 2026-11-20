<script setup>
  // Window to configure the cache of the processor: every parameter at once, checked against its
  // limits (validateCacheConfig). It is modal: the simulator cannot be used until the window is
  // closed with Apply (only when everything is correct) or Cancel.
  import { reactive, computed, ref, onMounted, onUnmounted, nextTick } from 'vue'
  import { t } from '@/i18n'
  import { CACHE_FIELDS, CACHE_BLOCK_SIZES, validateCacheConfig, getAllowedCacheBlockSizes } from '@/common'
  import CacheDiagram from '@/components/CacheDiagram.vue'

  const props = defineProps({
    config:          { type: Object, required: true },   // current values of the processor
    instructionList: { type: Array,  default: () => [] }, // program: the largest memory access
  })
  const emit = defineEmits(['apply', 'cancel'])

  const values = reactive(Object.fromEntries(CACHE_FIELDS.map(f => [f.key, props.config[f.key]])))
  const errors = computed(() => validateCacheConfig(values, props.instructionList))
  const valid  = computed(() => Object.keys(errors.value).length === 0)
  const noCache = computed(() => Number(values.nBlocks) === 0)
  const allowedSizes = computed(() => getAllowedCacheBlockSizes(props.instructionList))
  const errorText = (key) => errors.value[key] ? t(errors.value[key].text, errors.value[key].args ?? {}) : ''

  const HELP = {
    nBlocks:       'Number of blocks of the cache (0: no cache, every access takes the latency of its instruction)',
    blkSize:       'Bytes of each block; it must hold the largest memory access of the program',
    mPenalty:      'Cycles from the request of a block to main memory until it arrives (at least the issue time)',
    mIssueTime:    'Minimum cycles between two transfers of main memory (its bandwidth)',
    nFillBuffers:  'Misses that can be in progress at the same time (blocks being filled)',
    nWriteBuffers: 'Evicted dirty blocks that can wait to be written to main memory',
    rThru:         'Waiting LOAD instructions that can receive their data from fill buffers in each cycle',
    nStoreBuffers: 'One entry per STORE (stores to the same block are not combined), from dispatch until it is written into the cache: a store retires without waiting for its block, and waits here; when it is full, dispatch stops',
  }

  function apply() {
    if (!valid.value) return
    const out = {}
    for (const f of CACHE_FIELDS) out[f.key] = Number(values[f.key])
    emit('apply', out)
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); emit('cancel') }
    if (e.key === 'Enter' && valid.value && e.target?.tagName !== 'SELECT') { e.preventDefault(); apply() }
  }
  const firstField = ref(null)
  const activeKey  = ref('')      // field being edited: its element is highlighted in the figure
  onMounted(() => { window.addEventListener('keydown', onKey, true); nextTick(() => firstField.value?.[0]?.focus()) })
  onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div class="cache-overlay" id="cache-config-overlay">
      <div class="cache-window" role="dialog" aria-modal="true" aria-labelledby="cache-config-title" id="cache-config-window">
        <h3 id="cache-config-title">{{ t('Cache of the processor') }}</h3>
        <CacheDiagram :values="values" :active="activeKey" />
        <table class="cache-fields">
          <tr v-for="(f, i) in CACHE_FIELDS" :key="f.key" :class="{ disabled: f.key !== 'nBlocks' && noCache, active: activeKey === f.key }"
              @mouseenter="activeKey = f.key">
            <th><label :for="`cache-${f.key}`" :title="t(HELP[f.key])">{{ t(f.label) }}</label></th>
            <td>
              <select v-if="f.key === 'blkSize'" :id="`cache-${f.key}`" v-model.number="values.blkSize" :disabled="noCache"
                      @focus="activeKey = f.key"
                      :class="{ invalid: errors.blkSize }" :title="t(HELP[f.key])">
                <option v-for="size in CACHE_BLOCK_SIZES" :key="size" :value="size" :disabled="!allowedSizes.includes(size)">{{ size }}</option>
              </select>
              <input v-else :id="`cache-${f.key}`" :ref="i === 0 ? 'firstField' : undefined" type="number" step="1"
                     :min="f.key === 'mPenalty' ? Math.max(1, Number(values.mIssueTime) || 1) : f.min" :max="f.max"
                     v-model="values[f.key]" :disabled="f.key !== 'nBlocks' && noCache" @focus="activeKey = f.key"
                     :class="{ invalid: errors[f.key] }" :title="t(HELP[f.key])" />
            </td>
            <td class="cache-note">
              <span v-if="errors[f.key]" class="cache-error">✖ {{ errorText(f.key) }}</span>
              <span v-else-if="f.key === 'nBlocks' && noCache" class="cache-hint">{{ t('No cache: every access takes the latency of its instruction') }}</span>
              <span v-else class="cache-hint">{{ t(HELP[f.key]) }}</span>
            </td>
          </tr>
        </table>
        <div class="cache-actions">
          <button class="cache-cancel" id="cache-config-cancel" @click="emit('cancel')" :title="t('Close the window without changing the cache')">{{ t('Cancel') }}</button>
          <button class="cache-apply" id="cache-config-apply" :disabled="!valid" @click="apply"
                  :title="valid ? t('Change the cache of the processor') : t('Correct the marked values first')">{{ t('Apply') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
  .cache-overlay {
    position:        fixed;
    inset:           0;
    z-index:         30000;           /* above the panels, the tutorial cards and the help */
    background:      rgba(0, 0, 0, 0.45);
    display:         flex;
    align-items:     center;
    justify-content: center;
  }
  .cache-window {
    background:    white;
    border-radius: 10px;
    padding:       18px 22px;
    width:         min(54rem, calc(100vw - 32px));
    max-height:    calc(100vh - 32px);
    overflow:      auto;
    box-shadow:    0 8px 30px rgba(0, 0, 0, 0.3);
  }
  h3 { margin: 0 0 6px; color: #0b2e5c; font-size: 1.25rem; }
  .cache-intro { margin: 0 0 12px; color: #444; }
  .cache-fields { border-collapse: collapse; width: 100%; }
  .cache-fields th { text-align: left; padding: 5px 12px 5px 0; white-space: nowrap; font-weight: 600; }
  .cache-fields td { padding: 5px 8px 5px 0; vertical-align: middle; }
  .cache-fields input, .cache-fields select {
    width:         5.5rem;
    font-size:     1rem;
    padding:       3px 6px;
    border:        1px solid #9db7e3;
    border-radius: 5px;
  }
  .cache-fields .invalid { border-color: #c62828; background: #fff0f0; }
  .cache-fields tr.disabled th { color: #888; }
  .cache-fields tr.active th { color: #1a4fb3; }
  .cache-fields th, .cache-fields td { padding-top: 3px !important; padding-bottom: 3px !important; }
  .cache-note { font-size: 0.875rem; }
  .cache-hint  { color: #555; }
  .cache-error { color: #b3261e; font-weight: 600; }
  .cache-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
  .cache-apply, .cache-cancel {
    padding: 6px 18px; border-radius: 6px; font-size: 1rem; font-weight: 700; cursor: pointer;
  }
  .cache-apply  { border: none; background: #1a4fb3; color: white; }
  .cache-apply[disabled] { opacity: 0.45; cursor: default; }
  .cache-cancel { border: 1px solid #9db7e3; background: white; color: #1a4fb3; }
</style>
