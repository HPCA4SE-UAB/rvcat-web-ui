<template>
  <div class="tutorial-system">
    
    <!-- Tutorial Overlay for Steps -->
    <div v-if="currentTutorial && isActive && !isQuestionStep" class="tutorial-overlay">
      <!-- Tooltip -->
      <div class="tutorial-tooltip" :style="tooltipStyle">
        <div class="tutorial-content">
          <h3 v-html="currentStep?.title"></h3>
          <p class="step-description" v-html="currentStep?.description"></p>
          <div v-if="currentStep?.stepImage" class="step-image" @click="openLightbox(currentStep.stepImage)">
            <img :src="currentStep.stepImage" alt="Step image">
            <span class="image-hint">Click to enlarge</span>
          </div>
          <div class="tutorial-actions">
            <button @click="previousStep" :disabled="stepIndex === 0" class="tutorial-btn">
              Previous
            </button>
            <span class="tutorial-progress">
              {{ stepIndex + 1 }} / {{ currentTutorial.steps.length }}
            </span>
            <button v-if="stepIndex < currentTutorial.steps.length - 1" 
                    @click="nextStep" 
                    :disabled="!canProceed"
                    :class="['tutorial-btn', canProceed ? 'tutorial-btn-primary' : 'tutorial-btn-disabled']">
              Next
            </button>
            <button v-else 
                    @click="completeTutorial" 
                    :disabled="!canProceed"
                    :class="['tutorial-btn', canProceed ? 'tutorial-btn-primary' : 'tutorial-btn-disabled']">
              Finish
            </button>
          </div>
        </div>
        <button @click="closeTutorial" class="tutorial-close">&times;</button>
      </div>
    </div>

    <!-- Question Overlay (centered like tutorial editor) -->
    <div v-if="currentTutorial && isActive && isQuestionStep" class="question-overlay">
      <div class="question-panel">
        <button @click="closeTutorial" class="question-close">&times;</button>
        
        <div class="question-header">
          <span class="question-badge">Question {{ stepIndex + 1 }} / {{ currentTutorial.steps.length }}</span>
          <h2 v-html="currentStep?.title"></h2>
        </div>
        
        <div class="question-body">
          <p class="question-text" v-html="currentStep?.questionText"></p>
          
          <div v-if="currentStep?.questionImage" class="question-image" @click="openLightbox(currentStep.questionImage)">
            <img :src="currentStep.questionImage" alt="Question image">
            <span class="image-hint">Click to enlarge</span>
          </div>
          
          <div class="question-mode-info">
            <span v-if="currentStep?.answerMode === 'single'">Select ONE correct answer</span>
            <span v-else>Select ALL correct answers</span>
          </div>
          
          <div class="answers-list">
            <div v-for="(answer, index) in shuffledAnswers" :key="answer.originalIndex" class="answer-wrapper">
              <button 
                @click="selectAnswer(answer.originalIndex)"
                :class="getAnswerClass(answer.originalIndex)"
                :disabled="questionAnswered && isQuestionCorrect"
              >
                <span class="answer-letter">{{ String.fromCharCode(65 + index) }}</span>
                <span class="answer-text" v-html="answer.text"></span>
                <span v-if="questionAnswered && isQuestionCorrect && answer.isCorrect" class="answer-indicator correct">✓</span>
                <span v-if="questionAnswered && !isQuestionCorrect && selectedAnswers.includes(answer.originalIndex) && !answer.isCorrect" class="answer-indicator wrong">✗</span>
                <span v-if="questionAnswered && !isQuestionCorrect && selectedAnswers.includes(answer.originalIndex) && answer.isCorrect" class="answer-indicator partial-correct">✓</span>
              </button>
              <!-- Inline feedback below each answer -->
              <div v-if="questionAnswered && selectedAnswers.includes(answer.originalIndex) && answer.explanation" 
                   :class="['answer-feedback', answer.isCorrect ? 'feedback-correct' : 'feedback-wrong']"
                   v-html="answer.explanation">
              </div>
            </div>
          </div>
          
          <!-- Summary message section -->
          <div v-if="questionAnswered" class="feedback-section">
            <div v-if="isQuestionCorrect" class="feedback-box feedback-correct">
              <h4>✓ Correct!</h4>
            </div>
            <div v-else class="feedback-box feedback-wrong">
              <h4>✗ {{ getErrorMessage() }}</h4>
            </div>
          </div>
        </div>
        
        <div class="question-actions">
          <button @click="previousStep" :disabled="stepIndex === 0" class="tutorial-btn">
            Previous
          </button>
          
          <button v-if="!questionAnswered" 
                  @click="submitAnswer" 
                  :disabled="selectedAnswers.length === 0"
                  class="tutorial-btn tutorial-btn-primary">
            Submit Answer
          </button>
          
          <button v-else-if="!isQuestionCorrect"
                  @click="retryQuestion"
                  class="tutorial-btn tutorial-btn-retry">
            Try Again
          </button>
          
          <button v-else-if="stepIndex < currentTutorial.steps.length - 1" 
                  @click="nextStep" 
                  class="tutorial-btn tutorial-btn-primary">
            Next
          </button>
          <button v-else 
                  @click="completeTutorial" 
                  class="tutorial-btn tutorial-btn-primary">
            Finish
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
      <button @click="toggleTutorialMenu" title="Open Tutorial" class="tutorial-launcher-btn">
        <span class="tutorial-icon">?</span>
      </button>
      
      <!-- Tutorial Menu -->
      <div v-if="showTutorialMenu" class="tutorial-menu">
        <h4>Available Tutorials</h4>
        
        <!-- Show resume option if there's a paused tutorial -->
        <div v-if="currentTutorial" class="tutorial-paused-section">
          <div class="tutorial-paused-header">
            <h5>📚 Tutorial in Progress</h5>
            <p class="tutorial-paused-info" v-html="currentTutorial.name"></p>
          </div>
          
          <div class="tutorial-action-buttons">
            <button @click="resumeTutorial" class="tutorial-action-btn tutorial-resume-btn">
              <div class="tutorial-action-icon">▶️</div>
              <div class="tutorial-action-content">
                <strong>Resume</strong>
                <span>Step {{ stepIndex + 1 }} of {{ currentTutorial.steps.length }}</span>
              </div>
            </button>
            
            <button @click="stopTutorial" class="tutorial-action-btn tutorial-stop-btn">
              <div class="tutorial-action-icon">⏹️</div>
              <div class="tutorial-action-content">
                <strong>Stop</strong>
                <span>Start fresh</span>
              </div>
            </button>
          </div>
          
          <div class="tutorial-menu-separator"></div>
        </div>
        
        <div v-if="isLoading" class="tutorial-loading">
          Loading tutorials...
        </div>
        <div v-else class="tutorial-list">
          <button 
            v-for="tutorial in tutorialOptions.availableTutorials" 
            :key="tutorial"
            @click="startTutorial(tutorial)"
            class="tutorial-menu-item"
          >
            <div class="tutorial-item-content">
              <strong v-html="tutorial"></strong>
              <!--- <p v-html="tutorial.description"></p>              --->
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
  
import { ref, computed, inject, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'

const simState = inject('simulationState');

/* ------------------------------------------------------------------ 
 * Tutorial State (persistent in localStorage)
 * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'tutorialOptions'
  const TUTORIAL_PROGRESS_KEY = 'tutorialProgress'

  const defaultOptions = {
    availableTutorials:  [],
    currentTutorialName: '',
    progressStep:         0
  }
  
// ============================================================================
// PROPS & EMITS
// ============================================================================
const props = defineProps({ activeView: String })
const emit  = defineEmits(['requestSwitch'])

// ============================================================================
// CONSTANTS
// ============================================================================
const TOOLTIP_WIDTH  = 400
const TOOLTIP_HEIGHT = 200

// ============================================================================
// STATE
// ============================================================================

// Core tutorial state 
const currentTutorial = ref(null)
const stepIndex       = ref(0)
  
const isActive  = ref(false)
const isLoading = ref(false)

// refer to this variable to force evaluation of validation state
const validationState  = ref({})
  
const showTutorialMenu = ref(false)
const showEditor       = ref(false)
const highlightElement = ref(null)

// Scroll position
const originalScrollPosition = ref({ x: 0, y: 0 })
const tooltipPositionTrigger = ref(0)

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
// LOCAL STORAGE
// ============================================================================

const savedOptions = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : defaultOptions
  } catch {
    return defaultOptions
  }
})()

const tutorialOptions  = reactive({ ...defaultOptions, ...savedOptions })
  
const saveOptions = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tutorialOptions))
  } catch (error) {
    console.error('❌ Failed to save:', error)
  }
}
  
const saveTutorialProgress = () => {
  if (!currentTutorial.value) return
  try {
    localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({
      tutorialId:   currentTutorial.value.id,
      tutorialName: currentTutorial.value.name,
      stepIndex:    stepIndex.value,
      totalSteps:   currentTutorial.value.steps.length,
      timestamp:    new Date().toISOString()
    }))
  } catch (e) {
    console.error('❌ Error saving progress:', e)
  }
}

const loadTutorialProgress = () => {
  try {
    const data = localStorage.getItem(TUTORIAL_PROGRESS_KEY)
    return data ? JSON.parse(data) : null
  } catch (e) {
    console.error('❌ Error loading progress:', e)
    return null
  }
}

const clearTutorialProgress = () => {
  try {
    localStorage.removeItem(TUTORIAL_PROGRESS_KEY)
  } catch (e) {
    console.error('❌ Error clearing progress:', e)
  }
}

  
// ============================================================================
// COMPUTED PROPERTIES
// ============================================================================
const currentStep = computed(() => 
   currentTutorial.value?.steps?.[stepIndex.value] ?? null
)

const isQuestionStep = computed(() => 
  currentStep.value?.type === 'question'
)

const isQuestionCorrect = computed(() => {
  if (!currentStep.value || currentStep.value.type !== 'question') return false
  
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

const canProceed = computed(() => {
  const validation = currentStep.value?.validation
  if (!validation) return true
  
  // Force reactivity
  validationState.value
  
  try {
    const { type, selector, value, minValue } = validation
    switch (type) {
      case 'program_selected':
        return simState.selectedProgram === value
      case 'architecture_selected':
        return simState.selectedProcessor === value
      case 'input_value':
        return document.querySelector(selector)?.value === value
      case 'input_value_min':
        return parseInt(document.querySelector(selector)?.value) >= minValue
      case 'button_clicked':
        return selector && clickedButtons.value.has(selector.trim())
      default:
        return true
    }
  } catch (e) {
    console.warn('Validation check error:', e)
    return true
  }
})

const tooltipStyle = computed(() => {
  
  tooltipPositionTrigger.value // Force reactivity
  
  if (!highlightElement.value || !currentStep.value) return { display: 'none' }
  
  const rect = highlightElement.value.getBoundingClientRect()
  const pos  = currentStep.value.position || 'bottom'
  const margin = 25
  
  let top, left
  const centerX = rect.left + rect.width / 2  - TOOLTIP_WIDTH / 2
  const centerY = rect.top  + rect.height / 2 - TOOLTIP_HEIGHT / 2
  
  switch (pos) {
    case 'top':    top = rect.top - TOOLTIP_HEIGHT - 15; left = centerX;                        break
    case 'bottom': top = rect.bottom + 15;               left = centerX;                        break
    case 'left':   top = centerY;                        left = rect.left - TOOLTIP_WIDTH - 15; break
    case 'right':  top = centerY;                        left = rect.right + 15;                break
    default:       top = rect.bottom + 15;               left = centerX
  }
  
  // Clamp to viewport
  left = Math.max(margin, Math.min(left, window.innerWidth -  TOOLTIP_WIDTH - margin))
  top  = Math.max(margin, Math.min(top,  window.innerHeight - TOOLTIP_HEIGHT - margin))
  
  return { top: `${top}px`, left: `${left}px` }
})

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
  
const isElementVisible = (el) => {
  const rect = el.getBoundingClientRect()
  return rect.top < window.innerHeight && rect.bottom > 0 && 
         rect.left < window.innerWidth && rect.right > 0
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const clearHighlights = () => {
  document.querySelectorAll('.tutorial-highlighted').forEach(el => {
    el.classList.remove('tutorial-highlighted', 'tutorial-highlight-pulse')
  })
}

const resetQuestionState = () => {
  selectedAnswers.value  = []
  questionAnswered.value = false
}

const processStepActions = (steps) => steps.map(step => {
  if (step.action && typeof step.action === 'string') {
    const [actionType, param] = step.action.split(':')
    if (actionType === 'switchTo') {
      step.action = () => emit('requestSwitch', param)
    }
  }
  return step
})

// ============================================================================
// SCROLL MANAGEMENT
// ============================================================================
const saveScrollPosition = () => {
  originalScrollPosition.value = {
    x: window.pageXOffset || document.documentElement.scrollLeft,
    y: window.pageYOffset || document.documentElement.scrollTop
  }
}

const restoreScrollPosition = () => {
  window.scrollTo({ ...originalScrollPosition.value, behavior: 'smooth' })
}

// ============================================================================
// LIGHTBOX
// ============================================================================
const openLightbox = (src) => { lightboxImage.value = src;  showLightbox.value  = true }
const closeLightbox = () =>   { showLightbox.value = false; lightboxImage.value = '' }

// ============================================================================
// ANSWER SHUFFLING (Fisher-Yates)
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

// ============================================================================
// TUTORIAL LOADING
// ============================================================================
  
const loadTutorials = async () => {
  console.log('🔄 Loading tutorials...')
  isLoading.value = true
  try {
    if (tutorialOptions.availableTutorials.length == 0) {
      let tutorialKeys = getKeys('tutorial') // from localStorage
      if (tutorialKeys.length == 0) { // load tutorials from distribution files
        const response = await fetch('./index.json')
        const data     = await response.json()
        for (let i = 0; i < data.tutorials.length; i += 1) {
          const filedata = await loadJSONfile(`./tutorials/${data.tutorials[i]}.json`)
          localStorage.setItem(`tutorial.${data.tutorials[i]}`, JSON.stringify(filedata))
        }
        tutorialKeys = getKeys('tutorial')
      }
      tutorialOptions.availableTutorials = tutorialKeys
      tutorialOptions.currentTutorial = tutorialKeys[0]   // fires reaction to reloadTutorial
      console.log(`✅ Loaded ${tutorialKeys.length} tutorials`)
    }
    else {
      console.log('✅ Tutorials already stored on localStorage')
      reloadTutorial()
    }
  } catch (e) {
    console.error('❌ Tutorial loading failed:', e)
    tutorialOptions.availableTutorials = [{
      id: 'fallback',
      name: '⚠️ Fallback Tutorial',
      description: 'Error loading tutorials',
      steps: [{ title: 'Error', description: 'Tutorials could not load.', selector: '.header-title', position: 'bottom' }]
    }]
  } finally {
    isLoading.value = false
  }
}
  
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
    program_selected: () =>      getElement('#programs-list')?.value === v.value,
    architecture_selected: () => getElement('#processors-list')?.value === v.value,
    input_value: () =>           getElement(v.selector)?.value === v.value,
    input_value_min: () =>       parseInt(getElement(v.selector)?.value) >= v.minValue,
    button_clicked: () =>        v.selector && clickedButtons.value.has(v.selector.trim())
  }
  
  const isValid = validators[v.type]?.() ?? true
  if (!isValid) showValidationMessage(v.message || 'Please complete this action')
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

const cleanupValidationListeners = () => {
  validationEventListeners.value.forEach(({ element, eventType, handler }) => {
    element.removeEventListener(eventType, handler)
  })
  validationEventListeners.value = []
}

// ============================================================================
// BUTTON CLICK TRACKING
// ============================================================================
const setupButtonClickTracking = () => {
  cleanupButtonClickTracking()
  
  const v = currentStep.value?.validation
  if (v?.type !== 'button_clicked' || !v.selector) return
  
  const selector = v.selector.trim()
  
  const attach = () => {
    const btn = document.querySelector(selector)
    if (!btn) return false
    
    const handler = () => {
      console.log(`✅ Button clicked: ${selector}`)
      clickedButtons.value.add(selector)
      validationState.value = { t: Date.now() }
    }
    btn.addEventListener('click', handler)
    trackedButtonElements.value.push({ element: btn, handler })
    return true
  }
  
  if (!attach()) setTimeout(attach, 500)
}

const cleanupButtonClickTracking = () => {
  trackedButtonElements.value.forEach(({ element, handler }) => {
    try { element.removeEventListener('click', handler) } catch {}
  })
  trackedButtonElements.value = []
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================
const cleanup = (options = {}) => {
  clearHighlights()
  cleanupValidationListeners()
  cleanupButtonClickTracking()
  
  if (options.resetClicks)   clickedButtons.value = new Set()
  if (options.clearProgress) clearTutorialProgress()
  if (options.saveProgress)  saveTutorialProgress()
  
  resetQuestionState()
  restoreScrollPosition()
}

// ============================================================================
// HIGHLIGHTING
// ============================================================================
const highlightCurrentStep = async () => {
  if (currentStep.value?.type === 'question') {
    clearHighlights()
    highlightElement.value = null
    return
  }
  
  if (!currentStep.value?.selector) return
  
  // Execute step action
  if (currentStep.value.action) {
    try {
      await currentStep.value.action()
      await nextTick()
      await delay(300)
    } catch (e) {
      console.error('Step action error:', e)
    }
  }
  
  clearHighlights()
  
  // Find element
  let element
  const sel = currentStep.value.selector
  
  if (sel.includes(':contains(')) {
    const match = sel.match(/^([^:]+):contains\("([^"]+)"\)$/)
    if (match) {
      element = Array.from(document.querySelectorAll(match[1]))
        .find(el => el.textContent.includes(match[2]))
    }
  } else {
    element = document.querySelector(sel)
  }
  
  if (element) {
    highlightElement.value = element
    element.classList.add('tutorial-highlighted', 'tutorial-highlight-pulse')
    if (!isElementVisible(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
  
  await nextTick()
  setupValidationListeners()
  setupButtonClickTracking()
}

// ============================================================================
// QUESTION HANDLING
// ============================================================================
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
  if (selectedAnswers.value.length) questionAnswered.value = true
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
  
  const answers = currentStep.value.answers || []
  const correctIndices  = answers.reduce((acc, a, i) => a.isCorrect ? [...acc, i] : acc, [])
  const selectedCorrect = selectedAnswers.value.filter(i => correctIndices.includes(i))
  const selectedWrong   = selectedAnswers.value.filter(i => !correctIndices.includes(i))
  
  if (currentStep.value.answerMode === 'single')       return 'Incorrect answer. Try again!'
  if (selectedWrong.length && !selectedCorrect.length) return 'Wrong answer selected. Try again!'
  if (selectedWrong.length)                            return 'You selected some correct answers, but also wrong ones. Try again!'
  if (selectedCorrect.length < correctIndices.length)  return 'Not all correct answers selected. Try again!'
  return 'Try again!'
}

// ============================================================================
// NAVIGATION
// ============================================================================

/*  Process Steps when loading 
   res = JSON string
   const tutorial = await res.json()
   tutorial.steps = processStepActions(tutorial.steps)
   **********************************************/
  
const startTutorial = (tutorialId) => {
  const tutorial = tutorialOptions.availableTutorials.find(t => t.id === tutorialId)
  if (!tutorial) return
  
  saveScrollPosition()
  currentTutorial.value = tutorial
  
  const saved = loadTutorialProgress()
  stepIndex.value = (saved?.tutorialId === tutorialId) ? saved.stepIndex : 0
  
  resetQuestionState()
  clickedButtons.value = new Set()
  trackedButtonElements.value = []
  
  isActive.value = true
  showTutorialMenu.value = false
  
  nextTick(() => {
    shuffleAnswers()
    saveTutorialProgress()
    highlightCurrentStep()
  })
}

const goToStep = async (newIndex) => {
  stepIndex.value = newIndex
  resetQuestionState()
  shuffleAnswers()
  saveTutorialProgress()
  await nextTick()
  await highlightCurrentStep()
}

const nextStep = async () => {
  if (stepIndex.value >= currentTutorial.value.steps.length - 1) return
  if (currentStep.value.type !== 'question' && currentStep.value.validation) {
    if (!await validateCurrentStep()) return
  }
  await goToStep(stepIndex.value + 1)
}

const previousStep = async () => {
  if (stepIndex.value <= 0) return
  await goToStep(stepIndex.value - 1)
}

const endTutorial = (fullReset = false) => {
  cleanup({ resetClicks: fullReset, clearProgress: fullReset, saveProgress: !fullReset })
  isActive.value = false
  if (fullReset) {
    currentTutorial.value  = null
    stepIndex.value        = 0
    highlightElement.value = null
  }
}

const completeTutorial = async () => {
  if (currentStep.value.validation && !await validateCurrentStep()) return
  endTutorial(true)
}

const closeTutorial = () => endTutorial(false)
const stopTutorial = () => endTutorial(true)

const resumeTutorial = () => {
  if (!currentTutorial.value) return
  saveScrollPosition()
  isActive.value = true
  showTutorialMenu.value = false
  nextTick(highlightCurrentStep)
}

const toggleTutorialMenu = () => {
  showTutorialMenu.value = !showTutorialMenu.value
}

// ============================================================================
// CUSTOM TUTORIALS
// ============================================================================
const previewCustomTutorial = (data) => {
  showEditor.value       = false
  showTutorialMenu.value = false
  
  data.steps = processStepActions(data.steps)
  currentTutorial.value = data
  stepIndex.value = 0
  isActive.value  = true
  
  nextTick(highlightCurrentStep)
}

const addFinishedTutorial = (data) => {
  data.steps = processStepActions(data.steps)
  tutorialOptions.availableTutorials.push(data)
  console.log(`✅ Added tutorial: ${data.name}`)
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================
const handleClickOutside = (e) => {
  if (!showTutorialMenu.value) return
  
  const menu = document.querySelector('.tutorial-menu')
  const btn  = document.querySelector('.tutorial-launcher-btn')
  
  if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
    showTutorialMenu.value = false
  }
}

const handleWindowChange = () => {
  if (isActive.value && highlightElement.value) tooltipPositionTrigger.value++
}

const restoreTutorialProgress = async () => {
  const saved = loadTutorialProgress()
  if (!saved || !tutorialOptions.availableTutorials.length) return false
  
  const tutorial = tutorialOptions.availableTutorials.find(t => t.id === saved.tutorialId)
  if (tutorial) {
    console.log(`🔄 Restored progress: ${saved.tutorialName} (Step ${saved.stepIndex + 1})`)
    currentTutorial.value = tutorial
    stepIndex.value       = saved.stepIndex
    return true
  }
  
  clearTutorialProgress()
  return false
}

// ============================================================================
// LIFECYCLE
// ============================================================================
onMounted(async () => {
  console.log('🎯 TutorialComponent mounted')
  document.addEventListener('click', handleClickOutside)
  window.addEventListener  ('resize', handleWindowChange)
  window.addEventListener  ('scroll', handleWindowChange, true)
  
  await loadTutorials()
  await restoreTutorialProgress()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener ('resize', handleWindowChange)
  window.removeEventListener ('scroll', handleWindowChange, true)
  cleanupValidationListeners ()
  cleanupButtonClickTracking ()
})
</script>

<style scoped>
  
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
  position:    absolute;
  background:  white;
  box-shadow:  0 8px 24px rgba(0, 0, 0, 0.3);
  padding:     0;
  opacity:     0;
  width:       300px;
  max-width:   calc(100vw - 40px);
  z-index:     10001;
  pointer-events: all;
  transition:    all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  border-radius: 12px;
  transform:     translateY(-10px) scale(0.95);
  animation:     tutorial-tooltip-appear 0.4s ease-out forwards;
}

.tutorial-content {
  padding: 10px;
}

.tutorial-content h3 {
  margin:    0 0 10px 0;
  color:     #333;
  font-size: large;
}

.tutorial-content p {
  margin:      0 0 20px 0;
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
  padding:       8px 16px;
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
  top:         10px;
  right:       15px;
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
  padding: 12px;
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
  gap:     8px;
  flex-direction: column;
}

.tutorial-menu-item {
  background: none;
  border:     1px solid #ddd;
  padding:    10px;
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
  margin-bottom: 5px;
  font-size:     medium;
}

.tutorial-item-content p {
  margin:     0;
  color:      #666;
  font-size:  small;
  line-height: 1.4;
}

.tutorial-loading {
  padding:    10px;
  text-align: center;
  color:      #666;
  font-style: italic;
}

.tutorial-menu-separator {
  height:     1px;
  background: #eee;
  margin:     5px 0;
}

.tutorial-paused-section {
  border-bottom:  2px solid #eee;
  margin-bottom:  8px;
  padding-bottom: 8px;
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
  font-size:  small;
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
  font-weight: blod;
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

/* Question Overlay Styles */
.question-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.question-panel {
  background: white;
  border-radius: 14px;
  width: 100%;
  max-width: 550px;
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.4s ease-out;
  position: relative;
  overflow: hidden;
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
  top: 12px;
  right: 16px;
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
  line-height: 1;
  z-index: 10;
  transition: color 0.2s;
}

.question-close:hover {
  color: #333;
}

.question-header {
  padding: 18px 24px 14px;
  border-bottom: 1px solid #f0f0f0;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
}

.question-badge {
  display: inline-block;
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 10px;
}

.question-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.question-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.question-text {
  font-size: 15px;
  line-height: 1.6;
  color: #333;
  margin: 0 0 16px 0;
}

.question-text :deep(code) {
  background: #f4f4f4;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: monospace;
}

.question-image {
  margin-bottom: 16px;
  text-align: center;
  cursor: pointer;
  position: relative;
}

.question-image img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}

.question-image:hover img {
  transform: scale(1.02);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.question-image .image-hint,
.step-image .image-hint {
  display: block;
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  opacity: 0.7;
}

.question-image:hover .image-hint,
.step-image:hover .image-hint {
  opacity: 1;
}

/* Step image in tooltip */
.step-image {
  margin: 12px 0;
  text-align: center;
  cursor: pointer;
  position: relative;
}

.step-image img {
  max-width: 100%;
  max-height: 150px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}

.step-image:hover img {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Lightbox popup */
.lightbox-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100000;
  animation: fadeIn 0.2s ease-out;
}

.lightbox-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-content img {
  max-width: 90vw;
  max-height: 90vh;
  width: auto;
  height: auto;
  min-width: 200px;
  min-height: 200px;
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
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 16px;
}

.answers-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.answer-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
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
  padding: 8px 12px;
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
  margin-top: 16px;
  animation: fadeIn 0.3s ease-out;
}

.feedback-box {
  padding: 12px 16px;
  border-radius: 8px;
}

.feedback-box h4 {
  margin: 0 0 8px 0;
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
  padding: 14px 20px;
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

  .tutorial-highlight-pulse {
    animation:        tutorial-pulse 2s infinite ease-in-out;
    transform-origin: center center;
  }

  @keyframes tutorial-pulse {
    0%   { box-shadow: 0 0 0 0    rgba(0, 122, 204, 0.7); }
    70%  { box-shadow: 0 0 0 10px rgba(0, 122, 204, 0);   }
    100% { box-shadow: 0 0 0 0    rgba(0, 122, 204, 0);   }
  }

  .tutorial-highlighted {
    position:      relative;
    z-index:       10001 !important;
    border:        3px solid #007acc !important;
    border-radius: 6px !important;
    box-shadow:    0 0 20px rgba(0, 122, 204, 0.5) !important;
    transition:    all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
    transform:     scale(1.02) !important;
    will-change:   transform !important;
    transform-origin: center center !important;
  }

  /* Adjust highlight for different zoom levels */
  @media (max-width: 1200px) {
    .tutorial-highlighted {
      border-width:  2px !important;
      box-shadow:    0 0 15px rgba(0, 122, 204, 0.5) !important;
    }
  }

  @media (max-width: 768px) {
    .tutorial-highlighted {
      border-width:  2px !important;
      box-shadow:    0 0 10px rgba(0, 122, 204, 0.5) !important;
      transform:     scale(1.01) !important;
    }
  }

  /* Specific styles for different element types in tutorials */
  .tutorial-highlighted.header-title {
    color:      #333 !important;
    transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
    transform-origin: center center !important;
  }

  .tutorial-highlighted button {
    color:      #333 !important;
    transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
    transform:  scale(1.05) !important;
    transform-origin: center center !important;
  }

  .tutorial-highlighted select {
    background: white !important;
    color:      #333 !important;
    transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
    transform:  scale(1.03) !important;
    transform-origin: center center !important;
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
    
</style>
