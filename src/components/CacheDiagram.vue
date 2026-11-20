<script setup>
  // Schematic figure of the memory system of the processor, drawn with the values of the window of
  // the cache: the execution ports (LOAD, STORE), the store buffer, the L1 cache, the fill buffers,
  // the write buffers and the main memory, with the paths of the data. The element of the field
  // being edited (active) is highlighted.
  import { computed } from 'vue'
  import { t } from '@/i18n'

  const props = defineProps({
    values: { type: Object, required: true },   // nBlocks, blkSize, mPenalty, mIssueTime, nFillBuffers, nWriteBuffers, rThru, nStoreBuffers
    active: { type: String, default: '' },      // key of the field being edited
  })
  const v = (key) => props.values[key] === '' || props.values[key] === undefined ? '?' : props.values[key]
  const noCache = computed(() => Number(props.values.nBlocks) === 0)
  const PART = {
    nBlocks: 'cache', blkSize: 'cache', mPenalty: 'mm', mIssueTime: 'mm', nFillBuffers: 'fill',
    nWriteBuffers: 'write', rThru: 'return', nStoreBuffers: 'sb',
  }
  const hl = (part) => PART[props.active] === part
</script>

<template>
  <svg class="cache-diagram" viewBox="0 0 792 290" role="img" id="cache-diagram"
       :aria-label="t('Memory system: execution ports, store buffer, L1 cache, fill buffers, write buffers and main memory')">
    <defs>
      <marker id="cd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" class="cd-head" />
      </marker>
    </defs>
    <g :class="{ 'cd-off': noCache }">
      <!-- execution ports -->
      <rect x="8" y="48" width="112" height="210" rx="8" class="cd-box cd-core" />
      <text x="64" y="68" class="cd-title">{{ t('Execution') }}</text>
      <text x="64" y="84" class="cd-title">{{ t('ports') }}</text>
      <rect x="22" y="104" width="84" height="30" rx="5" class="cd-unit" />
      <text x="64" y="124" class="cd-label">LOAD</text>
      <rect x="22" y="196" width="84" height="30" rx="5" class="cd-unit" />
      <text x="64" y="216" class="cd-label">STORE</text>

      <!-- store buffer -->
      <g :class="{ 'cd-hl': hl('sb') }">
        <rect x="160" y="186" width="128" height="52" rx="6" class="cd-box cd-sb" />
        <text x="224" y="207" class="cd-title">Store buffer</text>
        <text x="224" y="226" class="cd-value">× {{ v('nStoreBuffers') }}</text>
      </g>

      <!-- L1 cache -->
      <g :class="{ 'cd-hl': hl('cache') }">
        <rect x="330" y="70" width="140" height="180" rx="8" class="cd-box cd-cache" />
        <text x="400" y="96" class="cd-title">{{ t('L1 cache') }}</text>
        <text x="400" y="118" class="cd-value">{{ v('nBlocks') }} × {{ v('blkSize') }} B</text>
        <g v-for="k in 5" :key="k">
          <rect x="350" :y="128 + 20 * k" width="100" height="14" class="cd-line" />
        </g>
      </g>

      <!-- fill buffers -->
      <g :class="{ 'cd-hl': hl('fill') }">
        <rect x="512" y="56" width="120" height="62" rx="6" class="cd-box cd-fill" />
        <text x="572" y="80" class="cd-title">Fill buffers</text>
        <text x="572" y="100" class="cd-value">× {{ v('nFillBuffers') }}</text>
      </g>

      <!-- write buffers -->
      <g :class="{ 'cd-hl': hl('write') }">
        <rect x="512" y="190" width="120" height="62" rx="6" class="cd-box cd-write" />
        <text x="572" y="214" class="cd-title">Write buffers</text>
        <text x="572" y="234" class="cd-value">× {{ v('nWriteBuffers') }}</text>
      </g>

      <!-- main memory -->
      <g :class="{ 'cd-hl': hl('mm') }">
        <rect x="688" y="56" width="96" height="196" rx="8" class="cd-box cd-mm" />
        <text x="736" y="84" class="cd-title">{{ t('Main') }}</text>
        <text x="736" y="100" class="cd-title">{{ t('memory') }}</text>
        <text x="736" y="134" class="cd-small">{{ t('latency') }}</text>
        <text x="736" y="152" class="cd-value">{{ v('mPenalty') }}</text>
        <text x="736" y="186" class="cd-small">{{ t('1 transfer') }}</text>
        <text x="736" y="202" class="cd-small">{{ t('every {n} cycles', { n: v('mIssueTime') }) }}</text>
      </g>

      <!-- LOAD <-> cache: a hit gets its data through its port -->
      <line x1="106" y1="114" x2="328" y2="114" class="cd-path" marker-end="url(#cd-arrow)" marker-start="url(#cd-arrow)" />
      <text x="218" y="107" class="cd-note">{{ t('LOAD: hit, through its port') }}</text>

      <!-- STORE -> store buffer -> cache -->
      <line x1="106" y1="211" x2="158" y2="211" class="cd-path" marker-end="url(#cd-arrow)" />
      <line x1="288" y1="211" x2="328" y2="211" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="224" y="256" class="cd-note">{{ t('written after retiring, in order, 1 per cycle') }}</text>

      <!-- cache -> fill buffers (miss, RFO); fill buffers -> cache (the block is installed) -->
      <line x1="470" y1="78" x2="510" y2="78" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="490" y="70" class="cd-note">{{ t('miss') }}</text>
      <line x1="510" y1="104" x2="470" y2="104" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="490" y="124" class="cd-note">{{ t('block') }}</text>

      <!-- fill buffers <-> MM -->
      <line x1="632" y1="76" x2="686" y2="76" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="659" y="70" class="cd-note">{{ t('read') }}</text>
      <line x1="686" y1="102" x2="632" y2="102" class="cd-path" marker-end="url(#cd-arrow)" />

      <!-- data to the waiting LOADs (return throughput) -->
      <g :class="{ 'cd-hl-path': hl('return') }">
        <path d="M 572 56 L 572 30 L 64 30 L 64 46" class="cd-path cd-return" marker-end="url(#cd-arrow)" />
        <text x="318" y="23" class="cd-note">{{ t('data to the waiting LOADs: up to {n} per cycle', { n: v('rThru') }) }}</text>
      </g>

      <!-- cache -> write buffers (dirty victim) -> MM -->
      <line x1="470" y1="221" x2="510" y2="221" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="491" y="270" class="cd-note">{{ t('dirty block replaced') }}</text>
      <line x1="632" y1="221" x2="686" y2="221" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="659" y="214" class="cd-note">{{ t('write') }}</text>

      <!-- a STORE that misses requests its block when it executes (RFO) -->
      <path d="M 106 200 C 140 160, 300 150, 328 150" class="cd-path cd-rfo" marker-end="url(#cd-arrow)" />
      <text x="218" y="178" class="cd-note cd-rfo-text">{{ t('STORE: RFO when it executes') }}</text>
    </g>
    <text v-if="noCache" x="390" y="160" class="cd-nocache">{{ t('No cache: every access takes the latency of its instruction') }}</text>
  </svg>
</template>

<style scoped>
  .cache-diagram { width: 100%; height: auto; max-height: 36vh; display: block; margin: 0 auto 10px; }
  .cd-box   { fill: #f4f7fb; stroke: #7a8aa3; stroke-width: 1.5; }
  .cd-core  { fill: #eef2f7; }
  .cd-cache { fill: #e6f0ff; stroke: #1a4fb3; }
  .cd-fill  { fill: #fff3e0; stroke: #c77700; }
  .cd-write { fill: #fde7e9; stroke: #b3261e; }
  .cd-sb    { fill: #e8f5e9; stroke: #2e7d32; }
  .cd-mm    { fill: #f1ecf8; stroke: #5e35b1; }
  .cd-unit  { fill: white; stroke: #7a8aa3; }
  .cd-line  { fill: white; stroke: #9db7e3; }
  .cd-title { font: 600 15px sans-serif; fill: #1f2a3a; text-anchor: middle; }
  .cd-label { font: 600 14px sans-serif; fill: #1f2a3a; text-anchor: middle; }
  .cd-value { font: 700 16px sans-serif; fill: #0b2e5c; text-anchor: middle; }
  .cd-small { font: 13px sans-serif; fill: #333; text-anchor: middle; }
  .cd-note  { font: 12.5px sans-serif; fill: #333; text-anchor: middle; }
  .cd-path  { stroke: #4a5a73; stroke-width: 1.6; fill: none; }
  .cd-head  { fill: #4a5a73; }
  .cd-return { stroke-dasharray: 6 3; }
  .cd-rfo    { stroke-dasharray: 3 3; stroke: #c77700; }
  .cd-rfo-text { fill: #8a5300; }
  /* the element of the field being edited */
  .cd-hl > rect:first-child { stroke-width: 3.5; filter: drop-shadow(0 0 4px rgba(26, 79, 179, 0.5)); }
  .cd-hl-path .cd-path { stroke: #1a4fb3; stroke-width: 3; }
  .cd-hl-path .cd-note { fill: #1a4fb3; font-weight: 700; }
  .cd-off { opacity: 0.3; }
  .cd-nocache { font: 700 16px sans-serif; fill: #b3261e; text-anchor: middle; }
</style>
