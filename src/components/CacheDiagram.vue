<script setup>
  // Schematic figure of the memory system of the processor, drawn with the values of the window of
  // the cache: the execution ports (LOAD, STORE), the store buffer, the L1 cache, the fill buffers,
  // the write buffers and the main memory, with the paths of the data. The element of the field
  // being edited (active) is highlighted.
  import { computed } from 'vue'
  import { t } from '@/i18n'
  import { memoryPortCounts } from '@/common'

  const props = defineProps({
    values: { type: Object, required: true },   // nBlocks, blkSize, mPenalty, mIssueTime, nFillBuffers, nWriteBuffers, rThru, nStoreBuffers
    active: { type: String, default: '' },      // key of the field being edited
    ports:  { type: Object, default: () => ({}) },  // ports of the processor: the LOADs and STOREs per cycle
  })
  const mem = computed(() => memoryPortCounts(props.ports))
  const v = (key) => props.values[key] === '' || props.values[key] === undefined ? '?' : props.values[key]
  const noCache = computed(() => Number(props.values.nBlocks) === 0)
  const PART = {
    nBlocks: 'cache', blkSize: 'cache', mPenalty: 'mm', mIssueTime: 'mm', nFillBuffers: 'fill',
    nWriteBuffers: 'write', rThru: 'return', nStoreBuffers: 'sb',
  }
  const hl = (part) => PART[props.active] === part
</script>

<template>
  <svg class="cache-diagram" viewBox="0 0 960 246" role="img" id="cache-diagram"
       :aria-label="t('Memory system: execution ports, store buffer, L1 cache, fill buffers, write buffers and main memory')">
    <defs>
      <marker id="cd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" class="cd-head" />
      </marker>
    </defs>
    <g :class="{ 'cd-off': noCache }">
      <!-- execution ports -->
      <rect x="8" y="40" width="120" height="180" rx="8" class="cd-box cd-core" />
      <text x="68" y="62" class="cd-title">{{ t('Execution') }}</text>
      <text x="68" y="81" class="cd-title">{{ t('ports') }}</text>
      <rect x="22" y="92" width="92" height="30" rx="5" class="cd-unit" />
      <text x="68" y="113" class="cd-label">LOAD ×{{ mem.loads }}
        <title>{{ t('{n} ports execute LOADs: up to {n} LOADs per cycle', { n: mem.loads }) }}</title></text>
      <rect x="22" y="172" width="92" height="30" rx="5" class="cd-unit" />
      <text x="68" y="193" class="cd-label">STORE ×{{ mem.stores }}
        <title>{{ t('{n} ports execute STOREs: up to {n} STOREs per cycle enter the store buffer', { n: mem.stores }) }}</title></text>

      <!-- store buffer -->
      <g :class="{ 'cd-hl': hl('sb') }">
        <rect x="190" y="164" width="150" height="50" rx="6" class="cd-box cd-sb" />
        <text x="265" y="185" class="cd-title">Store buffer</text>
        <text x="265" y="206" class="cd-value">× {{ v('nStoreBuffers') }}</text>
      </g>

      <!-- L1 cache -->
      <g :class="{ 'cd-hl': hl('cache') }">
        <rect x="400" y="46" width="160" height="174" rx="8" class="cd-box cd-cache" />
        <text x="480" y="71" class="cd-title">{{ t('L1 cache') }}</text>
        <text x="480" y="94" class="cd-value">{{ v('nBlocks') }} × {{ v('blkSize') }} B</text>
        <g v-for="k in 5" :key="k">
          <rect x="425" :y="88 + 21 * k" width="110" height="14" class="cd-line" />
        </g>
      </g>

      <!-- fill buffers -->
      <g :class="{ 'cd-hl': hl('fill') }">
        <rect x="640" y="46" width="140" height="58" rx="6" class="cd-box cd-fill" />
        <text x="710" y="69" class="cd-title">Fill buffers</text>
        <text x="710" y="93" class="cd-value">× {{ v('nFillBuffers') }}</text>
      </g>

      <!-- write buffers -->
      <g :class="{ 'cd-hl': hl('write') }">
        <rect x="640" y="164" width="140" height="58" rx="6" class="cd-box cd-write" />
        <text x="710" y="187" class="cd-title">Write buffers</text>
        <text x="710" y="211" class="cd-value">× {{ v('nWriteBuffers') }}</text>
      </g>

      <!-- main memory -->
      <g :class="{ 'cd-hl': hl('mm') }">
        <rect x="846" y="46" width="108" height="176" rx="8" class="cd-box cd-mm" />
        <text x="900" y="70" class="cd-title">{{ t('Main') }}</text>
        <text x="900" y="89" class="cd-title">{{ t('memory') }}</text>
        <text x="900" y="120" class="cd-small">{{ t('latency') }}</text>
        <text x="900" y="141" class="cd-value">{{ v('mPenalty') }}</text>
        <text x="900" y="176" class="cd-small">{{ t('1 transfer') }}</text>
        <text x="900" y="195" class="cd-small">{{ t('every {n} cycles', { n: v('mIssueTime') }) }}</text>
      </g>

      <!-- LOAD <-> cache: a hit gets its data through its port -->
      <line x1="114" y1="107" x2="398" y2="107" class="cd-path" marker-end="url(#cd-arrow)" marker-start="url(#cd-arrow)" />
      <text x="266" y="100" class="cd-note">{{ t('{n} LOADs/cycle; a hit, through its port', { n: mem.loads }) }}</text>

      <!-- STORE -> store buffer -> cache -->
      <line x1="114" y1="188" x2="188" y2="188" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="151" y="181" class="cd-note">{{ mem.stores }}/{{ t('cycle') }}</text>
      <line x1="340" y1="188" x2="398" y2="188" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="282" y="238" class="cd-note">{{ t('written after retiring, in order: up to {n}/cycle if same block', { n: mem.stores }) }}</text>

      <!-- cache -> fill buffers (miss, RFO); fill buffers -> cache (the block is installed) -->
      <line x1="560" y1="64" x2="638" y2="64" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="599" y="57" class="cd-note">{{ t('miss') }}</text>
      <line x1="638" y1="90" x2="560" y2="90" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="599" y="110" class="cd-note">{{ t('block') }}</text>

      <!-- fill buffers <-> MM -->
      <line x1="780" y1="64" x2="844" y2="64" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="812" y="57" class="cd-note">{{ t('read') }}</text>
      <line x1="844" y1="90" x2="780" y2="90" class="cd-path" marker-end="url(#cd-arrow)" />

      <!-- data to the waiting LOADs (return throughput) -->
      <g :class="{ 'cd-hl-path': hl('return') }">
        <path d="M 710 46 L 710 24 L 68 24 L 68 38" class="cd-path cd-return" marker-end="url(#cd-arrow)" />
        <text x="389" y="17" class="cd-note">{{ t('data to the waiting LOADs: up to {n} per cycle', { n: v('rThru') }) }}</text>
      </g>

      <!-- cache -> write buffers (dirty victim) -> MM -->
      <line x1="560" y1="193" x2="638" y2="193" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="710" y="240" class="cd-note">{{ t('dirty block replaced') }}</text>
      <line x1="780" y1="193" x2="844" y2="193" class="cd-path" marker-end="url(#cd-arrow)" />
      <text x="812" y="186" class="cd-note">{{ t('write') }}</text>

      <!-- a STORE that misses requests its block when it executes (RFO) -->
      <path d="M 114 180 C 160 140, 360 134, 398 134" class="cd-path cd-rfo" marker-end="url(#cd-arrow)" />
      <text x="262" y="129" class="cd-note cd-rfo-text">{{ t('STORE: RFO when it executes') }}</text>
    </g>
    <text v-if="noCache" x="480" y="135" class="cd-nocache">{{ t('No cache: every access takes the latency of its instruction') }}</text>
  </svg>
</template>

<style scoped>
  .cache-diagram { width: 100%; height: auto; max-height: 32vh; display: block; margin: 0 auto 10px; }
  .cd-box   { fill: #f4f7fb; stroke: #7a8aa3; stroke-width: 1.5; }
  .cd-core  { fill: #eef2f7; }
  .cd-cache { fill: #e6f0ff; stroke: #1a4fb3; }
  .cd-fill  { fill: #fff3e0; stroke: #c77700; }
  .cd-write { fill: #fde7e9; stroke: #b3261e; }
  .cd-sb    { fill: #e8f5e9; stroke: #2e7d32; }
  .cd-mm    { fill: #f1ecf8; stroke: #5e35b1; }
  .cd-unit  { fill: white; stroke: #7a8aa3; }
  .cd-line  { fill: white; stroke: #9db7e3; }
  .cd-title { font: 600 17px sans-serif; fill: #1f2a3a; text-anchor: middle; }
  .cd-label { font: 600 16px sans-serif; fill: #1f2a3a; text-anchor: middle; }
  .cd-value { font: 700 18px sans-serif; fill: #0b2e5c; text-anchor: middle; }
  .cd-small { font: 15px sans-serif; fill: #333; text-anchor: middle; }
  .cd-note  { font: 14.5px sans-serif; fill: #333; text-anchor: middle; }
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
  .cd-nocache { font: 700 19px sans-serif; fill: #b3261e; text-anchor: middle; }
</style>
