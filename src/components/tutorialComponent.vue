<template>
  <div class="tutorial-system">
    <!-- Tutorial Overlay for Steps -->
    <div v-if="currentTutorial && isActive && !isQuestionStep" class="tutorial-overlay">
      <!-- Tooltip -->
      <div class="tutorial-tooltip" ref="contentRef"
        :style="{ left: x + 'px', top: y + 'px', visibility: measuring ? 'hidden' : undefined,
                  width: currentStep?.wWidth ? `${currentStep.wWidth}px` : undefined,
                  height: currentStep?.wHeight ? `${currentStep.wHeight}px` : undefined }">
        <div class="tutorial-header" ref="headerRef">
          <h3 v-html="rt(currentStep?.title)"></h3>
          <span v-if="previewMode" class="preview-badge" :title="t('Preview from the tutorial editor: closing it returns to the editor')">PREVIEW</span>
          <button :title="previewMode ? t('End preview and return to the tutorial editor') : t('Close tutorial, but can be resumed later')"
          class="tutorial-close" @click="closeTutorial">&times;</button>
        </div>
        <div class="tutorial-content">
          <div class="step-description" v-html="rt(currentStep?.description)"></div>
          <!-- second part of the card, shown when its validation is met (e.g. the results of the simulation) -->
          <div v-if="currentStep?.doneDescription && validationMet" class="step-description step-done-description"
               v-html="rt(currentStep.doneDescription)"></div>
          <div v-if="actionsRunning" class="tutorial-running">⏳ {{ t('The tutorial is acting on the simulator…') }}</div>

          <!-- Prediction: written before simulating, compared with the result of the next simulation -->
          <div v-if="currentStep?.type === 'predict' && validationMet" class="task-box" id="tutorial-predict">
            <div class="task-row">
              <label for="tutorial-prediction">{{ t('Your prediction:') }}</label>
              <input id="tutorial-prediction" v-model="predictionInput" type="text" inputmode="decimal"
                     :disabled="!!taskState.result" @keyup.enter="savePrediction" />
              <span v-if="currentStep.predictUnit">{{ currentStep.predictUnit }}</span>
              <button class="tutorial-btn" :disabled="!!taskState.result || !validPrediction" @click="savePrediction">{{ t('Save') }}</button>
            </div>
            <div v-if="taskState.prediction !== undefined && !taskState.result" class="task-status">
              {{ t('Prediction {p} saved: now run the simulation.', { p: taskState.prediction }) }}
            </div>
            <div v-if="taskState.result" class="task-status" :class="{ 'task-ok': taskState.result.good === true, 'task-far': taskState.result.good === false }">
              {{ t('Prediction {p} · simulated {a} (difference {d})', { p: taskState.prediction, a: formatNumber(taskState.result.actual), d: formatNumber(taskState.result.actual - taskState.prediction) }) }}{{
                taskState.result.good === null ? '' : taskState.result.good ? ' · ' + t('good prediction') : ' · ' + t('far from the result') }}
            </div>
            <div v-if="taskState.result && predictComment" class="task-comment" v-html="predictComment"></div>
          </div>

          <!-- Goal: a condition on the results, checked after every simulation -->
          <div v-if="currentStep?.type === 'goal'" class="task-box" id="tutorial-goal">
            <div class="task-row"><b>{{ t('Goal:') }}</b> <code>{{ currentStep.goal }}</code>
              <span v-if="currentStep.program"> {{ t('with program') }} <b>{{ currentStep.program }}</b></span></div>
            <div v-if="(currentStep.allow ?? []).length" class="task-row task-allow">
              {{ t('Allowed now:') }} {{ currentStep.allow.join(', ') }}</div>
            <div v-if="taskState.last" class="task-status" :class="taskState.last.ok ? 'task-ok' : 'task-far'">
              {{ t('Last simulation:') }} {{ taskState.last.ok ? '✓ ' + t('achieved') : '✗ ' + t('not yet') }}
              <span v-if="taskState.last.message"> · {{ taskState.last.message }}</span>
              <span v-for="(v, name) in taskState.last.values" :key="name"> · {{ name }} = {{ formatNumber(v) }}</span>
            </div>
            <div v-else class="task-status">{{ t('Run a simulation to check the goal.') }}</div>
            <div v-if="taskState.done && currentStep.best" class="task-status task-ok">
              {{ t('Best') }} {{ currentStep.best }}: {{ formatNumber(taskState.best) }}</div>
          </div>
          <div v-if="currentStep?.image" class="step-image"
            @click="openLightbox(currentStep.image)">
            <img :src="currentStep.image" alt="Step image">
            <span class="image-hint">{{ t('Click to enlarge') }}</span>
          </div>
          <div class="tutorial-actions">
            <button @click="previousStep" :disabled="!canGoBack"
               :title="t('Go to previous step on the tutorial')"
               class="tutorial-btn">
              {{ t('Previous') }}
            </button>
            <span class="tutorial-progress"
                  :title="isBranchingTutorial ? t('This tutorial lets you choose the level of detail: not all cards are visited') : ''">
              <template v-if="isBranchingTutorial">{{ t('Card {n}', { n: stepIndex + 1 }) }}</template>
              <template v-else>{{ stepIndex + 1 }} / {{ currentTutorial.steps.length }}</template>
            </span>
            <button v-if="showMeActions.length && !taskAccomplished && showMeReady" @click="runShowMe" :disabled="actionsRunning"
                    id="tutorial-show-me" class="tutorial-btn tutorial-btn-showme"
                    :title="t('Let the tutorial do it on the simulator (you can also do it yourself)')">
              ▶ {{ t('Show me') }}
            </button>
            <button v-for="target in successorSteps" :key="target.id"
                    @click="nextStep(target.id)"
                    :title="target.id === 'end' ? t('Finish tutorial') : t('Continue to {title}', { title: rt(target.title) })"
                    :disabled="!canProceed"
                    :class="['tutorial-btn', canProceed ? 'tutorial-btn-primary' : 'tutorial-btn-disabled']">
              {{ rt(target.label) }}
            </button>
            <button v-if="successorSteps.length === 0"
                    @click="completeTutorial"
                    :title="t('Finish tutorial; disabled if an action must be done first')"
                    :disabled="!canProceed"
                    :class="['tutorial-btn', canProceed ? 'tutorial-btn-primary' : 'tutorial-btn-disabled']">
              {{ t('Finish') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Question Overlay (centered like tutorial editor) -->
    <div v-if="currentTutorial && isActive && isQuestionStep" class="question-overlay">
      <div class="question-panel">
        <button @click="closeTutorial" class="question-close">&times;</button>

        <div class="question-header">
          <span class="question-badge">{{ t('Question {n}', { n: stepIndex + 1 }) }}</span>
          <span v-if="previewMode" class="preview-badge">PREVIEW</span>
          <h2 v-html="rt(currentStep?.title)"></h2>
        </div>

        <div class="question-body">
          <p class="question-text" v-html="rt(currentStep?.questionText)"></p>

          <div v-if="currentStep?.image" class="question-image" @click="openLightbox(currentStep.image)">
            <img :src="currentStep.image" alt="Question image">
            <span class="image-hint">{{ t('Click to enlarge') }}</span>
          </div>

          <div class="question-mode-info">
            <span v-if="currentStep?.answerMode === 'single'">{{ t('Select ONE correct answer') }}</span>
            <span v-else-if="isNumericQuestion">{{ t('Write a number') }}</span>
            <span v-else>{{ t('Select ALL correct answers') }}</span>
          </div>

          <div v-if="isNumericQuestion" class="numeric-answer">
            <input v-model="numericAnswer" type="text" inputmode="decimal" id="tutorial-numeric-answer"
                   :disabled="questionAnswered && isQuestionCorrect" @keyup.enter="submitAnswer"
                   :placeholder="t('your answer')" />
            <span v-if="currentStep?.numericUnit" class="numeric-unit">{{ currentStep.numericUnit }}</span>
            <div v-if="questionAnswered"
                 :class="['answer-feedback', isQuestionCorrect ? 'feedback-correct' : 'feedback-wrong']"
                 v-html="rt(isQuestionCorrect ? currentStep.numericCorrect : currentStep.numericWrong)">
            </div>
          </div>

          <div v-else class="answers-list">
            <div v-for="(answer, index) in shuffledAnswers" :key="answer.originalIndex" class="answer-wrapper">
              <button
                @click="selectAnswer(answer.originalIndex)"
                :class="getAnswerClass(answer.originalIndex)"
                :disabled="questionAnswered && isQuestionCorrect"
              >
                <span class="answer-letter">{{ String.fromCharCode(65 + index) }}</span>
                <span class="answer-text" v-html="rt(answer.text)"></span>
                <span v-if="questionAnswered && isQuestionCorrect  &&
                            answer.isCorrect" class="answer-indicator correct">✓</span>
                <span v-if="questionAnswered && !isQuestionCorrect &&
                            selectedAnswers.includes(answer.originalIndex) && !answer.isCorrect"
                            class="answer-indicator wrong">✗</span>
                <span v-if="questionAnswered && !isQuestionCorrect &&
                            selectedAnswers.includes(answer.originalIndex) && answer.isCorrect"
                            class="answer-indicator partial-correct">✓</span>
              </button>
              <!-- Inline feedback below each answer -->
              <div v-if="questionAnswered && selectedAnswers.includes(answer.originalIndex)
                         && answer.explanation"
                   :class="['answer-feedback', answer.isCorrect ? 'feedback-correct' : 'feedback-wrong']"
                   v-html="rt(answer.explanation)">
              </div>
            </div>
          </div>

          <!-- Summary message section -->
          <div v-if="questionAnswered" class="feedback-section">
            <div v-if="isQuestionCorrect" class="feedback-box feedback-correct">
              <h4>{{ t('✓ Correct!') }}</h4>
            </div>
            <div v-else class="feedback-box feedback-wrong">
              <h4>✗ {{ getErrorMessage() }}</h4>
            </div>
          </div>
        </div>

        <div class="question-actions">
          <button @click="previousStep" :disabled="!canGoBack"
               :title="t('Go to previous step on the tutorial')"
               class="tutorial-btn">
            {{ t('Previous') }}
          </button>

          <button v-if="!questionAnswered"
                  @click="submitAnswer"
                  :disabled="!canSubmit"
                  class="tutorial-btn tutorial-btn-primary">
            {{ t('Submit Answer') }}
          </button>

          <button v-else-if="!isQuestionCorrect"
                  @click="retryQuestion"
                  class="tutorial-btn tutorial-btn-retry">
            {{ t('Try Again') }}
          </button>

          <template v-else-if="isQuestionCorrect && successorSteps.length">
            <button v-for="target in successorSteps" :key="target.id"
                    @click="nextStep(target.id)"
                    class="tutorial-btn tutorial-btn-primary">
              {{ rt(target.label) }}
            </button>
          </template>
          <button v-else
                  @click="completeTutorial"
                  :title="t('Finish the tutorial')"
                  class="tutorial-btn tutorial-btn-primary">
            {{ t('Finish') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Image Lightbox Popup -->
    <div v-if="showLightbox" class="lightbox-overlay" @click="closeLightbox">
      <div class="lightbox-content" @click.stop>
        <button class="lightbox-close" @click="closeLightbox">&times;</button>
        <img :src="lightboxImage" alt="Enlarged image">
      </div>
    </div>

    <!-- Tutorial Launcher Button -->
    <div v-if="!isActive" class="tutorial-launcher">
      <button @click="toggleTutorialMenu" :title="t('Open Tutorial')" class="tutorial-launcher-btn">
        <span class="tutorial-icon">?</span>
      </button>

      <!-- Tutorial Menu -->
      <div v-if="showTutorialMenu" class="tutorial-menu">
        <h4>{{ t('Available Tutorials') }}</h4>

        <!-- Show resume option if there's a paused tutorial -->
        <div v-if="currentTutorial" class="tutorial-paused-section">
          <div class="tutorial-paused-header">
            <h5>{{ t('📚 Tutorial in Progress') }}</h5>
            <p class="tutorial-paused-info" v-html="rt(currentTutorial.name)"></p>
          </div>

          <div class="tutorial-action-buttons">
            <button @click="resumeTutorial"
              :title="t('Resume the tutorial at the step where was left')"
              class="tutorial-action-btn tutorial-resume-btn">
              <div class="tutorial-action-icon">▶️</div>
              <div class="tutorial-action-content">
                <strong>{{ t('Resume') }}</strong>
                <span>{{ t('Step {n} of {total}', { n: stepIndex + 1, total: currentTutorial.steps.length }) }}</span>
              </div>
            </button>

            <button @click="stopTutorial"
              :title="t('Stop the tutorial and reset tutorial progress to first step')"
              class="tutorial-action-btn tutorial-stop-btn">
              <div class="tutorial-action-icon">⏹️</div>
              <div class="tutorial-action-content">
                <strong>{{ t('Stop') }}</strong>
                <span>{{ t('Start fresh') }}</span>
              </div>
            </button>
          </div>

          <div class="tutorial-menu-separator"></div>
        </div>

        <div v-else class="tutorial-list">
          <div
            v-for="tutorial in visibleTutorials"
            :key="tutorial.id"
            class="tutorial-item-wrapper"
          >
            <button
              @click="startTutorial(tutorial.id)"
              :title="t('Start this tutorial')"
              class="tutorial-menu-item"
            >
              <div class="tutorial-item-content">
                <strong v-html="rt(tutorial.name)"></strong>
                <p v-html="rt(tutorial.description)"></p>
              </div>
            </button>
            <button v-if="!lessonLocked('tutorialEditor')"
              @click="editTutorial(tutorial.id)"
              :title="t('Edit this tutorial in the tutorial editor')"
              class="tutorial-delete-btn tutorial-edit-btn"
            >
            ✎
            </button>
            <button v-if="!lessonLocked('remove')"
              @click="deleteTutorial(tutorial.id)"
              :title="t('Delete this tutorial from the list (and local storage)')"
              id="remove-tutorial-button"
              class="tutorial-delete-btn"
            >
            🧹
            </button>
          </div>

          <button v-if="!lessonLocked('upload')"
            @click="addTutorial"
            :title="t('Upload new tutorial')"
            class="tutorial-menu-item"
          >
            <div class="tutorial-item-content">
              <strong>{{ t('ADD NEW TUTORIAL') }}</strong>
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>

import { ref, toRef, toRaw, computed, inject, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useDraggable, useResizeObserver}                                           from '@vueuse/core'
import {
  initResource, removeFromLocalStorage, uploadJSON,
  migrateTutorialFlow
} from '@/common'
import { renderTutorialText, tutorialNumber }                                    from '@/tutorialValues'
import { t, localized }                                                          from '@/i18n'
import { createActionRunner, actionList, takeSnapshot, savedSnapshot, clearSnapshot } from '@/tutorialActions'
import { processorDraftFrom, processorSignature }                               from '@/editDrafts'
import { isLocked, evaluateCondition }                                          from '@/lessons'
import { tutorialValue }                                                        from '@/tutorialValues'
const simState = inject('simulationState');

// ============================================================================
// Tutorial progress & localStorage
// ============================================================================
const STORAGE_KEY = 'tutorialOptions'

const defaultOptions = {
  available:      [],
  inProgressID:   "",
  progressStep:    0,
  progressStepId: "",
  progressHistory: [],
  windowWidth:   200,
  windowHeight:  200,
  x_pos:          10,
  y_pos:          10
}

const tutorialOptions  = reactive(defaultOptions)

// Core tutorial state
const currentTutorial = ref(null)
const stepIndex       = ref(0)
const isActive        = ref(false)

  const loadOptions = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        Object.assign(tutorialOptions, JSON.parse(saved))
        console.log('👨‍🎓load options (core)')
      }
      else {
        saveOptions() // Save defaults if no options were saved before
        console.log('👨‍🎓default load options')
      }
    } catch (error) {
      console.error('👨‍🎓❌ Failed to load:', error)
    }
  }

  const saveOptions = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tutorialOptions))
    } catch (error) {
      console.error('👨‍🎓❌ Failed to save (core):', error)
    }
  }

  // During a lesson only its tutorial is offered
  const visibleTutorials = computed(() => simState.lesson
    ? tutorialOptions.available.filter(t => t.id === simState.lesson.tutorial)
    : tutorialOptions.available)
  const lessonLocked = (what) => isLocked(simState.lesson, what, simState.lessonAllow ?? [])

// ============================================================================
// PROPS & EMITS
// ============================================================================
// emit signal to simulatorView in order to switch panels
const emit  = defineEmits(['requestSwitchPanel', 'requestSwitchFull'])
const props = defineProps({
  activeView: { type: String, default: 'simulationComponent' },   // panel shown on the right
  activeFull: { type: String, default: 'none' },                  // full-screen editor, if any
})

// ============================================================================
// Draggable & resizable full-screen graph container
// ============================================================================

  const HEADER_HEIGHT = 40
  const MIN_W = 100
  const MIN_H = 100
  const VIEWPORT_MARGIN = 16

  const headerRef  = ref(null)
  const contentRef = ref(null)

  const x = toRef(tutorialOptions, 'x_pos')
  const y = toRef(tutorialOptions, 'y_pos')

  useDraggable(headerRef, {
    initialValue: { x: tutorialOptions.x_pos, y: tutorialOptions.y_pos },

    onMove(pos) {

      const rect = contentRef.value?.getBoundingClientRect()
      const w = rect?.width || tutorialOptions.windowWidth
      const h = rect?.height || tutorialOptions.windowHeight

      x.value = clamp(pos.x, VIEWPORT_MARGIN, window.innerWidth - w - VIEWPORT_MARGIN)
      y.value = clamp(pos.y, HEADER_HEIGHT, window.innerHeight - h - VIEWPORT_MARGIN)

      const step = currentStep.value
      if (step) {
        step.x_pos = x.value
        step.y_pos = y.value
      }
    }
  })

  useResizeObserver(contentRef, (entries) => {
    const { width: w, height: h } = entries[0].contentRect

    const maxWidth  = Math.max(MIN_W, window.innerWidth - VIEWPORT_MARGIN * 2)
    const maxHeight = Math.max(MIN_H, window.innerHeight - HEADER_HEIGHT - VIEWPORT_MARGIN)

    tutorialOptions.windowWidth  = Math.max(MIN_W, Math.min(w, maxWidth))
    tutorialOptions.windowHeight = Math.max(MIN_H, Math.min(h, maxHeight))

    x.value = clamp(x.value, VIEWPORT_MARGIN, window.innerWidth - tutorialOptions.windowWidth - VIEWPORT_MARGIN)
    y.value = clamp(y.value, HEADER_HEIGHT, window.innerHeight - tutorialOptions.windowHeight - VIEWPORT_MARGIN)
    // The measured size is not stored in the step: fixing it as the card style cut the content
    // of some cards (the card grows with its content; a manual resize is kept by the browser)
  })

  const handleWindowResize = () => {
    const step = currentStep.value
    if (step && Number.isFinite(step.x_pos) && Number.isFinite(step.y_pos)) {
      x.value = clamp(x.value, VIEWPORT_MARGIN, window.innerWidth - tutorialOptions.windowWidth - VIEWPORT_MARGIN)
      y.value = clamp(y.value, HEADER_HEIGHT, window.innerHeight - tutorialOptions.windowHeight - VIEWPORT_MARGIN)
      step.x_pos = x.value
      step.y_pos = y.value
    } else if (step) nextTick(positionCurrentTooltip)
  }

  window.addEventListener('resize', handleWindowResize)

// ============================================================================
// Tutorial STATE
// ============================================================================

// refer to this variable to force evaluation of validation state
const validationState  = ref({})
const showTutorialMenu = ref(false)
const highlightElement = ref(null)

// Question state
const selectedAnswers       = ref([])
const questionAnswered      = ref(false)
const shuffledAnswerIndices = ref([])

// Button click tracking
const clickedButtons        = ref(new Set())
const trackedButtonElements = ref([])

// Lightbox state
const lightboxImage = ref('')
const showLightbox  = ref(false)

// Event listeners storage (reactive for proper cleanup)
const validationEventListeners = ref([])

// ============================================================================
// COMPUTED PROPERTIES
// ============================================================================
const currentStep = computed(() =>
   currentTutorial.value?.steps?.[stepIndex.value] ?? null
)

const successorSteps = computed(() => {
  const steps = currentTutorial.value?.steps || []
  const step = currentStep.value
  if (!step) return []
  // Button text: the label written for that successor (nextLabels), or the target title
  return (step.next || [])
    .map((id, slot) => {
      const target = id === 'end'
        ? { id: 'end', title: t('End Tutorial') }
        : steps.find(candidate => candidate.id === id)
      if (!target) return null
      const custom = String(localized(step.nextLabels?.[slot]) ?? '').trim()
      return { id: target.id, title: target.title, label: custom || target.title }   // translated when shown (rt)
    })
    .filter(Boolean)
})

const canGoBack = computed(() =>
  Array.isArray(tutorialOptions.progressHistory) && tutorialOptions.progressHistory.length > 0
)

const isQuestionStep = computed(() =>
  currentStep.value?.type === 'question'
)

// With branches (cards with two successors) a "k / N" counter is misleading
const isBranchingTutorial = computed(() =>
  (currentTutorial.value?.steps ?? []).some(step => (step.next ?? []).length > 1)
)

// Text of the cards with the live values of the simulator ({{name}})
// Texts of the tutorials can be given in several languages: { en, es, ca } (localized)
const rt = (text) => renderTutorialText(localized(text), simState)

// Numeric questions (answerMode "number"): numericValue (a number or a live value such as
// "{{minTime}}"), tolerance (absolute, 0.01 by default), numericCorrect / numericWrong texts
const numericAnswer     = ref('')
const isNumericQuestion = computed(() => currentStep.value?.type === 'question' && currentStep.value.answerMode === 'number')
const canSubmit = computed(() => isNumericQuestion.value
  ? numericAnswer.value.trim() !== '' && Number.isFinite(Number(numericAnswer.value.replace(',', '.')))
  : selectedAnswers.value.length > 0)

const isQuestionCorrect = computed(() => {
  if (!currentStep.value || currentStep.value.type !== 'question') return false
  if (isNumericQuestion.value) {
    const target = tutorialNumber(currentStep.value.numericValue, simState)
    const given  = Number(numericAnswer.value.replace(',', '.'))
    const tol    = Number(currentStep.value.tolerance ?? 0.01)
    return target !== null && Number.isFinite(given) && Math.abs(given - target) <= tol + 1e-9
  }

  const answers        = currentStep.value.answers || []
  const correctIndices = answers.reduce((acc, a, i) => a.isCorrect ? [...acc, i] : acc, [])

  if (currentStep.value.answerMode === 'single') {
    return selectedAnswers.value.length === 1 && correctIndices.includes(selectedAnswers.value[0])
  }

  const hasAllCorrect = correctIndices.every(i => selectedAnswers.value.includes(i))
  const hasNoWrong    = selectedAnswers.value.every(i => correctIndices.includes(i))
  return hasAllCorrect && hasNoWrong
})

const shuffledAnswers = computed(() => {
  if (!currentStep.value || currentStep.value.type !== 'question') return []
  const answers = currentStep.value.answers || []
  if (!shuffledAnswerIndices.value.length) {
    return answers.map((a, i) => ({ ...a, originalIndex: i }))
  }
  return shuffledAnswerIndices.value.map(i => ({ ...answers[i], originalIndex: i }))
})

// The user can advance when the validation of the card is met and, in a prediction or goal card,
// its task is done. In a prediction card the validation comes first (e.g. look at the C code):
// then the prediction is asked (doneDescription and the prediction box), and only when it is
// saved the simulation can be run (Show me, or the Run Simulation button, blocked until then)
const canProceed = computed(() => {
  const type = currentStep.value?.type
  if (type === 'predict' && !taskState.value.result) return false
  if (type === 'goal'    && !taskState.value.done)   return false
  return validationMet.value
})

const validationMet = computed(() => {
  const validation = currentStep.value?.validation
  if (!validation) return true

  // Force reactivity
  validationState.value

  try {
    const { type, selector, value, minValue } = validation
    switch (type) {
      case 'program_selected':
        return simState.simulatedProcess?.name === value
      case 'architecture_selected':
        return simState.processorName === value
      case 'input_value':
        return document.querySelector(selector)?.value === value
      case 'input_value_min':
        return parseInt(document.querySelector(selector)?.value) >= minValue
      case 'button_clicked':
        return selector && clickedButtons.value.has(clickKey(currentStep.value, selector))
      default:
        return extraValidation(validation)
    }
  } catch (e) {
    console.warn('👨‍🎓⚠️Validation check error:', e)
    return true
  }
})

// ============================================================================
// HIGHLIGHTING
// ============================================================================
const isElementVisible = (el) => {
  const rect = el.getBoundingClientRect()
  return rect.top < window.innerHeight && rect.bottom > 0 &&
         rect.left < window.innerWidth && rect.right > 0
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max))

// ---- Placement of a card in an empty zone near its target ----
// The visible content of the simulator (text, tables, diagrams, controls) is collected as
// obstacles, with a small gap around them; the card goes to the position that covers the least
// content and, among those, the closest to the preferred side of the target (bottom, top,
// right, left; inside-bottom and inside-top place it within the target, e.g. a panel used as
// an anchor). The highlighted target keeps a wider gap.
const CONTENT_TAGS = new Set(['TABLE', 'svg', 'IMG', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'PRE', 'H1', 'H2', 'H3', 'H4', 'LABEL'])
const CONTENT_GAP = 10
const TARGET_GAP  = 18
const inflate = (r, g) => ({ left: r.left - g, top: r.top - g, right: r.right + g, bottom: r.bottom + g })
function contentObstacles(avoidRect) {
  const maxArea = window.innerWidth * window.innerHeight * 0.4
  const rects = []
  const roots = [document.querySelector('main.container'), document.querySelector('#lesson-bar-slot')].filter(Boolean)
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (el.closest('.tutorial-overlay, .tutorial-system')) continue
      const own = CONTENT_TAGS.has(el.tagName) ||
        [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      if (!own) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2 || r.width * r.height > maxArea) continue
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue
      rects.push(inflate(r, CONTENT_GAP))
    }
  }
  if (avoidRect) rects.push(inflate(avoidRect, TARGET_GAP))
  return rects
}

function coveredArea(obstacles, left, top, width, height) {
  let covered = 0
  for (const o of obstacles) {
    const w = Math.min(left + width, o.right) - Math.max(left, o.left)
    if (w <= 0) continue
    const h = Math.min(top + height, o.bottom) - Math.max(top, o.top)
    if (h > 0) covered += w * h
  }
  return covered
}

function placeInEmptyZone(refRect, width, height, preferred, avoidRect, obstacles = contentObstacles(avoidRect)) {
  const margin = VIEWPORT_MARGIN
  const cx = refRect.left + refRect.width / 2, cy = refRect.top + refRect.height / 2
  const side = (preferred || 'bottom').replace('inside-', '')
  const point = { bottom: [cx, refRect.bottom], top: [cx, refRect.top], right: [refRect.right, cy], left: [refRect.left, cy] }[side] ?? [cx, refRect.bottom]
  let xMin = margin, yMin = HEADER_HEIGHT
  let xMax = window.innerWidth - width - margin, yMax = window.innerHeight - height - margin
  if ((preferred || '').startsWith('inside-')) {       // within the anchor, when the card fits in it
    const inner = { xMin: Math.max(xMin, refRect.left + margin), xMax: Math.min(xMax, refRect.right - width - margin),
                    yMin: Math.max(yMin, refRect.top + margin),  yMax: Math.min(yMax, refRect.bottom - height - margin) }
    if (inner.xMin <= inner.xMax) { xMin = inner.xMin; xMax = inner.xMax }
    if (inner.yMin <= inner.yMax) { yMin = inner.yMin; yMax = inner.yMax }
  }
  const STEP = 12
  let best = null
  for (let top = yMin; top <= Math.max(yMin, yMax); top += STEP) {
    for (let left = xMin; left <= Math.max(xMin, xMax); left += STEP) {
      const covered = coveredArea(obstacles, left, top, width, height)
      const dx = Math.max(left - point[0], 0, point[0] - left - width)
      const dy = Math.max(top - point[1], 0, point[1] - top - height)
      // (and, slightly, centered on that point)
      const cost = covered * 4 + Math.hypot(dx, dy) + 0.01 * Math.hypot(left + width / 2 - point[0], top + height / 2 - point[1])
      if (!best || cost < best.cost) best = { cost, covered, left, top }
    }
  }
  return best ?? { left: xMin, top: yMin, covered: 0 }
}

const positionCurrentTooltip = async () => {
  const step = currentStep.value
  if (!step || !contentRef.value) return

  // Measure the card at its natural size: restore the size from the tutorial file (if any)
  // and place it where it has the whole width, so its text is not wrapped by the old position
  const size = authoredSize.get(step) ?? {}
  step.wWidth  = size.w
  step.wHeight = size.h
  // forget a manual resize of the previous card (set by the browser on the element)
  contentRef.value.style.width  = size.w ? `${size.w}px` : ''
  contentRef.value.style.height = size.h ? `${size.h}px` : ''
  // the card is measured out of sight: it appears only at its final place
  measuring.value = true
  const savedX = x.value, savedY = y.value
  x.value = VIEWPORT_MARGIN
  y.value = HEADER_HEIGHT
  await nextTick()

  try {
    const tooltipRect = contentRef.value?.getBoundingClientRect()
    if (!tooltipRect) { x.value = savedX; y.value = savedY; return }

    tutorialOptions.windowWidth = tooltipRect.width
    tutorialOptions.windowHeight = tooltipRect.height

    if (Number.isFinite(step.x_pos) && Number.isFinite(step.y_pos)) {
      x.value = clamp(step.x_pos, VIEWPORT_MARGIN, window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN)
      y.value = clamp(step.y_pos, HEADER_HEIGHT, window.innerHeight - tooltipRect.height - VIEWPORT_MARGIN)
      return
    }

    const place = cardReference(step)
    if (place) {
      const position = placeInEmptyZone(place.refRect, tooltipRect.width, tooltipRect.height, place.preferred, place.avoidRect)
      x.value = position.left
      y.value = position.top
      return
    }

    x.value = clamp((window.innerWidth - tooltipRect.width) / 2, VIEWPORT_MARGIN, window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN)
    y.value = clamp((window.innerHeight - tooltipRect.height) / 2, HEADER_HEIGHT, window.innerHeight - tooltipRect.height - VIEWPORT_MARGIN)
  } finally {
    measuring.value = false
  }
}

// The card is placed near an anchor (a selector used only to place it, e.g. a panel), or the
// highlighted target, or the right panel; the highlighted target is never covered
function cardReference(step) {
  const target = highlightElement.value
  let anchor = null
  if (step.anchor) {
    try { anchor = [...document.querySelectorAll(step.anchor)].find(el => el.getClientRects().length > 0) ?? null } catch { anchor = null }
  }
  const refEl = anchor ?? target ?? document.querySelector('#right-panel')
  const refRect = refEl?.getBoundingClientRect()
  if (!refRect || refRect.width <= 0) return null
  const avoid = target?.getBoundingClientRect()
  return { refRect, preferred: step.position || 'bottom', avoidRect: avoid && avoid.width > 0 ? avoid : null }
}

// When the simulator shows new content (e.g. the results of a simulation started from the card),
// a card that now covers it moves to the place that covers the least (unless it was moved by hand)
let contentObserver = null
let replaceTimer = null
function replaceIfCovering() {
  const step = currentStep.value
  const el = contentRef.value
  if (!step || !el || isQuestionStep.value || measuring.value || actionsRunning.value) return
  if (Number.isFinite(step.x_pos) && Number.isFinite(step.y_pos)) return
  const place = cardReference(step)
  if (!place) return
  const r = el.getBoundingClientRect()
  const obstacles = contentObstacles(place.avoidRect)
  const now = coveredArea(obstacles, r.left, r.top, r.width, r.height)
  if (now === 0) return
  const best = placeInEmptyZone(place.refRect, r.width, r.height, place.preferred, place.avoidRect, obstacles)
  if (best.covered < now * 0.8) { x.value = best.left; y.value = best.top }
}
function observeContent() {
  contentObserver?.disconnect()
  const main = document.querySelector('main.container')
  if (!main) return
  contentObserver = new MutationObserver((records) => {
    if (records.every(rec => rec.target.closest?.('.tutorial-system') || rec.target.parentElement?.closest('.tutorial-system'))) return
    clearTimeout(replaceTimer)
    replaceTimer = setTimeout(replaceIfCovering, 400)
  })
  contentObserver.observe(main, { childList: true, subtree: true, characterData: true })
}

// A card moved by the student (or placed in the tutorial file) appears directly at its place
const measuring = ref(false)
watch(currentStep, (step) => {
  if (step && Number.isFinite(step.x_pos) && Number.isFinite(step.y_pos)) {
    x.value = step.x_pos
    y.value = step.y_pos
  }
}, { flush: 'sync' })

// ============================================================================
// ACTIONS ON THE SIMULATOR (card fields actions / showMe) and state restored at the end
// ============================================================================
const actionsRunning = ref(false)
const showMeActions  = computed(() => actionList(currentStep.value?.showMe))
// In a prediction card, Show me (it simulates) is offered once the prediction is saved
const showMeReady = computed(() => currentStep.value?.type !== 'predict'
  || (validationMet.value && taskState.value.prediction !== undefined))
// Comment after the result of a prediction (texts of the card predictGood / predictFar)
const predictComment = computed(() => {
  const step = currentStep.value, r = taskState.value.result
  if (!step || !r || r.good === null) return ''
  return rt(r.good ? step.predictGood : step.predictFar) || ''
})

// Show me is not offered once what it does is done: the simulation of a prediction, the goal,
// or the validation of the card
const taskAccomplished = computed(() => {
  const step = currentStep.value
  if (!step) return false
  if (step.type === 'predict') return !!taskState.value.result
  if (step.type === 'goal')    return !!taskState.value.done
  return !!step.validation && canProceed.value
})
const tutorialHasActions = (tutorial) =>
  (tutorial?.steps ?? []).some(s => actionList(s.actions).length || actionList(s.showMe).length)

let previewSnapshot = null
async function restoreSnapshot(snap = savedSnapshot()) {
  if (!snap) return
  await runActions([`selectProcessor:${snap.processor}`])
  if (snap.processorConfig && processorSignature(simState.simulatedProcess) !== processorSignature(snap.processorConfig)) {
    const config = JSON.parse(JSON.stringify(snap.processorConfig))
    delete config.name                       // the name of the simulated process is the program's
    Object.assign(simState.simulatedProcess, config)
  }
  await runActions([`selectProgram:${snap.program}`, ...(snap.N ? [`setN:${snap.N}`] : [])])
  if (snap.settings) Object.assign(simState.simulationSettings, snap.settings)
  if (snap.view) emit('requestSwitchPanel', snap.view)
}

const runActions = createActionRunner({
  simState,
  switchPanel: (name) => emit('requestSwitchPanel', name),
  snapshot: { restore: () => restoreSnapshot(previewMode.value ? previewSnapshot : savedSnapshot()) },
})

async function runCardActions(list) {
  if (!actionList(list).length) return
  actionsRunning.value = true
  try { await runActions(list) } finally { actionsRunning.value = false }
}

async function runShowMe() {
  await runCardActions(currentStep.value?.showMe)
  await highlightCurrent()
}

// Simulations done since the card was shown (validation simulation_done). The results of the
// simulation that validated a card are remembered: going back to the card, it is still valid
// while those results are shown (a change of program, processor... clears them)
const simulationCount = ref(0)
let   stepSimulationStart = 0
const resultsOfCard = new Map()        // card id -> results that validated it
watch(() => simState.executionResults, (r) => {
  if (!r || !Object.keys(r).length) return
  simulationCount.value++
  const step = currentStep.value
  if (step?.validation?.type === 'simulation_done') resultsOfCard.set(step.id, toRaw(r))
  checkTaskAfterSimulation()
})
function resultsStillShown() {
  const r = simState.executionResults
  return !!r && resultsOfCard.get(currentStep.value?.id) === toRaw(r)
}

// ============================================================================
// TASKS (cards predict and goal; questions): state per card, recorded in the lesson
// ============================================================================
// taskStates: { cardId: { prediction, predictedAt, result, last, done, best } } (this session);
// in a lesson, the completed tasks are also kept in simState.lesson.done
const taskStates = ref({})
const taskState  = computed(() => taskStates.value[currentStep.value?.id] ?? {})
const setTask    = (id, data) => { taskStates.value = { ...taskStates.value, [id]: { ...(taskStates.value[id] ?? {}), ...data } } }
const formatNumber = (v) => (typeof v === 'number' ? Number(v.toFixed(3)).toLocaleString('en-US') : String(v ?? '…'))

function markTask(id, data = {}) {
  const lesson = simState.lesson
  if (!lesson || !(lesson.tasks ?? []).includes(id)) return
  lesson.done = { ...(lesson.done ?? {}), [id]: { ...(lesson.done?.[id] ?? {}), ...data, done: true } }
}

const predictionInput = ref('')
const validPrediction = computed(() => predictionInput.value.trim() !== '' &&
  Number.isFinite(Number(predictionInput.value.replace(',', '.'))))
function savePrediction() {
  if (!validPrediction.value || taskState.value.result) return
  setTask(currentStep.value.id, { prediction: Number(predictionInput.value.replace(',', '.')), predictedAt: simulationCount.value })
}

function checkTaskAfterSimulation() {
  const step = currentStep.value
  if (!isActive.value || !step) return
  const st = taskStates.value[step.id] ?? {}
  if (step.type === 'predict' && st.prediction !== undefined && !st.result && simulationCount.value > st.predictedAt) {
    const actual = tutorialValue(step.predictValue ?? 'cyclesPerIter', simState)?.value ?? null
    const tol = step.tolerance === undefined ? null : Number(step.tolerance)
    const good = tol === null || actual === null ? null : Math.abs(actual - st.prediction) <= tol + 1e-9
    setTask(step.id, { result: { actual, good } })
    markTask(step.id, { prediction: st.prediction, actual })
  }
  if (step.type === 'goal') {
    if (step.program && simState.simulatedProcess?.name !== step.program) {
      setTask(step.id, { last: { ok: false, message: t('the goal is for program {p}', { p: step.program }), values: {} } })
      return
    }
    const { ok, values, error } = evaluateCondition(step.goal, simState)
    const last = { ok, values, message: error ? t('condition error: {e}', { e: error }) : '' }
    if (!ok) { setTask(step.id, { last }); return }
    const value = step.best ? tutorialValue(step.best, simState)?.value ?? null : null
    const better = value !== null && (st.best === undefined ||
      ((step.bestMode ?? 'min') === 'min' ? value < st.best : value > st.best))
    const best = better ? value : st.best
    setTask(step.id, { last, done: true, best })
    markTask(step.id, { values, ...(best !== undefined ? { best } : {}) })
  }
}

// While a goal card is shown, the lesson allows what the goal lists (e.g. "processor.rob")
watch(() => [isActive.value, currentStep.value], () => {
  const step = currentStep.value
  simState.lessonAllow = isActive.value && step?.type === 'goal' ? [...(step.allow ?? [])] : []
  predictionInput.value = step ? String(taskStates.value[step.id]?.prediction ?? '') : ''
})

// The lesson starts and stops its tutorial
watch(() => simState.lessonTutorial?.nonce, async () => {
  const request = simState.lessonTutorial
  if (!request) return
  if (request.action === 'stop') {
    if (currentTutorial.value) await endTutorial(true)
    return
  }
  const { id } = request
  if (!tutorialOptions.available.some(t => t.id === id)) {
    try {
      const t = JSON.parse(localStorage.getItem(`tutorial.${id}`))
      tutorialOptions.available = [...tutorialOptions.available, { id, name: t.name, description: t.description }]
    } catch (e) { console.error('👨‍🎓❌ Lesson tutorial not found:', e); return }
  }
  if (currentTutorial.value && isActive.value) await endTutorial(true)
  taskStates.value = {}
  await startTutorial(id)
})

// After a lesson, forget the tutorials whose files it removed (embedded in the lesson)
watch(() => simState.lesson, (lesson) => {
  if (lesson) return
  tutorialOptions.available = tutorialOptions.available.filter(t => localStorage.getItem(`tutorial.${t.id}`) !== null)
})

// Validations on the state of the simulator
function extraValidation(v) {
  switch (v.type) {
    case 'simulation_done': {        // a simulation done in this card (or remembered), whose results are shown
      const r = simState.executionResults
      return !!r && Object.keys(r).length > 0 && (simulationCount.value > stepSimulationStart || resultsStillShown())
    }
    case 'chain_selected':  return simState.analysisView?.chain === v.value
    case 'graph_open':      return !!simState.analysisView?.graphOpen
    case 'timeline_option': return v.value === 'critical' ? !!simState.timelineCriticalPathEnabled : true
    default:                return true
  }
}

const clearHighlights = () => {
  document.querySelectorAll('.tutorial-highlighted').forEach(el => {
    el.classList.remove('tutorial-highlighted', 'tutorial-highlight-pulse')
  })
}

const showCurrentStep = async () => {
  if (currentStep.value?.type === 'question') {
    clearHighlights()
    highlightElement.value = null
    stepSimulationStart = simulationCount.value
    await runCardActions(currentStep.value.actions)
    return
  }

  stepSimulationStart = simulationCount.value

  // Execute step action (old single action) and the actions of the card
  if (currentStep.value.action) {
    try {
      await currentStep.value.action()
      await nextTick()
      await delay(300)
    } catch (e) {
      console.error('👨‍🎓❌ Step action error:', e)
    }
  }
  const step = currentStep.value
  // placed at once if its target is already shown, so it does not appear first somewhere else
  if (actionList(step.actions).length && !Number.isFinite(step.x_pos) && targetShown(step.selector)) await highlightCurrent()
  await runCardActions(step.actions)
  if (currentStep.value !== step) return       // the student moved on meanwhile

  await highlightCurrent()
  setupValidationListeners()
  setupButtonClickTracking()
}

function targetShown(sel) {
  if (!sel || sel.includes(':contains(')) return false
  try { return [...document.querySelectorAll(sel)].some(el => el.getClientRects().length > 0) } catch { return false }
}

// Highlight the element(s) of the selector of the card (a list of selectors may match several
// elements, e.g. two rows of the program) and place the card next to the first one
async function highlightCurrent() {
  clearHighlights()
  const sel = currentStep.value?.selector
  if (!sel) { highlightElement.value = null; await nextTick(); await positionCurrentTooltip(); return }

  let elements = []
  if (sel.includes(':contains(')) {
    const match = sel.match(/^([^:]+):contains\("([^"]+)"\)$/)
    if (match) {
      elements = Array.from(document.querySelectorAll(match[1]))
        .filter(el => el.textContent.includes(match[2])).slice(0, 1)
    }
  } else {
    // a list of selectors ("a, b") highlights every match; a single selector, its first match
    try { elements = sel.includes(',') ? Array.from(document.querySelectorAll(sel)) : [document.querySelector(sel)].filter(Boolean) }
    catch { elements = [] }
  }
  // A hidden element (e.g. a panel replaced by a full-screen editor) cannot be highlighted:
  // the card is then centered instead of being placed next to an invisible box
  elements = elements.filter(el => el.getClientRects().length > 0)
  const element = elements[0] ?? null
  highlightElement.value = element

  tutorialOptions.windowWidth = currentStep.value.wWidth || 320
  tutorialOptions.windowHeight = currentStep.value.wHeight || 180

  for (const el of elements) el.classList.add('tutorial-highlighted', 'tutorial-highlight-pulse')
  if (element && !isElementVisible(element)) element.scrollIntoView({ behavior: 'auto', block: 'center' })

  await nextTick()
  await positionCurrentTooltip()
}

// Card sizes written in the tutorial file (sizes measured at run time are not kept between cards)
const authoredSize = new WeakMap()

const processStepActions = (steps) => steps.map(step => {
  authoredSize.set(step, { w: step.wWidth, h: step.wHeight })
  if (step.action && typeof step.action === 'string') {
    const [actionType, param] = step.action.split(':')
    if (actionType === 'switchTo') {
      step.action = () => {
        emit('requestSwitchPanel', param)
        console.log(`👨‍🎓⏺️ STEP action: switchTo ${param}`)
      }
    } else if (actionType === 'switchToFull') {
      step.action = () => {
        emit('requestSwitchFull', param)
        console.log(`👨‍🎓⏺️ STEP action: switchToFull ${param}`)
      }
    }
  }
  return step
})

// ============================================================================
// LIGHTBOX
// ============================================================================
const openLightbox = (src) => { lightboxImage.value = src;  showLightbox.value  = true }
const closeLightbox = () =>   { showLightbox.value = false; lightboxImage.value = '' }

// ============================================================================
// VALIDATION
// ============================================================================
const showValidationMessage = (message) => {
  const div = document.createElement('div')
  div.textContent = message
  div.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #ff6b6b; color: white; padding: 15px 25px; border-radius: 8px;
    font-size: 14px; z-index: 10002; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 3000)
}

const validateCurrentStep = async () => {
  const v = currentStep.value?.validation
  if (!v) return true

  const getElement = (sel) => document.querySelector(sel)

  const validators = {
    program_selected: () =>      simState.simulatedProcess?.name === v.value,
    architecture_selected: () => simState.processorName === v.value,
    input_value: () =>           getElement(v.selector)?.value === v.value,
    input_value_min: () =>       parseInt(getElement(v.selector)?.value) >= v.minValue,
    button_clicked: () =>        v.selector && clickedButtons.value.has(clickKey(currentStep.value, v.selector))
  }
  validators[v.type] ??= () => extraValidation(v)

  const isValid = validators[v.type]?.() ?? true
  if (!isValid) showValidationMessage(rt(v.message) || t('Please complete this action'))
  return isValid
}

const setupValidationListeners = () => {
  cleanupValidationListeners()
  const v = currentStep.value?.validation
  if (!v) return

  const selectorMap = {
    program_selected:      '#programs-list',
    architecture_selected: '#processors-list',
    input_value:            v.selector,
    input_value_min:        v.selector
  }

  const selector = selectorMap[v.type]
  if (!selector) return

  const el = document.querySelector(selector)
  if (!el) return

  const handler = () => { validationState.value = { t: Date.now() } }

  ;['change', 'input', 'keyup'].forEach(evt => {
    el.addEventListener(evt, handler)
    validationEventListeners.value.push({ element: el, eventType: evt, handler })
  })
}

// a click is required by each card that asks for it (the same element in two cards: two clicks)
const clickKey = (step, selector) => `${step?.id ?? ''}|${selector.trim()}`

const setupButtonClickTracking = () => {
  cleanupButtonClickTracking()

  const v = currentStep.value?.validation
  if (v?.type !== 'button_clicked' || !v.selector) return

  const selector = v.selector.trim()

  const attach = () => {
    const btn = document.querySelector(selector)
    if (!btn) return false

    const key = clickKey(currentStep.value, selector)
    const handler = () => {
      console.log(`👨‍🎓⏺️ Button clicked: ${selector}`)
      clickedButtons.value.add(key)
      validationState.value = { t: Date.now() }
    }
    btn.addEventListener('click', handler)
    trackedButtonElements.value.push({ element: btn, handler })
    return true
  }

  if (!attach()) setTimeout(attach, 500)
}

// ============================================================================
// BUTTON CLICK TRACKING
// ============================================================================

const cleanupValidationListeners = () => {
  validationEventListeners.value.forEach(({ element, eventType, handler }) => {
    element.removeEventListener(eventType, handler)
  })
  validationEventListeners.value = []
}

const cleanupButtonClickTracking = () => {
  trackedButtonElements.value.forEach(({ element, handler }) => {
    try { element.removeEventListener('click', handler) } catch { /* element already detached */ }
  })
  trackedButtonElements.value = []
}

const cleanup = () => {
  clearHighlights()
  cleanupValidationListeners()
  cleanupButtonClickTracking()

  clickedButtons.value = new Set()
  resetQuestionState()
}

// ============================================================================
// QUESTION HANDLING
// ============================================================================

const shuffleAnswers = () => {
  if (currentStep.value?.type !== 'question') {
    shuffledAnswerIndices.value = []
    return
  }
  const indices = (currentStep.value.answers || []).map((_, i) => i)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  shuffledAnswerIndices.value = indices
}

const selectAnswer = (index) => {
  if (questionAnswered.value) return

  if (currentStep.value.answerMode === 'single') {
    selectedAnswers.value = [index]
  } else {
    const idx = selectedAnswers.value.indexOf(index)
    idx === -1 ? selectedAnswers.value.push(index) : selectedAnswers.value.splice(idx, 1)
  }
}

const submitAnswer = () => {
  if (!canSubmit.value) return
  questionAnswered.value = true
  if (isQuestionCorrect.value)
    markTask(currentStep.value.id, isNumericQuestion.value ? { answer: Number(numericAnswer.value.replace(',', '.')) }
                                                           : { answer: [...selectedAnswers.value] })
}

const resetQuestionState = () => {
  selectedAnswers.value  = []
  numericAnswer.value    = ''
  questionAnswered.value = false
}

const retryQuestion = () => resetQuestionState()

const getAnswerClass = (index) => {
  const classes = ['answer-option']
  if (selectedAnswers.value.includes(index)) classes.push('selected')

  if (questionAnswered.value) {
    const answer = currentStep.value.answers[index]
    if (isQuestionCorrect.value && answer.isCorrect) {
      classes.push('correct')
    } else if (selectedAnswers.value.includes(index)) {
      classes.push(answer.isCorrect ? 'partial-correct' : 'wrong')
    }
  }
  return classes
}

const getErrorMessage = () => {
  if (!questionAnswered.value || isQuestionCorrect.value) return ''

  const answers         = currentStep.value.answers || []
  const correctIndices  = answers.reduce((acc, a, i) => a.isCorrect ? [...acc, i] : acc, [])
  const selectedCorrect = selectedAnswers.value.filter(i => correctIndices.includes(i))
  const selectedWrong   = selectedAnswers.value.filter(i => !correctIndices.includes(i))

  if (isNumericQuestion.value)                         return t('Not quite. Try again!')
  if (currentStep.value.answerMode === 'single')       return t('Incorrect answer. Try again!')
  if (selectedWrong.length && !selectedCorrect.length) return t('Wrong answer selected. Try again!')
  if (selectedWrong.length)                            return t('You selected some correct answers, but also wrong ones. Try again!')
  if (selectedCorrect.length < correctIndices.length)  return t('Not all correct answers selected. Try again!')
  return t('Try again!')
}

// ============================================================================
// NAVIGATION
// ============================================================================

const startTutorial = async (tutorialId) => {

  await loadCurrentTutorial (tutorialId)
  if (!currentTutorial.value) return
  // A tutorial that acts on the simulator restores, when it ends, the previous state
  if (tutorialHasActions(currentTutorial.value))
    takeSnapshot(simState, props.activeView, processorDraftFrom(simState.simulatedProcess))
  else
    clearSnapshot()

  tutorialOptions.progressHistory = []
  tutorialOptions.progressStepId = currentStep.value?.id || ''
  resetQuestionState()

  clickedButtons.value        = new Set()
  trackedButtonElements.value = []
  isActive.value              = true
  showTutorialMenu.value      = false

  nextTick(() => {
    shuffleAnswers()
    showCurrentStep()
  })
}

const goToStep = async (newIndex, { recordHistory = true } = {}) => {
  if (newIndex < 0 || newIndex >= currentTutorial.value.steps.length) return
  if (recordHistory && currentStep.value)
    tutorialOptions.progressHistory.push(currentStep.value.id)

  isActive.value = false
  stepIndex.value = newIndex
  tutorialOptions.progressStep =  newIndex  // fire options saving
  tutorialOptions.progressStepId = currentTutorial.value.steps[newIndex].id
  resetQuestionState()
  shuffleAnswers    ()
  isActive.value = true
  await nextTick()

  await showCurrentStep()
}

const nextStep = async (targetId) => {
  if (!currentStep.value) return
  if (currentStep.value.type === 'question' && !isQuestionCorrect.value) return
  if (!currentStep.value.next?.includes(targetId)) return
  if (targetId === 'end') {
    await completeTutorial()
    return
  }
  if (currentStep.value.type !== 'question' && currentStep.value.validation) {
    if (!await validateCurrentStep()) return
  }
  const targetIndex = currentTutorial.value.steps.findIndex(step => step.id === targetId)
  if (targetIndex === -1) return
  await goToStep(targetIndex)
}

const previousStep = async () => {
  while (tutorialOptions.progressHistory.length) {
    const previousId = tutorialOptions.progressHistory.pop()
    const previousIndex = currentTutorial.value.steps.findIndex(step => step.id === previousId)
    if (previousIndex !== -1) {
      await goToStep(previousIndex, { recordHistory: false })
      return
    }
  }
}

// ============================================================================
// PREVIEW from the tutorial editor: runs the draft from a given card without changing
// the progress of the tutorial in progress; when it ends, the editor is shown again.
// ============================================================================
const previewMode = ref(false)
let savedProgress = null

const startPreview = async () => {
  const request = simState.tutorialPreview
  if (!request) return
  let draft
  try {
    draft = migrateTutorialFlow(JSON.parse(localStorage.getItem('tutorialPreview')))
  } catch (e) {
    alert(t('Cannot preview this tutorial: {1}', { 1: e.message }))
    return
  }
  if (!draft.steps.length) return

  if (!previewMode.value) {
    savedProgress = {
      tutorial:  currentTutorial.value,
      stepIndex: stepIndex.value,
      options:   {
        progressStep:    tutorialOptions.progressStep,
        progressStepId:  tutorialOptions.progressStepId,
        progressHistory: [...(tutorialOptions.progressHistory || [])],
      },
    }
  }
  cleanup()
  if (!previewMode.value && tutorialHasActions(draft))
    previewSnapshot = { program: simState.simulatedProcess?.name, processor: simState.processorName,
                        N: document.querySelector('#program-iterations')?.value ?? '',
                        settings: { ...simState.simulationSettings }, view: props.activeView,
                        processorConfig: processorDraftFrom(simState.simulatedProcess) }
  draft.steps = processStepActions(draft.steps)
  draft.id    = '__preview__'
  currentTutorial.value = draft
  stepIndex.value = Math.max(0, draft.steps.findIndex(step => step.id === request.stepId))
  tutorialOptions.progressHistory = []
  previewMode.value = true

  emit('requestSwitchPanel', props.activeView)   // leave the full-screen editor
  resetQuestionState()
  clickedButtons.value        = new Set()
  trackedButtonElements.value = []
  showTutorialMenu.value      = false
  isActive.value              = true
  await nextTick()
  shuffleAnswers()
  showCurrentStep()
}

const endPreview = async () => {
  cleanup()
  isActive.value    = false
  previewMode.value = false
  if (previewSnapshot) { await restoreSnapshot(previewSnapshot); previewSnapshot = null }
  if (savedProgress) {
    currentTutorial.value = savedProgress.tutorial
    stepIndex.value       = savedProgress.stepIndex
    Object.assign(tutorialOptions, savedProgress.options)
    savedProgress = null
  }
  emit('requestSwitchFull', 'tutorial')   // back to the tutorial editor
}

watch(() => simState.tutorialPreview?.nonce, (nonce) => { if (nonce) startPreview() })

// Edit a tutorial of the menu in the tutorial editor
const editTutorial = (tutorialId) => {
  simState.tutorialToEdit = { id: tutorialId, nonce: Date.now() }
  showTutorialMenu.value  = false
  if (props.activeFull !== 'tutorial') emit('requestSwitchFull', 'tutorial')
}

const endTutorial = async (fullReset = false) => {
  if (previewMode.value) { endPreview(); return }
  cleanup()
  isActive.value = false
  if (fullReset) {
    // finished or stopped: the simulator returns to its state before the tutorial
    // (closing with × only pauses the tutorial, and keeps its state)
    if (savedSnapshot()) { await restoreSnapshot(); clearSnapshot() }
    currentTutorial.value  = null
    stepIndex.value        = 0
    highlightElement.value = null
    tutorialOptions.inProgressID = ""   // fire options saving
    tutorialOptions.progressStep =  0
    tutorialOptions.progressStepId = ""
    tutorialOptions.progressHistory = []
  }
}

const completeTutorial = async () => {
  if (currentStep.value.validation && !await validateCurrentStep()) return
  endTutorial(true)
}

const closeTutorial = () => endTutorial(false)
const stopTutorial  = () => endTutorial(true)

const resumeTutorial = () => {
  if (!currentTutorial.value) return
  isActive.value         = true
  showTutorialMenu.value = false
  nextTick(showCurrentStep)
}

const toggleTutorialMenu = () => {
  showTutorialMenu.value = !showTutorialMenu.value
}

// ============================================================================
// TUTORIAL: Init, loadCurrent & add
// ============================================================================

const initTutorial = async () => {
  const inProgressID = tutorialOptions.inProgressID  // Copy before modification by InitResource
  if (!Array.isArray(tutorialOptions.progressHistory))
    tutorialOptions.progressHistory = []
  await initResource('tutorial', tutorialOptions, 'inProgressID', 'available')

  // replace list of tutorial names by list of tutorial descriptions
  const tutorials = []
  for (const name of tutorialOptions.available) {
    try {
      const jsonString = localStorage.getItem(`tutorial.${name}`)
      const source = JSON.parse(jsonString)
      const wasLegacy = source.flowVersion == null || source.flowVersion === 1
      const tutorial = migrateTutorialFlow(source)
      if (wasLegacy && name === inProgressID) {
        const savedIndex = Math.max(0, Math.min(tutorialOptions.progressStep, tutorial.steps.length - 1))
        if (!tutorialOptions.progressHistory.length && savedIndex > 0)
          tutorialOptions.progressHistory = tutorial.steps.slice(0, savedIndex).map(step => step.id)
        tutorialOptions.progressStepId = tutorial.steps[savedIndex]?.id || ''
      }
      localStorage.setItem(`tutorial.${name}`, JSON.stringify(tutorial))
      tutorial.id      = name
      tutorials.push({
        id:          name,
        name:        tutorial.name,
        description: tutorial.description
      })
    } catch (e) {
      console.error(`👨‍🎓❌ Failed to load tutorial: ${name}`, e)
    }
  }
  tutorialOptions.available = tutorials   // fire options saving
  await loadCurrentTutorial (inProgressID)
}

const loadCurrentTutorial = async (ID) => {
  let tutorial = null
  if ( ID !== "")
    tutorial = tutorialOptions.available.find(t => t.id === ID)

  if ( ID === "" || !tutorial) { // no tutorial in progress
    tutorialOptions.inProgressID = ""
    tutorialOptions.progressStep =  0
    tutorialOptions.progressStepId = ""
    tutorialOptions.progressHistory = []
    currentTutorial.value         = null
    stepIndex.value               = 0
    console.log('👨‍🎓🚦No tutorial in progress')
    return
  }

  const jsonString      = localStorage.getItem(`tutorial.${ID}`)
  const sourceTutorial  = JSON.parse(jsonString)
  const wasLegacy       = sourceTutorial.flowVersion == null || sourceTutorial.flowVersion === 1
  const fullTutorial    = migrateTutorialFlow(sourceTutorial)
  if (wasLegacy) localStorage.setItem(`tutorial.${ID}`, JSON.stringify(fullTutorial))
  fullTutorial.steps    = processStepActions(fullTutorial.steps)
  fullTutorial.id       = ID
  currentTutorial.value = fullTutorial
  const isResuming      = tutorialOptions.inProgressID === ID
  if (!Array.isArray(tutorialOptions.progressHistory))
    tutorialOptions.progressHistory = []
  tutorialOptions.progressHistory = tutorialOptions.progressHistory
    .filter(stepId => fullTutorial.steps.some(step => step.id === stepId))
  const savedIndex      = isResuming && tutorialOptions.progressStepId
    ? fullTutorial.steps.findIndex(step => step.id === tutorialOptions.progressStepId)
    : -1
  stepIndex.value       = isResuming
    ? (savedIndex >= 0 ? savedIndex : Math.min(tutorialOptions.progressStep, fullTutorial.steps.length - 1))
    : 0
  if (!isResuming) tutorialOptions.progressHistory = []
  else if (wasLegacy && !tutorialOptions.progressHistory.length)
    tutorialOptions.progressHistory = fullTutorial.steps.slice(0, stepIndex.value).map(step => step.id)
  tutorialOptions.progressStepId = fullTutorial.steps[stepIndex.value]?.id || ''
  tutorialOptions.inProgressID = ID
  tutorialOptions.progressStep = stepIndex.value
  console.log(`👨‍🎓🔄 Tutorial in progress: ${ID} (Step ${stepIndex.value+1})`)
}

const addTutorial = async () => {
  try {
    const uploaded = await uploadJSON(null, 'tutorial');
    if (!uploaded) return
    const data = migrateTutorialFlow({
      ...uploaded,
      id: uploaded.id || uploaded.name
    })
    let included = false

    for (const tut of tutorialOptions.available) {
      if (tut.id === data.id)
        included = true
    }
    if (included) {
      alert(t('A tutorial with name: "{1}" has been already loaded.', { 1: data.id }))
      return
    }
    tutorialOptions.available.push({
      id:          data.id,
      name:        data.name,
      description: data.description
    })
    const key    = `tutorial.${data.id}`;
    const str    = JSON.stringify(data, null, 2);
    localStorage.setItem(key, str);
    console.log(`👨‍🎓✅ Added tutorial to local storage: ${data.id}`);
  } catch (error) {
    console.error('👨‍🎓❌ Failed to upload/save tutorial', error);
  }
}

function deleteTutorial (tutorialId) {
  removeFromLocalStorage('tutorial', tutorialId)

  const index = tutorialOptions.available.findIndex(
    tutorial => tutorial.id === tutorialId
  )
  if (index !== -1) {
    tutorialOptions.available.splice(index, 1);
  }
  tutorialOptions.inProgressID = ''
  tutorialOptions.progressStep = 0
  tutorialOptions.progressStepId = ''
  tutorialOptions.progressHistory = []
  if ( tutorialOptions.available.length == 0)
  {
    alert(t('Removing all tutorial configurations forces to load the original tutorials provided in the distribution'))
    initTutorial()
  }
  showTutorialMenu.value = true
}

// ============================================================================
// EVENT HANDLERS: click, windowChange;  WATCHES: tutorial, globalState
// ============================================================================

watch(() => simState.state, (newValue) => {
  if (newValue == 4) { // Tutorial Editor has set tutorial on localStorage
    console.log('👨‍🎓📥 Include tutorials in available list');
    initTutorial()
    simState.state = 5;   // acknowledge tutorials have been included in list
  }
});

watch(  // Watch for tutorial changes on specific properties
  () => ({
    available:    tutorialOptions.available,
    inProgressID: tutorialOptions.inProgressID,
    progressStep: tutorialOptions.progressStep,
    progressStepId: tutorialOptions.progressStepId,
    progressHistory: tutorialOptions.progressHistory,
    windowWidth:  tutorialOptions.windowWidth,
    windowHeight: tutorialOptions.windowHeight,
    x_pos:        tutorialOptions.x_pos,
    y_pos:        tutorialOptions.y_pos,
  }),
  () => {
    saveOptions()
  },
  { deep: true }
)

const handleClickOutside = (e) => {
  // Only run if the tutorial menu is currently shown
  if (!showTutorialMenu.value) return

  // Get references to the menu and its launch button
  const menu = document.querySelector('.tutorial-menu')
  const btn  = document.querySelector('.tutorial-launcher-btn')

  // Check if click was OUTSIDE both the menu AND the button
  if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
    // If clicked outside both, hide the menu
    showTutorialMenu.value = false
  }
}

// ============================================================================
// LIFECYCLE:  Mount/unMount
// ============================================================================

// The Run Simulation button is blocked while a prediction card waits for its prediction
watch(() => isActive.value && currentStep.value?.type === 'predict' && !taskState.value.result
             && !(validationMet.value && taskState.value.prediction !== undefined),
  (blocked) => { simState.simulationBlocked = blocked ? t('First save your prediction (tutorial card)') : '' },
  { immediate: true })

onMounted(async () => {
  loadOptions()
  document.addEventListener('click', handleClickOutside)
  observeContent()
  console.log('👨‍🎓🎯 TutorialEngine mounted')
})

onUnmounted(() => {
  console.log('👨‍🎓🧹 Tutorial Engine unmounted')
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', handleWindowResize)
  contentObserver?.disconnect()
  clearTimeout(replaceTimer)
  simState.simulationBlocked = ''
  cleanup ()
})
</script>

<style>

  /* description of a card (HTML): paragraphs <p> are separated by a small space */
  .step-description         { margin: 0.2em 0 1em; color: #666; line-height: 1.5; }
  .step-description pre     { margin: 0.3em 0 0.6em; padding: 6px 10px; background: #f6f8fa; border-radius: 4px; color: #333; font-size: 0.9em; line-height: 1.35; }
  .step-description p       { margin: 0 0 0.5em; }
  .step-description p:last-child { margin-bottom: 0; }
  .step-done-description    { margin-top: 0.6em; padding-top: 0.6em; border-top: 1px solid #e5e7eb; }
  #tutorial-predict .task-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4em 1em; }
  #tutorial-predict #tutorial-prediction { width: 6em; }
  #tutorial-predict { margin-bottom: 0.8em; }
  #tutorial-predict .task-status { margin-top: 0.5em; }
  #tutorial-predict .task-comment { margin-top: 0.4em; color: #555; }
  .task-status.task-ok  { color: #2e7d32; }
  .task-status.task-far { color: #c62828; }

  .tutorial-highlight-pulse {
    animation:        tutorial-pulse 5s infinite ease-in-out;
    transform-origin: center center;
  }

  @keyframes tutorial-pulse {
    0%   { box-shadow: 0 0 0 0    rgba(0, 122, 204, 0.7); }
    70%  { box-shadow: 0 0 0 10px rgba(0, 122, 204, 0);   }
    100% { box-shadow: 0 0 0 0    rgba(0, 122, 204, 0);   }
  }

  /* Highlight with an outline: unlike a border or a scale transform, it does not change the
     size or position of the element, so large panels are not cut or pushed over others */
  .tutorial-highlighted {
    position:       relative;
    z-index:        9998 !important;
    outline:        4px solid #007acc !important;
    outline-offset: 2px !important;
    border-radius:  6px !important;
    box-shadow:     0 0 20px rgba(0, 122, 204, 0.5) !important;
  }

  .tutorial-system {
    position: fixed;
    z-index: 9999;
  }

  .tutorial-overlay {
    top:    0;
    left:   0;
    width:  100vw;
    height: 100vh;
    z-index:  9999;
    position: fixed;
    background: transparent;
    pointer-events: none;
    transition:     opacity 0.3s ease-in-out;
  }

  .tutorial-tooltip {
    display:        flex;
    flex-direction: column;
    position:    fixed;
    overflow:    hidden;
    width:       fit-content;
    max-width:   calc(100vw - 32px);
    max-height:  calc(100vh - 56px);
    background:  white;
    box-shadow:  0 8px 24px rgba(0, 0, 0, 0.3);
    padding:     0;
    opacity:     0;

    z-index:    10001;
    pointer-events: auto;
    resize:     both;
    transition: opacity 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);

    border-radius: 10px;
    transform:     translateY(-10px) scale(0.95);
    animation:     tutorial-tooltip-appear 0.8s ease-out forwards;

    will-change:   transform, opacity;
    box-sizing:    border-box;
  }

  @keyframes tutorial-tooltip-appear {
    from {
      opacity: 0;
      transform: translateY(-10px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .tutorial-tooltip .tutorial-header {
    padding: 6px 20px 6px 20px;
    border-bottom: 1px solid #e9ecef;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .tutorial-tooltip .tutorial-content {
    padding: 10px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    word-wrap: break-word;
  }

  .tutorial-header {
    background:  white;
    font-weight:    600;
    border-radius:  8px 8px 0 0;
    cursor:         grab;
    user-select:    none;
  }

  .tutorial-header h3 {
    margin:    0 0 1px 0;
    color:     #333;
    font-size: large;
  }

  .tutorial-header:active {
    cursor: grabbing;
  }

  .tutorial-header span {
    flex: 1;
    text-align: center;
  }

  .tutorial-content h3 {
    margin:    0 0 1px 0;
    color:     #333;
    font-size: large;
  }

  .tutorial-content p {
    margin:      0 0 10px 0;
    color:       #666;
    line-height: 1.5;
    font-size:   medium;
  }

  .tutorial-content :deep(code) {
    background:    #f4f4f4;
    padding:       2px 4px;
    border-radius: 3px;
    font-family:   monospace;
    font-size:     small;
  }

  .tutorial-actions {
    gap:     10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tutorial-btn {
    padding:       4px 16px;
    border:        1px solid #ddd;
    border-radius: 4px;
    background:    white;
    cursor:        pointer;
    font-size:     medium;
    transition:    all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    transform:     translateY(0);
  }

  .tutorial-btn:hover:not(:disabled) {
    background: #f5f5f5;
    transform:  translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .tutorial-btn:disabled {
    opacity: 0.5;
    cursor:  not-allowed;
  }

  .tutorial-btn-primary {
    background:   #007acc;
    color:        white;
    border-color: #007acc;
  }

  .tutorial-btn-primary:hover:not(:disabled) {
    background: #005999;
    transform:  translateY(-1px);
    box-shadow: 0 2px 12px rgba(0, 122, 204, 0.3);
  }

  .tutorial-btn-disabled {
    background:   #cccccc !important;
    color:        #666666 !important;
    border-color: #cccccc !important;
    cursor:  not-allowed !important;
    opacity: 0.7;
  }

  .tutorial-btn-disabled:hover {
    background: #cccccc !important;
    transform:  none !important;
    box-shadow: none !important;
  }

  .tutorial-progress {
    font-size:   small;
    color:       #666;
    white-space: nowrap;
  }

  .tutorial-close {
    position:    absolute;
    top:         0px;
    right:       0px;
    background:  none;
    border:      none;
    font-size:   large;
    cursor:      pointer;
    color:       #999;
    line-height: 0.8;
  }

  .tutorial-close:hover {
    color: #333;
  }

  .tutorial-launcher {
    position: fixed;
    bottom:   20px;
    right:    20px;
    z-index:  10000;
  }

  .tutorial-launcher-btn {
    width:         50px;
    height:        50px;
    border-radius: 50%;
    background:    #007acc;
    color:         white;
    border:        none;
    cursor:        pointer;
    box-shadow:    0 4px 12px rgba(0, 122, 204, 0.4);
    transition:    all 0.3s;
    display:       flex;
    align-items:   center;
    justify-content: center;
  }

  .tutorial-launcher-btn:hover {
    background:  #005999;
    transform:   scale(1.1);
  }

  .tutorial-icon {
    font-size:   xx-large;
    font-weight: bolder;
  }

  .tutorial-menu {
    bottom:  20px;
    right:   20px;
    padding: 8px;
    width:      360px;
    max-height: 500px;
    position:   absolute;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    overflow-y: auto;
  }

  .tutorial-menu h4 {
    margin:    0 0 10px 0;
    color:     #333;
    font-size: medium;
  }

  .tutorial-list {
    display: flex;
    gap:     4px;
    flex-direction: column;
  }

  .tutorial-menu-item {
    background: none;
    border:     2px solid #ddd;
    padding:    5px;
    cursor:     pointer;
    text-align: left;
    transition: all 0.2s;
    border-radius: 6px;
  }

  .tutorial-menu-item:hover {
    background:  #f5f5f5;
    border-color: #007acc;
  }

  .tutorial-item-content strong {
    display:       block;
    color:         #333;
    margin-bottom: 2px;
    font-size:     medium;
  }

  .tutorial-item-content p {
    margin:     0;
    color:      #666;
    font-size:  small;
    line-height: 1.4;
  }

  .tutorial-item-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .tutorial-delete-btn.tutorial-edit-btn {
    background: #d6e4fb;
    color:      #1a4fb3;
    margin-right: 4px;
  }
  .tutorial-delete-btn.tutorial-edit-btn:hover {
    background: #b9d0f7;
  }

  .preview-badge,
  .tutorial-header .preview-badge,
  .question-header .preview-badge {
    flex:          0 0 auto;
    width:         auto;
    align-self:    center;
    margin-left:   auto;
    margin-right:  8px;
    padding:       1px 6px;
    border-radius: 4px;
    background:    #fff3c4;
    color:         #7a5a00;
    font-size:     11px;
    font-weight:   700;
    letter-spacing: 0.05em;
  }

  .tutorial-delete-btn {
    background: #eed1d1;
    color: white;
    border: none;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .tutorial-delete-btn:hover {
    background: #ff0000;
    transform: scale(1.1);
  }

  .tutorial-delete-btn:active {
    transform: scale(0.95);
  }

  .tutorial-menu-separator {
    height:     3px;
    background: #eee;
    margin:     4px 0;
  }

  .tutorial-paused-section {
    border-bottom:  2px solid #eee;
  }

  .tutorial-paused-header {
    text-align:    center;
    margin-bottom: 8px;
  }

  .tutorial-paused-header h5 {
    margin:      0 0 2px 0;
    color:       #333;
    font-size:   large;
    font-weight: 600;
  }

  .tutorial-paused-info {
    margin:     0;
    color:      #666;
    font-size:  medium;
    font-style: italic;
  }

  .tutorial-action-buttons {
    display:       flex;
    gap:           8px;
    margin-bottom: 4px;
  }

  .tutorial-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap:     8px;
    padding: 8px 12px;
    border:  none;
    border-radius: 8px;
    cursor:      pointer;
    transition: all 0.3s ease;
    text-align: left;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .tutorial-action-icon {
    font-size:   large;
    line-height: 1;
  }

  .tutorial-action-content {
    display:        flex;
    flex-direction: column;
    gap: 2px;
  }

  .tutorial-action-content strong {
    font-size:   medium;
    font-weight: bold;
    line-height: 1.2;
  }

  .tutorial-action-content span {
    font-size:   small;
    opacity:     0.8;
    line-height: 1.2;
  }

  .tutorial-resume-btn {
    background: linear-gradient(135deg, #28a745, #20893e);
    color: white;
  }

  .tutorial-resume-btn:hover {
    background: linear-gradient(135deg, #218838, #1e7e34);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(40, 167, 69, 0.3);
  }

  .tutorial-stop-btn {
    background: linear-gradient(135deg, #dc3545, #c82333);
    color: white;
  }

  .tutorial-stop-btn:hover {
    background: linear-gradient(135deg, #c82333, #bd2130);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(220, 53, 69, 0.3);
  }

.question-overlay {
  display:  flex;
  position: fixed;
  top:      0;
  left:     0;
  width:    100vw;
  height:   100vh;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10000;
  align-items:     flex-start;
  justify-content: center;
  animation:       fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.question-panel {
  background:     white;
  border-radius:  15px;
  width:          100%;
  max-width:      800px;
  max-height:     calc(100vh - 10px);
  display:        flex;
  flex-direction: column;
  box-shadow:     0 16px 48px rgba(0, 0, 0, 0.3);
  animation:      slideUp 0.4s ease-out;
  position:       relative;
  overflow:       hidden;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.question-close {
  position: absolute;
  top:      0px;
  right:    0px;
  background:  none;
  border:      none;
  font-size:   24px;
  cursor:      pointer;
  color:       #999;
  line-height: 1;
  z-index:     10;
  transition:  color 0.2s;
}

.question-close:hover {
  color: #333;
}

.question-header {
  padding:       4px 8px;
  border-bottom: 1px solid #f0f0f0;
  background:    linear-gradient(135deg, #8b5cf6, #7c3aed);
  color:         white;
  display:       flex;
  align-items:   center;
  gap:           12px;
  width:         100%;
}

.question-badge {
  display:       inline-block;
  background:    rgba(255, 255, 255, 0.2);
  padding:       3px 3px;
  border-radius: 16px;
  font-size:     small;
  font-weight:   bold;
  margin-bottom: 0px;
  background:    #007bff;
  color:         white;
  flex-shrink:   0;
}

.question-header h2 {
  margin:      0;
  margin-right: 30px;
  font-size:   medium;
  font-weight: 600;
  flex:        1;
  min-width:   0; /* Importante para que funcione text-overflow */
  overflow:    hidden;
  text-overflow: ellipsis;
  white-space:  nowrap;
}

.question-body {
  padding:    10px 10px;
  overflow-y: auto;
  flex:       1;
}

.question-text {
  font-size: medium;
  line-height: 1.6;
  color: #333;
  margin: 0 0 3px 0;
}

.question-text :deep(code) {
  background:    #f4f4f4;
  padding:       2px 6px;
  border-radius: 3px;
  font-family:   monospace;
}

.question-image {
  margin-bottom: 5px;
  text-align:    center;
  cursor:        pointer;
  position:      relative;
}

.step-image {
  margin:     5px 0;
  text-align: center;
  cursor:     pointer;
  position:   relative;
}

.question-image img,
.step-image img {
  max-width:     100%;
  max-height:    300px;
  border-radius: 8px;
  border:        1px solid #e5e7eb;
  box-shadow:    0 2px 8px rgba(0, 0, 0, 0.1);
  transition:    transform 0.2s, box-shadow 0.2s;
}

.question-image:hover img,
.step-image:hover img {
  transform:  scale(1.02);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}

.question-image .image-hint,
.step-image .image-hint {
  display:    block;
  font-size:  small;
  color:      #6b7280;
  margin-top: 2px;
  opacity:    0.7;
}

.question-image:hover .image-hint,
.step-image:hover .image-hint {
  opacity: 1;
}

.lightbox-overlay {
  position: fixed;
  top:      0;
  left:     0;
  right:    0;
  bottom:   0;
  background:      rgba(0, 0, 0, 0.85);
  display:         flex;
  align-items:     center;
  justify-content: center;
  z-index:         100000;
  animation:       fadeIn 0.2s ease-out;
}

.lightbox-content {
  position:   relative;
  max-width:  90vw;
  max-height: 90vh;
  display:     flex;
  align-items: center;
  justify-content: center;
}

.lightbox-content img {
  max-width:  90vw;
  max-height: 90vh;
  width:      auto;
  height:     auto;
  min-width:  400px;
  min-height: 400px;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  background: white;
}

.lightbox-close {
  position: absolute;
  top: -40px;
  right: 0;
  background: none;
  border: none;
  color: white;
  font-size: 32px;
  cursor: pointer;
  padding: 8px;
  line-height: 1;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.lightbox-close:hover {
  opacity: 1;
}

  .question-mode-info {
    background: #f5f3ff;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 8px;
  }

  .answers-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .answer-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 16px;
    border: 2px solid #e5e7eb;
    border-radius: 10px;
    background: white;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }

  .answer-option:hover:not(:disabled) {
    border-color: #8b5cf6;
    background: #faf5ff;
  }

  .answer-option.selected {
    border-color: #8b5cf6;
    background: #f5f3ff;
  }

  .answer-option.correct {
    border-color: #10b981;
    background: #ecfdf5;
  }

  .answer-option.partial-correct {
    border-color: #10b981;
    background: #ecfdf5;
  }

  .answer-option.wrong {
    border-color: #ef4444;
    background: #fef2f2;
  }

  .answer-option:disabled {
    cursor: default;
  }

  .answer-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .answer-letter {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: #e5e7eb;
    color: #374151;
    font-weight: 600;
    font-size: 13px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .answer-option.selected .answer-letter {
    background: #8b5cf6;
    color: white;
  }

  .answer-option.correct .answer-letter,
  .answer-option.partial-correct .answer-letter {
    background: #10b981;
    color: white;
  }

  .answer-option.wrong .answer-letter {
    background: #ef4444;
    color: white;
  }

  .answer-text {
    flex: 1;
    font-size: 14px;
    color: #374151;
    line-height: 1.4;
  }

  .answer-text :deep(code) {
    background: #f4f4f4;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
  }

  .answer-indicator {
    font-size: 16px;
    font-weight: bold;
  }

  .answer-indicator.correct {
    color: #10b981;
  }

  .answer-indicator.partial-correct {
    color: #10b981;
  }

  .answer-indicator.wrong {
    color: #ef4444;
  }

  .answer-feedback {
    margin-top: 6px;
    margin-left: 40px;
    padding: 0px 12px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.4;
    animation: fadeIn 0.3s ease-out;
  }

  .answer-feedback :deep(code) {
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
  }

  .answer-feedback.feedback-correct {
    background: #ecfdf5;
    color: #065f46;
    border-left: 3px solid #10b981;
  }

  .answer-feedback.feedback-wrong {
    background: #fef2f2;
    color: #991b1b;
    border-left: 3px solid #ef4444;
  }

  .feedback-section {
    margin-top: 4px;
    animation: fadeIn 0.3s ease-out;
  }

  .feedback-box {
    padding: 2px 16px;
    border-radius: 8px;
  }

  .feedback-box h4 {
    margin: 0 0 0px 0;
    font-size: 14px;
    font-weight: 600;
  }

  .feedback-correct {
    background: #ecfdf5;
    border: 1px solid #10b981;
  }

  .feedback-correct h4 {
    color: #059669;
  }

  .feedback-wrong {
    background: #fef2f2;
    border: 1px solid #ef4444;
  }

  .feedback-wrong h4 {
    color: #dc2626;
  }

  .question-actions {
    padding: 6px 20px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    background: #f9fafb;
  }

  .tutorial-btn-retry {
    background: #f59e0b;
    color: white;
    border-color: #f59e0b;
  }

  .tutorial-btn-retry:hover:not(:disabled) {
    background: #d97706;
    transform: translateY(-1px);
    box-shadow: 0 2px 12px rgba(245, 158, 11, 0.3);
  }

  @keyframes tutorial-message-appear {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.8);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }


  /* Actions of the cards on the simulator, and numeric answers */
  .tutorial-running {
    margin: 0.4em 0; padding: 0.3em 0.6em; border-radius: 4px;
    background: #fff7e0; color: #7a5a00; font-size: 0.9em;
  }
  .tutorial-btn-showme {
    background: #e8f5e9; border-color: #66bb6a; color: #1b5e20; font-weight: 600;
  }
  .tutorial-btn-showme:disabled { opacity: 0.6; cursor: wait; }
  .numeric-answer { margin: 0.8em 0; }
  .numeric-answer input {
    width: 9em; padding: 0.4em 0.6em; font-size: 1.1em;
    border: 1px solid #b0b8c4; border-radius: 6px;
  }
  .numeric-unit { margin-left: 0.5em; color: #555; }
  .numeric-answer .answer-feedback { margin-top: 0.6em; }

</style>
