<script setup>
  import { t, locale, setLocale, LANGUAGES } from '@/i18n'
import { ref, shallowRef, onMounted, onUnmounted, inject, nextTick, watch, computed } from 'vue';

import processor               from '@/components/processor.vue';
import program                 from '@/components/program.vue';
import programEditor           from '@/components/programEditor.vue';
import tutorialComponent       from '@/components/tutorialComponent.vue';
import tutorialEditor          from '@/components/tutorialEditor.vue';
import timelineComponent       from '@/components/timelineComponent.vue';
import aboutComponent          from '@/components/aboutComponent.vue';
import staticAnalysisComponent from '@/components/staticAnalysisComponent.vue';
import LessonPanel             from '@/components/LessonPanel.vue';
import { uiLocked, authorMode } from '@/authorMode';
import { changeTextScale, canGrow, canShrink } from '@/textScale';
import simulationComponent     from '@/components/simulationComponent.vue';

import { useRVCAT_Api }        from '@/rvcatAPI';
import { RVCAT_VERSION }       from '@/common';

const simState                      = inject('simulationState');
// Locks of the lesson in progress (editors in the header)
const lessonLocked = (what) => uiLocked(simState.lesson, what, simState.lessonAllow ?? [])
// a locked editor that is open is closed
watch(() => [simState.lesson, simState.lessonAllow], () => {
  if ((currentFullKey.value === 'program' && lessonLocked('programEditor')) ||
      (currentFullKey.value === 'tutorial' && lessonLocked('tutorialEditor')))
    currentFullKey.value = 'none'
})
const { isReady, registerHandler }  = inject('worker');
const { importRVCAT }               = useRVCAT_Api();

// ============================================================================
// RVCAT options & localStorage
// ============================================================================

  const STORAGE_KEY = 'rvcatOptions'

  const rvcatOptions = {
    version: RVCAT_VERSION,
    year:    2026
  }

  function checkRVCATversion() {
    const storedData = localStorage.getItem(STORAGE_KEY)

    if (storedData) {
      try {
        const parsedData = JSON.parse(storedData)
        if (parsedData.version === rvcatOptions.version)
          return
      } catch (error) {
        console.error('Error when parsing localStorage:', error)
      }
    }
    // the language, the author mode and the size of the text are kept
    const kept = Object.fromEntries(['language', 'authorMode', 'textScale']
      .map(k => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null))
    localStorage.clear()
    for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v)
    // Non-blocking notice (an alert() would stop the page while it loads)
    versionNotice.value = t('New version of RVCAT released (V{version}). Saved settings and results have been reset.',
                            { version: rvcatOptions.version })
    setTimeout(() => { versionNotice.value = '' }, 15000)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rvcatOptions))
  }
  const versionNotice = ref('')

// ============================================================================
// Side panel (processor + program) can be collapsed to give more room to the right panel
// ============================================================================
  const SIDE_KEY = 'sidePanelCollapsed'
  const sideCollapsed = ref(false)
  try { sideCollapsed.value = localStorage.getItem(SIDE_KEY) === 'true' } catch { /* default */ }
  watch(sideCollapsed, (v) => {
    try { localStorage.setItem(SIDE_KEY, String(v)) } catch { /* ignore */ }
    // The right panel changed width: let width-dependent views (timeline) adapt
    nextTick(() => window.dispatchEvent(new Event('resize')))
  })

  // Width of the side panel (% of the window), changed by dragging the gutter between the panels
  const WIDTH_KEY = 'sidePanelWidth'
  const MIN_SIDE_PX = 260, MAX_SIDE_PCT = 60
  const sideWidth = ref(33)
  try { const w = Number(localStorage.getItem(WIDTH_KEY)); if (w >= 15 && w <= MAX_SIDE_PCT) sideWidth.value = w } catch { /* default */ }
  const containerStyle = computed(() => ({ '--side-width': `${sideWidth.value}%` }))
  let resizeFrame = 0
  const notifyResize = () => {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; window.dispatchEvent(new Event('resize')) })
  }
  function startDrag(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const container = event.currentTarget.parentElement
    const rect = container.getBoundingClientRect()
    document.body.classList.add('dragging-gutter')
    const move = (e) => {
      const minPct = 100 * MIN_SIDE_PX / rect.width
      const pct = 100 * (e.clientX - rect.left) / rect.width
      sideWidth.value = Math.round(10 * Math.min(MAX_SIDE_PCT, Math.max(minPct, pct))) / 10
      notifyResize()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dragging-gutter')
      try { localStorage.setItem(WIDTH_KEY, String(sideWidth.value)) } catch { /* ignore */ }
      notifyResize()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // keyboard: arrows on the gutter change the width
  function gutterKey(e) {
    const step = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0
    if (!step) return
    sideWidth.value = Math.min(MAX_SIDE_PCT, Math.max(18, sideWidth.value + step))
    try { localStorage.setItem(WIDTH_KEY, String(sideWidth.value)) } catch { /* ignore */ }
    notifyResize()
  }

  // Narrow windows (laptops with a large zoom, projectors): the side panel folds by itself when
  // the window becomes narrower than NARROW_PX (it can still be opened with its strip)
  const NARROW_PX = 1100
  let wasNarrow = window.innerWidth < NARROW_PX
  if (wasNarrow) sideCollapsed.value = true
  function onWindowResize() {
    const narrow = window.innerWidth < NARROW_PX
    if (narrow && !wasNarrow) sideCollapsed.value = true
    wasNarrow = narrow
  }
  window.addEventListener('resize', onWindowResize)

// ============================================================================
// Main Simulator Panel UI
// ============================================================================
// Map of component keys -> component definitions
const components = {
  simulationComponent,
  timelineComponent,
  staticAnalysisComponent,
  aboutComponent
};

// Navigation state
const checkOK          = ref(false);
const currentFullKey   = ref('none')
const currentKey       = ref('simulationComponent')
const currentComponent = shallowRef(components[currentKey.value])

// Computed to use on template
const isNotFullscreen       = computed(() => currentFullKey.value === 'none');
const isProgramFullscreen   = computed(() => currentFullKey.value === 'program');
const isTutorialFullscreen  = computed(() => currentFullKey.value === 'tutorial');


// Container classes
const containerClasses = computed(() => ({
  'side-collapsed':       sideCollapsed.value && isNotFullscreen.value,
  'program-fullscreen':   isProgramFullscreen.value,
  'tutorial-fullscreen':  isTutorialFullscreen.value
}));

// ============================================================================
// Functions to change panel/full-screen
// ============================================================================

// Handle requests from header (& processor/program/tutorial engine)
function onRequestSwitch(key) {
  const nextComp             = components[key]
  currentKey.value           = key
  currentComponent.value     = nextComp
  currentFullKey.value       = 'none'
}

function toggleFullScreen(key) {
  // The processor is edited in its own panel (older tutorials may still ask for its editor)
  if (key === 'processor') {
    currentFullKey.value = 'none'
    sideCollapsed.value  = false
    return
  }
  if (currentFullKey.value === key) {
    currentFullKey.value = 'none'
    return
  }
  currentFullKey.value = key
}

// ============================================================================
// Loading view
// ============================================================================

// Navigation state
const showOverlay = ref(true);

function closeLoadingOverlay() { showOverlay.value = false }

// ============================================================================
// EVENT HANDLERS: import_rvcat     WATCH: isReady
// ============================================================================
const loadingMessage = ref('Initializing');

const handleRVCAT = async (data, dataType) => {
  if (dataType === 'error') {
    console.error('❌ handler: failed to import RVCAT:', data);
    return;
  }
  loadingMessage.value = 'Loading complete!';
  setTimeout(() => closeLoadingOverlay(), 1500)
  simState.state = 1;  // fires processor component to set processor configuration
};

watch(isReady, (ready) => {
  if (ready) {
      loadingMessage.value = 'Loading complete!';
      importRVCAT();       // call RVCAT API
  }
})

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================
let  cleanupRVCAT = null

onMounted(() => {
  checkRVCATversion()
  console.log('🔵🎯 Main Component mounted')
  checkOK.value = true   // mount all components
  nextTick(() => {
      loadingMessage.value = 'Loading RVCAT';
      showOverlay.value    = true
  });
  cleanupRVCAT = registerHandler('import_rvcat', handleRVCAT);
});

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  if (cleanupRVCAT) {
     cleanupRVCAT()
     cleanupRVCAT = null
  }
});

</script>

<template>
  <div class="app-root">
    <header>
      <div id="top">
        <div class="header-title">
          <img src="/img/favicon.png" class="title-img" alt="RVCAT" :title="`RVCAT version ${RVCAT_VERSION}`">
          <div class="app-name" :title="`RVCAT version ${RVCAT_VERSION}`">RVCAT</div>
          <nav>
            <ul>
              <!-- The three views of the right panel: one tab group (the active one is marked
                   only while no editor covers the panels) -->
              <li class="view-tabs" role="tablist" :aria-label="t('Views')">
                <button class="view-tab" role="tab" :class="{ active: isNotFullscreen && currentKey === 'simulationComponent' }"
                  :aria-selected="isNotFullscreen && currentKey === 'simulationComponent'"
                  id="simulation-button"
                  :title="t('Simulate Program\'s execution and collect performance metrics')"
                  @click="onRequestSwitch('simulationComponent')" >
                    {{ t('Simulation') }}
                </button>
                <button class="view-tab" role="tab" :class="{ active: isNotFullscreen && currentKey === 'timelineComponent' }"
                  :aria-selected="isNotFullscreen && currentKey === 'timelineComponent'"
                  id="timeline-button"
                  :title="t('Detailed Timeline of Program\'s execution')"
                  @click="onRequestSwitch('timelineComponent')" >
                    {{ t('Timeline') }}
                </button>
                <button class="view-tab" role="tab" :class="{ active: isNotFullscreen && currentKey === 'staticAnalysisComponent' }"
                  :aria-selected="isNotFullscreen && currentKey === 'staticAnalysisComponent'"
                  id="analysis-button"
                  :title="t('Static Performance Analysis: identify potential bottleneck (throughput or latency/dependencies)')"
                  @click="onRequestSwitch('staticAnalysisComponent')" >
                    {{ t('Static Analysis') }}
                </button>
              </li>
              <li class="separator"></li>
              <li>
                <LessonPanel :active-view="currentKey" @requestSwitchPanel="onRequestSwitch" />
              </li>
              <!-- Editors (author mode): the button of an open editor closes it -->
              <template v-if="!lessonLocked('programEditor') || !lessonLocked('tutorialEditor')">
                <li class="separator"></li>
                <li v-if="!lessonLocked('programEditor')">
                  <button class="blue-button editor-button" :class="{ 'active': isProgramFullscreen }"
                    id="program-button"
                    :title="isProgramFullscreen ? t('Close the program editor and go back to the simulator') : t('Open the program editor')"
                    @click="toggleFullScreen('program')" >
                      {{ isProgramFullscreen ? '✕ ' + t('Close the editor') : '✎ ' + t('Edit Program') }}
                  </button>
                </li>
                <li v-if="!lessonLocked('tutorialEditor')">
                  <button class="blue-button editor-button" :class="{ 'active': isTutorialFullscreen }"
                    id="tutorial-button"
                    :title="isTutorialFullscreen ? t('Close the tutorial editor and go back to the simulator') : t('Open the tutorial editor')"
                    @click="toggleFullScreen('tutorial')" >
                      {{ isTutorialFullscreen ? '✕ ' + t('Close the editor') : '✎ ' + t('Edit Tutorial') }}
                  </button>
                </li>
              </template>
            </ul>
          </nav>
        </div>
        <div class="header-tools">
          <span v-if="authorMode" class="author-badge" id="author-badge"
                :title="t('Author mode: the editors and the structure of the processor are shown. Click to leave it (open the page with ?author to enter it again).')"
                @click="authorMode = false">✎ {{ t('Author') }} ✕</span>
          <span class="text-size" :title="t('Size of the text')">
            <button class="text-size-button" id="text-smaller" :disabled="!canShrink()" @click="changeTextScale(-1)"
                    :title="t('Smaller text')" :aria-label="t('Smaller text')">A−</button>
            <button class="text-size-button" id="text-larger" :disabled="!canGrow()" @click="changeTextScale(1)"
                    :title="t('Larger text')" :aria-label="t('Larger text')">A+</button>
          </span>
          <button class="header-link" :class="{ active: isNotFullscreen && currentKey === 'aboutComponent' }"
            id="about-button"
            :title="t('Credits on the design and development for this tool')"
            @click="onRequestSwitch('aboutComponent')" >
              {{ t('About') }}
          </button>
          <!-- Language of the interface -->
          <div class="lang-select">
            <select :value="locale" @change="setLocale($event.target.value)" id="language-select"
                    :title="t('Language of the interface')">
              <option v-for="l in LANGUAGES" :key="l.code" :value="l.code" :title="l.name">{{ l.label }}</option>
            </select>
          </div>
        </div>
      </div>
    </header>
    <div id="lesson-bar-slot"></div>

    <div v-if="versionNotice" class="version-notice" role="status">
      💻 {{ versionNotice }}
      <button class="version-notice-close" @click="versionNotice = ''" :title="t('Close')">✕</button>
    </div>

    <div class="blur-overlay" :style="{ display: showOverlay ? 'block' : 'none' }"></div>
    <div class="overlay"      :style="{ display: showOverlay ? 'block' : 'none' }">
      <div class="spinner"></div>
      <p>{{ t(loadingMessage) }}</p>
      <p>{{ t('Please wait. Loading can take several seconds') }}</p>
    </div>

    <main class="container" :class="containerClasses" :style="containerStyle">

      <div class="components-wrapper" v-if="checkOK" v-show="isNotFullscreen && !sideCollapsed" id="process-panel">
        <processor/>
        <program :active-view="currentKey" @requestSwitchFull="toggleFullScreen"/>
      </div>
      <!-- Gutter between the panels: drag it to change their widths; « hides the side panel -->
      <div v-if="checkOK && isNotFullscreen && !sideCollapsed" class="gutter" id="panels-gutter"
           role="separator" aria-orientation="vertical" tabindex="0"
           :aria-label="t('Drag to change the width of the panels')"
           :title="t('Drag to change the width of the panels')"
           @pointerdown="startDrag" @keydown="gutterKey">
        <button class="gutter-button" id="side-panel-toggle" @pointerdown.stop @click="sideCollapsed = true"
                :title="t('Hide the processor and program panels to give more room to the right panel')"
                :aria-label="t('Hide the processor and program panels to give more room to the right panel')">«</button>
      </div>
      <!-- Collapsed side panel: a narrow strip that brings it back -->
      <button v-if="checkOK && isNotFullscreen && sideCollapsed" class="side-expand"
              id="side-panel-expand" :title="t('Show the processor and program panels')"
              @click="sideCollapsed = false">
        <span>▶</span><span class="side-expand-label">{{ t('Processor & Program') }}</span>
      </button>

      <div v-if="checkOK" v-show="isProgramFullscreen"   class="grid-item program"   id="programEditor-panel">
        <programEditor   :is-fullscreen="isProgramFullscreen"  />
      </div>

      <div v-if="checkOK" v-show="isTutorialFullscreen"
        class="grid-item tutorial" :class="{ 'fullscreen': isTutorialFullscreen }"
        id="tutorial-panel"
        >
        <tutorialEditor :is-fullscreen="isTutorialFullscreen"  />
      </div>

      <div v-if="checkOK" v-show= "isNotFullscreen"
        class="grid-item results"
        id="right-panel"
        >
        <component :is="currentComponent" v-if="currentComponent" ref="settingsCompInst"/>
        <div v-else>Component not found</div>
      </div>

      <div v-if="checkOK">
        <tutorialComponent :activeView="currentKey" :activeFull="currentFullKey"
          id="tutorial-activation"
          @requestSwitchPanel="onRequestSwitch"
          @requestSwitchFull="toggleFullScreen"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>

/* The application fills exactly the browser window: header + panels area.
   Each column/panel scrolls inside itself, so the page itself never scrolls. */
.app-root {
  height:         100vh;
  height:         100dvh;
  display:        flex;
  flex-direction: column;
  overflow:       hidden;
}
header { flex: none; }

#top {
  min-height:      2.6rem;
  width:           100%;   /* 100vw would include the scrollbar width */
  display:         flex;
  gap:             12px;
  color:           white;
  padding:         4px 10px;
  box-shadow:      0 4px 8px rgba(0, 0, 0, 0.05);
  box-sizing:      border-box;
  align-items:     center;
  justify-content: space-between;
  background-color: #0cb35f;
}

nav ul {
  list-style: none;
  padding:    0;
  margin:     0;
  display:    flex;
}
nav ul li {
  margin: 0 3px;
  display: flex;
  align-items: center;
}
.app-name {
  font-size:   1.25rem;
  font-weight: 700;
  padding:     0 10px 0 4px;
  align-self:  center;
}

/* The views of the right panel: a group of tabs, the active one in white */
.view-tabs {
  display:       flex;
  gap:           0;
  background:    rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  padding:       3px;
}
.view-tab {
  border:        none;
  background:    transparent;
  color:         white;
  font-size:     1rem;
  font-weight:   600;
  padding:       4px 14px;
  border-radius: 6px;
  cursor:        pointer;
  white-space:   nowrap;
}
.view-tab:hover  { background: rgba(255, 255, 255, 0.2); }
.view-tab.active { background: white; color: #0b6b3a; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }

.editor-button.active { background: #b3261e; border-color: #b3261e; color: white; }

.header-tools {
  display:     flex;
  align-items: center;
  gap:         10px;
  flex-shrink: 0;
}
.header-link {
  background:  none;
  border:      none;
  color:       white;
  font-size:   0.9375rem;
  cursor:      pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.header-link.active { font-weight: 700; }
/* narrow screens: the logo is enough */
@media (max-width: 1400px) { .app-name { display: none; } }
.text-size { display: inline-flex; gap: 2px; }
.text-size-button {
  min-width:     2.2em;
  padding:       2px 6px;
  border:        1px solid rgba(255, 255, 255, 0.7);
  border-radius: 5px;
  background:    rgba(255, 255, 255, 0.15);
  color:         white;
  font-weight:   700;
  font-size:     0.9375rem;
  cursor:        pointer;
}
.text-size-button:hover:not([disabled]) { background: rgba(255, 255, 255, 0.3); }
.text-size-button[disabled] { opacity: 0.45; cursor: default; }
.author-badge {
  padding:       2px 8px;
  border-radius: 999px;
  background:    #fff3cd;
  color:         #6b4e00;
  white-space:   nowrap;
  font-weight:   700;
  font-size:     0.875rem;
  cursor:        pointer;
}

.lang-select select {
  font-size: 0.9em; padding: 2px 4px; border-radius: 4px; border: 1px solid #cfe9d9;
  background: white; color: #1b5e20; cursor: pointer;
}
.separator {
  width: 1px;
  background-color: rgba(0, 0, 0, 0.15);
  align-self: center; /* Centrar verticalmente */
  display: flex;
  align-items: center;
  border-right: 1px solid rgba(0, 0, 0, 0.1);
  margin: 0 8px;
  height: 60%; /* Porcentaje de la altura del contenedor */
}

.title-img {
  height:     2rem;
  margin-top: 0.0vh;
}

.header-title {
  display:flex;
  gap:    5px;
}

.container {
  position:              relative;
  display:               grid;
  grid-template-columns: var(--side-width, 33%) 12px minmax(0, 1fr);
  grid-template-rows:    minmax(0, 1fr) auto;   /* panels row fills the height; tutorial row is empty */
  gap:          0;
  flex:         1 1 auto;
  min-height:   0;
  width:        100%;
  margin-top:   0.3vh;
  background:   #e3e3e3;
  overflow:     hidden;
  box-sizing:   border-box;
}

/* Gutter between the side panel and the right panel */
.gutter {
  grid-column:     2;
  grid-row:        1;
  position:        relative;
  cursor:          col-resize;
  background:      #d6dbe3;
  display:         flex;
  align-items:     center;
  justify-content: center;
  touch-action:    none;
}
.gutter:hover, .gutter:focus-visible { background: #9fb4d6; outline: none; }
.gutter-button {
  position:      absolute;
  top:           50%;
  transform:     translateY(-50%);
  width:         12px;
  height:        44px;
  font-size:     0.875rem;
  padding:       0;
  border:        1px solid #9fb4d6;
  border-radius: 6px;
  background:    white;
  color:         #1a4fb3;
  font-weight:   700;
  cursor:        pointer;
  z-index:       2;
}
.gutter-button:hover { background: #e6f0ff; }
#process-panel { grid-column: 1; grid-row: 1; }

/* Side panel collapsed: narrow strip + right panel */
.container.side-collapsed {
  grid-template-columns: 28px 0 minmax(0, 1fr);
  grid-template-rows:    minmax(0, 1fr) auto;
}
.side-expand {
  grid-column:    1;
  grid-row:       1;
  display:        flex;
  flex-direction: column;
  align-items:    center;
  gap:            8px;
  padding:        8px 0;
  border:         none;
  border-radius:  3px;
  background:     #d4dbe6;
  color:          #1a4fb3;
  cursor:         pointer;
  font-weight:    600;
}
.side-expand:hover { background: #c3cde0; }
.side-expand-label {
  writing-mode: vertical-rl;
  white-space:  nowrap;
}

.version-notice {
  position:      fixed;
  bottom:        16px;
  left:          16px;
  z-index:       2000;
  display:       flex;
  align-items:   center;
  gap:           12px;
  padding:       8px 12px 8px 16px;
  background:    #fff8e1;
  color:         #5a4500;
  border:        1px solid #e0c060;
  border-radius: 6px;
  box-shadow:    0 4px 12px rgba(0, 0, 0, 0.15);
}
.version-notice-close {
  background: none;
  border:     none;
  cursor:     pointer;
  font-size:  1em;
  color:      inherit;
}

.processor { grid-column: 1; grid-row: 1; }
.program   { grid-column: 1; grid-row: 1; }
.tutorial  { grid-column: 1; grid-row: 1; }
.results   { grid-column: 3; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; }
.process   { grid-column: 1; grid-row: 1; min-width: 0;}

.container.program-fullscreen,
.container.tutorial-fullscreen {
  grid-template-columns: 1fr;
  grid-template-rows:    minmax(0, 1fr) auto;
  padding:  0;
  background: white;
}

.grid-item {
  display:       flex;
  flex-direction: column;
  flex-shrink:   0;
  position:      relative;
  background:    white;
  border-radius: 3px;
  min-width:     0;
}

.components-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0;
  min-height: 0;
  overflow-y: auto;      /* processor + program scroll inside the left column */
  overflow-x: hidden;
}

.components-wrapper > * {
  width: 100%;
  margin: 0;
  padding: 0;
  flex-shrink: 0;
  flex-grow: 0;
}

.components-wrapper processorComponent,
.components-wrapper programComponent {
  align-self: flex-start;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  min-height: auto;
  height: auto;
}

.grid-item.processor,
.grid-item.program,
.grid-item.tutorial {
  grid-column:   1 / span 3;
  grid-row:      1;
  height:        100%;
  width:         100%;
  position:      relative;
  top:           0;
  left:          0;
  right:         0;
  bottom:        0;
  z-index:       999;
  border-radius: 0;
  border:        none;
  box-shadow:    0 0 10px rgba(0,0,0,0.3);
}

/* Ocultar otros componentes en pantalla completa */
.container.program-fullscreen .grid-item.processor,
.container.program-fullscreen .grid-item.tutorial,
.container.program-fullscreen .grid-item.results,
.container.tutorial-fullscreen .grid-item.processor,
.container.tutorial-fullscreen .grid-item.program,
.container.tutorial-fullscreen .grid-item.results {
  display: none;
}

.grid-item.processor,
.grid-item.program,
.grid-item.tutorial {
  padding:       0px;
  max-height: none;
  overflow:   auto;      /* full-screen editors scroll inside */
  margin:     0 auto;
}

.grid-item.processor::-webkit-scrollbar,
.grid-item.program::-webkit-scrollbar,
.grid-item.tutorial::-webkit-scrollbar {
  width: 10px;
}

.grid-item.processor::-webkit-scrollbar-track,
.grid-item.program::-webkit-scrollbar-track,
.grid-item.tutorial::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.grid-item.processor::-webkit-scrollbar-thumb,
.grid-item.program::-webkit-scrollbar-thumb,
.grid-item.tutorial::-webkit-scrollbar-thumb {
  background:    #888;
  border-radius: 5px;
}

.blur-overlay {
  top:      0;
  left:     0;
  width:    100%;
  height:   100%;
  z-index:  1000;
  position: fixed;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(5px);
}

.overlay {
  top:     50%;
  left:    50%;
  z-index: 1001;
  position:       fixed;
  transform:      translate(-50%, -50%);
  background:     white;
  padding:       2rem;
  border-radius: 8px;
  box-shadow:    0 4px 20px rgba(0, 0, 0, 0.2);
  text-align:    center;
  min-width:     300px;
}

.spinner {
  border:            4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #3498db;
  border-radius:     50%;
  width:    40px;
  height:   40px;
  animation: spin 1s linear infinite;
  margin:    0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

</style>
