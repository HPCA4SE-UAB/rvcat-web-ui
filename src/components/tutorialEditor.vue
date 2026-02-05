<template>
 <div class="main">   
    <div class="header fullscreen-header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Tutorial - <strong>{{ tutorialOptions.inEditionID }}</strong></span>
      </div>
   
      <div class="settings-container fullscreen-settings">
        <select v-model="tutorialOptions.inEditionID" id="tutorials-list" title="Select tutorial in local storage for edition">
          <option value="" disabled>Select</option>
          <option v-for="tutorial in tutorialOptions.available" :key="tutorial" :value="tutorial">
            {{ tutorial }}
          </option>
        </select>
        <div class="buttons">
          <button class="blue-button" title="Save current tutorial on your local file system" 
                @click="downloadJSON">   Download </button>
          <button class="blue-button" title="Load new tutorial from your local file system" 
                @click="uploadTutorial"> Upload   </button>
          <button class="blue-button" title="Add edited tutorial to local storage (accessible for visualization)" 
                @click="addTutorial"> Add to menu </button>
          <button class="blue-button" title="Remove selected tutorial from local storage" 
                @click="removeTutorial"> Remove from menu </button>
        </div>
        <div class="buttons">
          <button class="blue-button" title="Clear current tutorial draft and start fresh"
                @click="clearDraft">  Clear Draft  </button>
        </div>
      </div>
    </div>

    <div class="tutorial-editor">
      
      <!-- Header: Tutorial Description -->
      <div class="editor-content">
        <div class="section tutorial-header">
          <div class="form-group left-column">
            <div class="label-input-row">
              <label>ID <span class="required">*</span></label>
              <input v-model="tutorial.id" type="text" title="Tutorial identifier, used as name of corresponding JSON file"  class="name-input">
	          </div>
            <div class="label-input-row">
              <label>Name <span class="required">*</span></label>
              <input v-model="tutorial.name" type="text" placeholder="Enter tutorial name, used to identify tutorial" title="Tutorial name, used to identify tutorial" class="name-input">
            </div>
            <label>Description</label>
            <textarea v-model="tutorial.description" placeholder="Brief description of the tutorial" title="Description of the tutorial"></textarea>
            <div class="buttons">
              <button class="blue-button" title="Add new step to the tutorial (after selected step)" 
                :disabled="stepNumber >= maxSteps"
                @click="addStep('step', stepNumber)">Add new Step</button>
              <button class="blue-button" title="Add new question to the tutorial (after selected step)" 
                :disabled="stepNumber >= maxSteps"
                @click="addStep('question', stepNumber)">Add new Question</button>
              <button class="blue-button" title="Duplicate selected step (after the selected one)"
                :disabled="stepNumber < 0 || stepNumber >= maxSteps"
                @click="addStep(null, stepNumber)">Duplicate</button>
            </div>
          </div>
          <div class="form-group right-column">
            <div class="tutorial-img">
              <div v-html="tutorialSvg" v-if="tutorialSvg"></div>
            </div>
          </div>
        </div>

        <!-- Card: step/question -->
        <div v-if="currentStep" class="section scrollable-panel">
          <div class="step-card" :class="{ 'question-card': currentStep.type === 'question' }">
            <div class="form-group left-column">
              <div class="form-row">
                <span class="step-number" :class="{ 'question-number': currentStep.type === 'question' }" title="Remove selected step">
                  {{ stepNumber }} 
                </span>
                <button @click="removeStep(stepNumber)" class="remove-btn">×</button>
              </div>
              <label>{{currentStep.type === 'question' ? 'Question title' : 'Step title'}}<span class="required">*</span></label>
              <input v-model="currentStep.title" type="text" :placeholder="currentStep.type === 'question' ? 'Question title' : 'Step title'">
              <label>Description</label>
              <textarea v-model="currentStep.description" placeholder="What happens"></textarea>
              <template v-if="currentStep.type === 'step'">  
                <label>Position</label>
                <select v-model="currentStep.position">
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
                <label>Element to Highlight <span class="required">*</span></label>
                <select v-model="currentStep.selectorPreset" @change="onSelectorPresetChange(currentStep)" class="selector-preset">
                  <option v-for="opt in predefinedSelectors" :key="opt.label" :value="opt.value" :disabled="opt.disabled">
                    {{ opt.label }}
                  </option>
                </select>
                <input v-model="currentStep.selector" type="text" placeholder="CSS selector (e.g., #my-button, .my-class)" class="selector-input">
              </template>
              <template v-if="currentStep.type === 'question'">             
                <label>Answer Mode <span class="required">*</span></label>
                <div class="answer-mode-selector">
                  <label class="mode-radio">
                    <input type="radio" v-model="currentStep.answerMode" value="single" @change="onAnswerModeChange(step)">
                    <span>Single-choice</span>
                  </label>
                  <label class="mode-radio">
                    <input type="radio" v-model="currentStep.answerMode" value="multiple" @change="onAnswerModeChange(step)">
                    <span>Multiple-choice</span>
                  </label>
                </div>
               </template>
            </div>

            <template v-if="currentStep.type === 'step'">             
              <div class="form-group">
                <label>Action (optional)</label>
                <select v-model="currentStep.action">
                  <option value="">                               No action            </option>
                  <option value="switchTo:simulationComponent">   Go to Simulation     </option>
                  <option value="switchTo:analysisComponent">     Go to Static Analysis</option>
                  <option value="switchTo:timelineComponent">     Go to Timeline       </option>
                  <option value="switchToFull:processorComponent">Go to Processor      </option>
                  <option value="switchToFull:programComponent">  Go to Program        </option>
                  <option value="switchToFull:tutorialComponent"> Go to Tutorial       </option>
                </select>

                <label>Step Image (opt.)</label>
                <div class="image-upload-section">
                  <input type="file" accept="image/*" @change="(e) => handleImageUpload(e, currentStep)" class="image-input">
                  <div v-if="currentStep.image" class="image-preview">
                    <img :src="currentStep.image" alt="Image preview">
                    <button @click="currentStep.image = ''" class="remove-image-btn" type="button">× Remove</button>
                  </div>
                </div>
              </div>

              <div v-if="currentStep.validationType" class="validation-card">
                <label>Validation</label>
                <div class="form-group">
                  <label>Type</label>
                  <select v-model="currentStep.validationType">
                    <option value=""> No validation </option>
                    <option value="program_selected">  Program selected     </option>
                    <option value="architecture_selected"> Architecture selected</option>
                    <option value="input_value">    Exact input value    </option>
                    <option value="input_value_min">   Minimum input value  </option>
                    <option value="button_clicked">  Button clicked    </option>
                  </select>
                </div>

                <div v-if="currentStep.validationType" class="validation-details">
                  <div v-if="currentStep.validationType === 'program_selected'" class="form-group">
                    <label>Program name</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="rec, fact, sum, etc.">
                  </div>

                  <div v-if="currentStep.validationType === 'architecture_selected'" class="form-group">
                    <label>Architecture name</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="baseline, base2, ooo, etc.">
                  </div>

                  <div v-if="currentStep.validationType === 'input_value'" class="form-group">
                    <label>Expected value</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="16">
                  </div>

                  <div v-if="currentStep.validationType === 'input_value' || currentStep.validationType === 'input_value_min'" class="form-group">
                    <label>Input Field</label>
                    <select v-model="currentStep.validationSelectorPreset" @change="onValidationSelectorPresetChange(currentStep)" class="selector-preset">
                      <option v-for="opt in validationInputSelectors" :key="opt.label" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-model="currentStep.validationSelector" type="text" placeholder="CSS selector for input field" class="selector-input">
                  </div>

                  <div v-if="currentStep.validationType === 'input_value_min'" class="form-group">
                    <label>Minimum value</label>
                    <input v-model="currentStep.validationMinValue" type="number" placeholder="10">
                  </div>

                  <div v-if="currentStep.validationType === 'button_clicked'" class="form-group">
                    <label>Button to Click</label>
                    <select v-model="currentStep.validationSelectorPreset" @change="onValidationSelectorPresetChange(currentStep)" class="selector-preset">
                      <option v-for="opt in validationButtonSelectors" :key="opt.label" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-model="currentStep.validationSelector" type="text" placeholder="CSS selector for button (e.g., #run-btn)" class="selector-input">
                  </div>

                  <div class="form-group">
                    <label>Error message</label>
                    <input v-model="currentStep.validationMessage" type="text" placeholder="Complete this action to continue">
                  </div>
                </div>
              </div>
              
              <div v-else class="form-group">
                <label>Validation</label>
                <select v-model="currentStep.validationType">
                    <option value="">                      No validation        </option>
                    <option value="program_selected">      Program selected     </option>
                    <option value="architecture_selected"> Architecture selected</option>
                    <option value="input_value">           Exact input value    </option>
                    <option value="input_value_min">       Minimum input value  </option>
                    <option value="button_clicked">        Button clicked       </option>
                  </select>
              </div>
            </template>

            <template v-else-if="currentStep.type === 'question'">
              <div class="form-group left-column">
                <label>Question Text <span class="required">*</span></label>
                <textarea v-model="currentStep.questionText" placeholder="Enter your question here..." title="Question text"></textarea>
 
                <label>Question Image (optional)</label>
                <div class="image-upload-section">
                  <input type="file" accept="image/*" @change="(e) => handleImageUpload(e, currentStep)" class="image-input">
                  <div v-if="currentStep.image" class="image-preview">
                    <img :src="currentStep.image" alt="Question image preview">
                    <button @click="currentStep.image = ''" class="remove-image-btn" type="button">× Remove</button>
                  </div>
                </div>
              </div>
              
              <div class="answers-section right-column">
                <h4>Answers (up to 6) 
                   <span class="required">*</span>
                   - {{ currentStep.answerMode === 'single' ? 'Only one must be correct' : 'At least one must be correct' }}
                </h4>
                <div v-for="(answer, ansIndex) in currentStep.answers" :key="ansIndex" class="answer-card" :class="{ 'correct-answer': answer.isCorrect }">
                  <div class="answer-header">
                    <span class="answer-letter">{{ String.fromCharCode(65 + ansIndex) }}</span>
                    <label>Answer Text <span class="required">*</span></label>
                    <label class="correct-checkbox">
                      <input type="checkbox" v-model="answer.isCorrect" @change="onCorrectAnswerChange(currentStep, ansIndex)">
                      <span>Correct</span>
                    </label>
                    <button v-if="currentStep.answers.length > 2" @click="removeAnswer(currentStep, ansIndex)" class="remove-answer-btn">×</button>
                  </div>
                  
                  <div class="form-group">
                    <input v-model="answer.text" type="text" placeholder="Answer option...">
                  </div>
                  
                  <div class="feedback-group">
                    <div class="form-group">
                      <label v-if="answer.isCorrect">✓ Explanation (shown when user selects this correct answer)</label>
                      <label v-else>✗ Explanation (shown when user selects this wrong answer)</label>
                      <input v-model="answer.explanation" type="text" :placeholder="answer.isCorrect ? 'Great! This is correct because...' : 'This is incorrect because...'">
                    </div>
                  </div>
                </div>
                
                <button v-if="currentStep.answers.length < 6" @click="addAnswer(currentStep)" class="add-answer-btn">+ Add Answer</button>
              </div>
            </template>

          </div>
        </div>
        
    </div>
  </div>

  <div v-if="showModalUp" class="modal-overlay">
    <div class="modal">
      <h4>Load Tutorial As</h4>
      <label for="config-name">Name:</label>
      <input id="config-name" type="text" v-model="modalName" />
      <div v-if="nameError" class="error">{{ nameError }}</div>
      <div class="modal-actions">
        <button class="blue-button" title="Accept Load" @click="confirmModal"> Load  </button>
        <button class="blue-button" title="Cancel Load" @click="cancelModal"> Cancel </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    text="The tutorial allows ... Tutorials can be uploaded or downloaded in JSON format."
      title="Tutorial Edition"
    @close="closeHelp"  />
  </Teleport>

  </div>
</template>

<script setup>
import { ref, computed, inject, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'
import HelpComponent  from '@/components/helpComponent.vue';

const simState = inject('simulationState');
 
// ============================================================================
// Tutorial options & LocalStorage
// ============================================================================
const STORAGE_KEY = 'tutorialOptions'

const defaultOptions = { // save this & tutorialTemp
  available:   [],
  inEditionID: '',
  selectedStep: -1
}

const tutorial        = reactive({ id: 'newTut', name: '', description: '', steps: [] })   // default edited
const tutorialSvg     = ref('')

const MAX_IMAGE_SIZE = 500 * 1024 // 500KB

const savedOptions = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    console.log('🎓load options (editor)')
    return saved ? JSON.parse(saved) : defaultOptions
  } catch {
    return defaultOptions
  }
})()

const tutorialOptions  = reactive({ ...defaultOptions, ...savedOptions })
  
const saveOptions = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tutorialOptions))
    console.log('🎓✅ save options (editor)')
  } catch (error) {
    console.error('🎓❌ Failed to save (editor):', error)
  }
}

const currentStep = computed(() => {
  if (tutorialOptions.selectedStep < 0) return null
  return tutorial.steps[tutorialOptions.selectedStep]
});

const stepNumber = computed(() => tutorialOptions.selectedStep)
const maxSteps   = computed(() => tutorial.steps.length)

// Predefined CSS selectors for highlighting elements
const predefinedSelectors = [
  { label: 'Custom', value: '' },
  { label: '── Main Areas ──',      value: '', disabled: true },
  { label: 'Header / Title',        value: '.header-title' },
  { label: 'Program Area',          value: '.program' },
  { label: 'Processor Area',        value: '.processor' },
  { label: 'Results Area',          value: '.results' },
  { label: '── Program Section ──', value: '', disabled: true },
  { label: 'Program Selector',      value: '#programs-list' },
  { label: 'Processor Selector',    value: '#processors-list' },
  { label: '── Processor Config ──', value: '', disabled: true },
  { label: 'ROB Size Input',        value: '#rob-size' },
  { label: 'Simulation iterations', value: '#simulation-iterations' },
  { label: '── Buttons ──',         value: '', disabled: true },
  { label: 'Run Simulation Button', value: '#run-simulation-button' },
  { label: '── Navigation Tabs ──', value: '', disabled: true },
  { label: 'Simulation Tab',        value: '#simulation-button' },
  { label: 'Static Analysis Tab',   value: '#analysis-button' },
  { label: 'Timeline Tab',          value: '#timeline-button' },
  { label: 'Processor Editor Tab',  value: '#processor-button' },
  { label: 'Program Editor Tab',    value: '#program-button' }
]

const validationInputSelectors = [
  { label: 'Custom',               value: '' },

  { label: 'ROB Size',             value: '#rob-size' },
  { label: 'Dispatch Width',       value: '#dispatch-width' },
  { label: 'Retire Width',         value: '#retire-width' },

  { label: 'INT latency',          value: '#INT-latency' },
  { label: 'BRANCH latency',       value: '#BRANCH-latency' },
  { label: 'MEM.LOAD latency',     value: '#MEM.LOAD-latency' },
  { label: 'MEM.STR latency',      value: '#MEM.STR-latency' },
  { label: 'MEM.VLOAD latency',    value: '#MEM.VLOAD-latency' },
  { label: 'MEM.VSTR latency',     value: '#MEM.VSTR-latency' },
  { label: 'FLOAT.ADD latency',    value: '#FLOAT.ADD-latency' },
  { label: 'FLOAT.MUL latency',    value: '#FLOAT.MUL-latency' },
  { label: 'FLOAT.FMA latency',    value: '#FLOAT.FMA-latency' },
  { label: 'FLOAT.DIV latency',    value: '#FLOAT.DIV-latency' },
  { label: 'FLOAT.SQRT latency',   value: '#FLOAT.SQRT-latency' },
  { label: 'VFLOAT.FMA latency',   value: '#VFLOAT.FMA-latency' },
  { label: 'VFLOAT.MUL latency',   value: '#VFLOAT.MUL-latency' },
  { label: 'VFLOAT.ADD latency',   value: '#VFLOAT.ADD-latency' },

  { label: 'Check INT on Port0',    value: '#Port0-INT-check' },
  { label: 'Check BRANCH  on Port0', value: '#Port0-BRANCH-check' },

  { label: 'Number of Blocks in cache',  value: '#cache-blocks' },
  { label: 'Size of cache blocks',       value: '#block-size' },
  { label: 'Cache miss penalty',         value: '#miss-penalty' },
  { label: 'Cache miss issue time',      value: '#miss-issue-time' },

  { label: 'Simulation iterations', value: '#simulation-iterations' },
  { label: 'Critical Path table',             value: '#critical-path' },

  { label: 'Number of timeline iterations',   value: '#timeline-iterations' },
  { label: 'Timeline Zoom Out',               value: '#timeline-zoom-out' },
  { label: 'Timeline Zoom In',                value: '#timeline-zoom-in' },
  { label: 'Timeline show ports',             value: '#timeline-show-ports' },
  { label: 'Timeline show instructions',      value: '#timeline-show-instructions' },

  { label: 'Dependence Graph',                value: '#dependence-graph' },
  { label: 'Show internal dependences',       value: '#show-internal-dependences' },
  { label: 'Show latency dependences',        value: '#show-latency-dependences' },
  { label: 'Show instruction dependences',    value: '#show-instruction-dependences' },
  { label: 'Show full dependences',           value: '#show-intfull-dependences' },
  { label: 'Open full dependence graph',      value: '#open-full-dependence-graph' },

  { label: 'Performance bound information',   value: '#performance-bound' },
  { label: 'Performance latency limit',       value: '#latency-limit' },
  { label: 'Performance throughput limit',    value: '#throughput-limit' },  
  { label: 'Performance best limit',          value: '#best-limit' },
  { label: 'Detailed thorughput limits',      value: '#detailed-thorughput-limits' },

  { label: 'Main RVCAT header',               value: '#top' },
  { label: 'Processor panel',                 value: '#processor-panel' },
  { label: 'Program panel',                   value: '#program-panel' },
  { label: 'Tutorial panel',                  value: '#tutorial-panel' },
  { label: 'Right panel',                     value: '#right-panel' },
  { label: 'Tutorial activation icon',        value: '#tutorial-activation' }
]

const validationButtonSelectors = [
  { label: 'Custom',                     value: '' },
  { label: 'Set processor panel',        value: '#processor-button' },
  { label: 'Set program panel',          value: '#program-button' },
  { label: 'Set tutorial panel',         value: '#tutorial-button' },
  { label: 'Set simulation panel',       value: '#simulation-button' },
  { label: 'Set analysis panel',         value: '#analysis-button' },
  { label: 'Set timeline panel',         value: '#timeline-button' },
  { label: 'Set about panel',            value: '#about-button' },
  { label: 'Run Simulation',             value: '#run-simulation-button' },
  { label: 'Apply Processor Config.',    value: '#apply-processorconfig-button' },
  { label: 'Upload Processor Config.',   value: '#upload-processorconfig-button' },
  { label: 'Download Program',           value: '#program-download-button' },
  { label: 'Upload Program',             value: '#program-upload-button' },
  { label: 'Remove PortX',               value: '#remove-port0-button' },
  { label: 'Add Port',                   value: '#add-port-button' }
]

// ============================================================================
// STEP CREATION HELPERS
// ============================================================================
const createEmptyStep = () => ({
  type:            'step',
  title:           '',
  description:     '',
  image:           '',
  selectorPreset:  '',
  selector:        '',
  position:        'bottom',
  action:          '',
  validationType:  '',
  validationValue: '',
  validationSelector: '',
  validationMinValue: '',
  validationMessage:  '',
  validationSelectorPreset: ''
})

const createEmptyQuestion = () => ({
  type:          'question',
  title:         '',
  questionText:  '',
  image:         '',
  answerMode:    'single',
  answers: [
    { text: '', isCorrect: true, explanation: '' },
    { text: '', isCorrect: false, explanation: '' }
  ]
})

const addStep = (type = 'step', atIndex = -1) => {
  let insertIndex= atIndex+1
  let newStep = null
 
  if (!type) {  // duplicate current
    insertIndex = Math.max(0, Math.min(insertIndex-1, tutorial.steps.length - 1)); 
    // Create deep copy
    newStep = JSON.parse(JSON.stringify(tutorial.steps[insertIndex]));
    newStep.title = `${newStep.title} (copy)`;
    insertIndex = insertIndex+1
  }
  else
    newStep = (type === 'question' ? createEmptyQuestion() : createEmptyStep());

  tutorial.steps.splice(insertIndex, 0, newStep);
  tutorialOptions.selectedStep = insertIndex;
}

const removeStep = (index) => {
  tutorial.steps.splice(index, 1)
  tutorialOptions.selectedStep = index-1;
}

// ============================================================================
// STEP TYPE & MODE CHANGES
// ============================================================================
const onSelectorPresetChange = (step) => {
  if (step.selectorPreset) step.selector = step.selectorPreset
}

const onValidationSelectorPresetChange = (step) => {
  if (step.validationSelectorPreset) step.validationSelector = step.validationSelectorPreset
}

// ============================================================================
// ANSWER HANDLING
// ============================================================================
const ensureOneCorrectAnswer = (step) => {
  if (step.answers?.length && !step.answers.some(a => a.isCorrect)) {
    step.answers[0].isCorrect = true
  }
}

const onCorrectAnswerChange = (step, changedIndex) => {
  if (step.answerMode === 'single' && step.answers[changedIndex].isCorrect) {
    step.answers.forEach((a, i) => { if (i !== changedIndex) a.isCorrect = false })
  }
  ensureOneCorrectAnswer(step)
}

const onAnswerModeChange = (step) => {
  if (step.answerMode === 'single') {
    const firstCorrect = step.answers.findIndex(a => a.isCorrect)
    if (firstCorrect >= 0) {
      step.answers.forEach((a, i) => { if (i !== firstCorrect) a.isCorrect = false })
    }
  }
  ensureOneCorrectAnswer(step)
}

const addAnswer = (step) => {
  if (step.answers.length < 6) {
    step.answers.push({ text: '', isCorrect: false, explanation: '' })
  }
}

const removeAnswer = (step, index) => {
  if (step.answers.length > 2) {
    step.answers.splice(index, 1)
    ensureOneCorrectAnswer(step)
  }
}
  
// ============================================================================
// IMAGE UPLOAD (unified handler)
// ============================================================================
const handleImageUpload = (event, step) => {
  const file = event.target.files[0]
  if (!file) return
  
  if (file.size > MAX_IMAGE_SIZE) {
    alert('Image is too large. Please use an image smaller than 500KB.')
    event.target.value = ''
    return
  }
  
  const reader  = new FileReader()
  reader.onload = (e) => { step.image = e.target.result }
  reader.readAsDataURL(file)
}

// ============================================================================
// TUTORIAL CONVERSION (shared logic)
// ============================================================================
const buildValidation = (step) => {
  if (!step.validationType) return null
  
  const validation = {
    type:    step.validationType,
    message: step.validationMessage || 'Complete this action to continue'
  }
  
  switch (step.validationType) {
    case 'program_selected':
    case 'architecture_selected':
      validation.value    = step.validationValue
      break
    case 'input_value':
      validation.selector = step.validationSelector
      validation.value    = step.validationValue
      break
    case 'input_value_min':
      validation.selector = step.validationSelector
      validation.minValue = parseInt(step.validationMinValue)
      break
    case 'button_clicked':
      validation.selector = step.validationSelector
      break
  }
  return validation
}

const convertStepForExport = (step) => {
  if (step.type === 'question') {
    const q = {
      type:         'question',
      title:        step.title,
      questionText: step.questionText,
      answerMode:   step.answerMode,
      answers:      step.answers.filter(a => a.text).map(a => ({
        text:        a.text,
        isCorrect:   a.isCorrect,
        explanation: a.explanation || ''
      }))
    }
    if (step.image) q.image = step.image
    return q
  }
  
  const s = {
    type:        'step',
    title:       step.title,
    description: step.description,
    selector:    step.selector,
    position:    step.position
  }
  if (step.image)   s.image  = step.image
  if (step.action)  s.action = step.action
  
  const validation = buildValidation(step)
  if (validation) 
    s.validation = validation
  
  return s
}

const buildTutorialData = (filename) => ({
  id:          filename,
  name:        tutorial.name,
  description: tutorial.description,
  steps:       tutorial.steps
    .filter(s => s.title && (s.type === 'question' || s.selector))
    .map(convertStepForExport)
})

// ============================================================================
// VALIDATION
// ============================================================================
const validateTutorial = () => {
  const errors = []
  
  if (!tutorial.name?.trim())         errors.push('• Tutorial Name is required')
  if (!tutorial.steps.length)         errors.push('• At least one step or question is required')
  
  tutorial.steps.forEach((step, i) => {
    const n = i
    if (!step.title?.trim())          errors.push(`• Step ${n}: Title is required`)
    
    if (step.type === 'question') {
      if (!step.questionText?.trim()) errors.push(`• Step ${n}: Question Text is required`)
      if (!step.answerMode)           errors.push(`• Step ${n}: Answer Mode is required`)
      
      const validAnswers = step.answers?.filter(a => a.text?.trim()) || []
      if (validAnswers.length < 2)    errors.push(`• Step ${n}: At least 2 answers with text are required`)
      
      const correctAnswers = step.answers?.filter(a => a.isCorrect && a.text?.trim()) || []
      if (step.answerMode === 'single' && correctAnswers.length !== 1) {
                                      errors.push(`• Step ${n}: Single-choice mode requires exactly one correct answer`)
      } else if (correctAnswers.length === 0) {
                                      errors.push(`• Step ${n}: At least one answer must be marked as correct`)
      }
    } else if (!step.selector?.trim()) {
                                      errors.push(`• Step ${n}: CSS Selector is required`)
    }
  })
  
  return errors
}

const showValidationErrors = () => {
  const errors = validateTutorial()
  if (errors.length) {
    alert('Please fix the following errors:\n\n' + errors.join('\n'))
    return false
  }
  return true
}
  
// ============================================================================
// HELP
// ============================================================================
  const showHelp     = ref(false);
  const helpPosition = ref({ top: '0%', left: '40%' });
  const helpIcon     = ref(null);

  function openHelp()  { nextTick(() => { showHelp.value = true }) }
  function closeHelp() { showHelp.value  = false }


// ============================================================================
// TUTORIAL ACTIONS: InitTutorial, ReloadTutorial, clearDraft, previewTutorial, addTutorial, downloadJSON
// ============================================================================
const initTutorial = async () => {
  await initResource({
    resourceName: 'tutorial',
    logPrefix:    '🎓',
    optionsObj:    tutorialOptions,
    currentKey:    null,
    availableKey: 'available',
  });
};

const reloadEditedTutorial = async () => {
  if (tutorialOptions.inEditionID === "") {
    clearDraft(false)
    console.log('🎓🔄 Reloading edited tutorial with clear draft.');
    return
  }
  try {
    let data
    let jsonString = localStorage.getItem('tutorialTemp');
    if (jsonString)
      data = JSON.parse(jsonString)
    if (!jsonString || data.id !== tutorialOptions.inEditionID) {
      jsonString = localStorage.getItem(`tutorial.${tutorialOptions.inEditionID}`)
      if (jsonString)
        data = JSON.parse(jsonString)
    }
    if (jsonString) {
      tutorial.id          = tutorialOptions.inEditionID || ''
      tutorial.name        = data.name        || ''
      tutorial.description = data.description || ''
      tutorial.steps       = data.steps       || []
      tutorialOptions.selectedStep = 0
      console.log('🎓🔄 Reloading Edited tutorial with:', tutorialOptions.inEditionID);
    }
    else {
      clearDraft(false)
      console.log('🎓🔄 Reloading edited tutorial with clear draft.');
    }
  } catch (error) {
    clearDraft(false)
    console.error('🎓❌ Failed to reload edited tutorial:', error)
  }      
}

const clearDraft = (check = true) => {
  if ( !check || confirm('Are you sure you want to clear the current draft? This action cannot be undone.') ) {
    tutorial.id          = 'newTutorial'
    tutorial.name        = ''
    tutorial.description = ''
    tutorial.steps       = []
    tutorialOptions.inEditionID = "newTutorial"
    tutorialOptions.selectedStep = -1
  }
}

const addTutorial = () => {
  if (!showValidationErrors()) return
  let filename = tutorial.id
  
  filename = downloadJSON()  // TODO: use modal variable to decide if downloading or not

  tutorialOptions.available.push(filename)
  const data = buildTutorialData(filename)
  localStorage.setItem(`tutorial.${filename}`, JSON.stringify(data, null, 2))
 
  console.log(`👨‍🎓✅ Added tutorial to local storage: ${filename}`)
  simState.state = 4;   // Signal tutorial engine to obtain list of tutorials from localStorage
  clearDraft()
}

const downloadJSON = () => {
  if (!showValidationErrors()) return

  const filename = tutorial.id
  const data = buildTutorialData(filename)
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href     = url
  link.download = `${filename}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return filename
}

const removeTutorial = () => {
  if (!tutorial?.id || tutorial.id !== tutorialOptions.inEditionID) {
    console.error('👨‍🎓❌ No tutorial selected');
    return;
  }

  tutorialOptions.available = tutorialOptions.available.filter(
    id => id !== tutorial.id
  );
  
  localStorage.removeItem(`tutorial.${tutorial.id}`)
 
  console.log(`👨‍🎓🧹 Tutorial removed from local storage: ${tutorial.id}`)
  
  clearDraft()
  simState.state = 4;   // Signal tutorial engine to obtain new list of tutorials from localStorage
}
  
// ============================================================================
// UPLOAD TUTORIAL
// ============================================================================

const convertUploadedStep = (step) => {
  if (step.type === 'question') {
    const q = {
      type:          'question',
      title:         step.title || '',
      questionText:  step.questionText || '',
      image:         step.image || '',
      answerMode:    step.answerMode || 'single',
      answers:      (step.answers || []).map(a => ({
        text:        a.text || '',
        isCorrect:   a.isCorrect || false,
        explanation: a.explanation || ''
      }))
    }
    while (q.answers.length < 2) {
      q.answers.push({ text: '', isCorrect: false, explanation: '' })
    }
    if (!q.answers.some(a => a.isCorrect)) q.answers[0].isCorrect = true
    return q
  }
  
  const s = {
    ...createEmptyStep(),
    title:       step.title       || '',
    description: step.description || '',
    image:       step.image       || '',
    selector:    step.selector    || '',
    position:    step.position    || 'bottom',
    action:      step.action      || ''
  }
  
  if (step.validation) {
    s.validationType =     step.validation.type     || ''
    s.validationMessage =  step.validation.message  || ''
    s.validationValue =    step.validation.value    || ''
    s.validationSelector = step.validation.selector || ''
    s.validationMinValue = step.validation.minValue || ''
  }
  return s
}

const uploadTutorial = () => {
  const input         = document.createElement('input')
  input.type          = 'file'
  input.accept        = '.json'
  input.style.display = 'none'
  
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    try {
      const data = JSON.parse(await file.text())
      
      if (!data.id || !data.name || !data.steps?.length) {
        alert('Invalid tutorial file format')
        return
      }
      
      tutorial.id          = data.id          || ''
      tutorial.name        = data.name        || ''
      tutorial.description = data.description || ''
      tutorial.steps       = data.steps.map(convertUploadedStep)

      tutorialOptions.inEditionID  = data.id
      tutorialOptions.selectedStep = 0
      
      console.log('🎓📥 Tutorial downloaded from local file system', tutorial.name);
    } catch (err) {
      console.error('🎓❌ Failed to download tutorial:', err)
      alert('Failed to download tutorial file. Please check the file format.')
    }
  }
  document.body.appendChild(input)
  input.click()
  document.body.removeChild(input)
}

// ============================================================================
// GRAPH: generateTutorialDot
// ============================================================================
async function processTutorialUpdate(t) {
  try {
    localStorage.setItem('tutorialTemp', JSON.stringify(t));
    console.log('🎓📥 Edited tutorial saved in localStorage', t.name);

    if (t.id !== tutorialOptions.inEditionID)
      tutorialOptions.inEditionID = t.id   // create reaction to save current options
      
    const dotCode = generateTutorialDot(t);
    console.log('🎓📥 Dot Code', dotCode);
      
    const svg = await createGraphVizGraph(dotCode);
    tutorialSvg.value = svg.outerHTML;
  } catch (error) {
    console.error('🎓❌ Failed to save edited tutorial in localStorage and update tutorial view:', error);
  }
}

function generateTutorialDot(tut) {
  const num_steps = tut.steps.length
  let dot_code = `
digraph "Tutorial Graph" {
  rankdir=LR; splines=spline; newrank=true;
  subgraph cluster_0 {
   style="filled,rounded"; color=grey; tooltip="Tutorial flow-graph"; fillcolor=lightgrey;
   node [style=filled,margin="0.05,0.05", fontname="courier", URL="javascript:void(0)"]; 
`
  for (let i = 0; i < num_steps; i++) {
    let color = "blue"
    let fill  = "lightblue"
    let type  = tut.steps[i].type
    if (type !== "step") {
      color = "purple"
      fill  = "mediumpurple1"
    } 
    dot_code += `    a${i} [id="${i}", color=${color}, fillcolor=${fill}, label=<<B><FONT COLOR="${color}">${i}</FONT></B>>, 
                            tooltip="Click to edit this ${type}"]\n`
  }
  dot_code += `
  }
  start [fontsize=8 margin="0.05,0.02" shape=Msquare]
  end   [fontsize=8 margin="0.05,0.02" shape=Msquare]
`
  if (num_steps > 0) {
    dot_code += `     start -> `
    for (let i = 0; i < (num_steps-1); i++) {
      dot_code += `a${i} -> `
    }
    dot_code += `a${num_steps-1} -> end`
  }
  else {
    dot_code += `     start -> end`
  }
  return dot_code + `
  }`
}

// ============================================================================
// WATCHES: globalState, tutorial, options
// ============================================================================
let saveTimeout      = null;
let lastSelectedNode = null;
let clickListeners   = [];     // To clean listeners

watch(tutorial, (t) => {
  if (saveTimeout)    // Cancel previous timeout
    clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await processTutorialUpdate(t);
  }, 100);
}, { deep: true });
  
watch (
  [() => tutorialOptions.available, 
   () => tutorialOptions.inEditionID,
   () => tutorialOptions.selectedStep],
  ([newList, newID, newStep], [oldList, oldID, oldStep] ) => {
    saveOptions()
    if (newList !== oldList || newID !== oldID) {
      if (tutorialOptions.inEditionID !== tutorial.id)
        reloadEditedTutorial()
    } else if (newStep >= 0)
      selectNodeByIndex(newStep)
  },
  { deep: true }
)
  
// Watch for changes on Simulation state
watch(() => simState.state, (newValue, oldValue) => {
  if (newValue == 3) { // Initialization Stage
    (async () => {
      await initTutorial();
      simState.state = 4;   // Signal tutorial engine to obtain list of tutorials from localStorage
      console.log('🎓📥 Initialization step (4): tutorials loaded')
    })();
  }
});

// Cuando el SVG se actualice, agregar listeners
watch(() => tutorialSvg.value, () => {
  addClickListenersToSvg();
});

const addClickListenersToSvg = () => {
  nextTick(() => {
    const svgElement = document.querySelector('.tutorial-img svg');
    if (!svgElement) return;

    removeClickListeners();

    // Add event listener to all nodes
    const nodes = svgElement.querySelectorAll('g.node');
    nodes.forEach((node, index) => {
      node.style.cursor = 'pointer';

      const handleClick = (event) => {
        event.stopPropagation();
        let stepN = index
        
        console.log('🎓 Selected step:', stepN);
        
        // 1. DESELECT previous node
        if (lastSelectedNode && lastSelectedNode !== node) {
          resetNodeStyle(lastSelectedNode);
        }
        
        // 2. SELECT new node
        highlightNodeAsSelected(node);
        
        // 3. Update State
        lastSelectedNode = node;
        if (index > tutorial.steps.length)
          stepN = -1

        tutorialOptions.selectedStep = stepN;
      };

      const handleMouseEnter = () => {
        if (node !== lastSelectedNode) {
          node.style.filter     = 'drop-shadow(0 0 3px rgba(0, 0, 0, 0.3))';
          node.style.transition = 'filter 0.15s ease';
        }
      };
      
      const handleMouseLeave = () => {
        if (node !== lastSelectedNode) {
          node.style.filter = 'none';
        }
      };
  
      node.addEventListener('click',      handleClick);
      node.addEventListener('mouseenter', handleMouseEnter);
      node.addEventListener('mouseleave', handleMouseLeave);

      clickListeners.push({
        node,
        click: handleClick,
        enter: handleMouseEnter,
        leave: handleMouseLeave
      });

      selectNodeByIndex(tutorialOptions.selectedStep)
    });
  });
};

const removeClickListeners = () => {
  clickListeners.forEach(({ node, click, enter, leave }) => {
    node.removeEventListener('click', click);
    node.removeEventListener('mouseenter', enter);
    node.removeEventListener('mouseleave', leave);
  });
  clickListeners = [];
};

const highlightNodeAsSelected = (node) => {
  node.style.filter = 'drop-shadow(0 0 10px rgba(0, 100, 255, 0.8))';
  const shapes = node.querySelectorAll('ellipse, polygon, path, rect');
  shapes.forEach(shape => {
    if (!shape.hasAttribute('data-original-stroke')) {
      shape.setAttribute('data-original-stroke', 
        shape.getAttribute('stroke') || '#000000');
      shape.setAttribute('data-original-stroke-width', 
        shape.getAttribute('stroke-width') || '1');
    }
    
    shape.setAttribute('stroke', '#0066ff');
    shape.setAttribute('stroke-width', '3');
    shape.style.stroke = '#0066ff';
    shape.style.strokeWidth = '3px';
  });

  node.classList.add('selected');
};

const resetNodeStyle = (node) => {
  node.style.filter = 'none';
  node.classList.remove('selected');
  
  const shapes = node.querySelectorAll('ellipse, polygon, path, rect');
  shapes.forEach(shape => {
    const originalStroke      = shape.getAttribute('data-original-stroke');
    const originalStrokeWidth = shape.getAttribute('data-original-stroke-width');
    
    if (originalStroke) {
      shape.setAttribute('stroke', originalStroke);
      shape.style.stroke = originalStroke;
    }
    if (originalStrokeWidth) {
      shape.setAttribute('stroke-width', originalStrokeWidth);
      shape.style.strokeWidth = originalStrokeWidth;
    }
  });
};

const selectNodeByIndex = (index) => {
  const svgElement = document.querySelector('.tutorial-img svg');
  if (!svgElement) return;
  
  const nodes = svgElement.querySelectorAll('g.node');
  if (index >= 0 && index < nodes.length) {
    if (index == -1) index = 1+tutorial.steps.length
    const node = nodes[index];
    
    // Deselect
    if (lastSelectedNode && lastSelectedNode !== node) {
      resetNodeStyle(lastSelectedNode);
    }
    
    // Select new
    highlightNodeAsSelected(node);
    lastSelectedNode = node;
  }
};

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  console.log('🎓🎯 TutorialEditor mounted')
  addClickListenersToSvg();
});

onUnmounted(() => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  removeClickListeners();
  lastSelectedNode = null;
  console.log('🎓🧹 TutorialEditor mounted')
})

</script>

<style scoped>

.tutorial-editor {
  background:     white;
  border-radius:  12px;
  width:          100%;
  display:        flex;
  flex-direction: column;
  margin: auto;
}
  
.settings-container {
  display:     flex;
  align-items: center;
  gap:         10px;
}

.fullscreen-settings {
  display:     flex;
  align-items: center;
  gap:         10px;
}
  
#tutorials-list {
  font-size: larger;
}

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.section {
  flex: 1;
  overflow-y: auto;
  min-height: 0; /* Importante para flex + overflow */
  padding:       10px 10px;
  border-bottom: 1px solid #f3f4f6;
}

.section:last-child {
  border-bottom: none;
}
  
.tutorial-header {
  display:     flex;
  gap:         10px;
  align-items: flex-start;
  min-height: 200px; /* Altura mínima para la sección */
}

.left-column {
  flex:      1;      /* 1/4 del espacio disponible */
  min-width: 0; /* Evita que crezca más de lo necesario */
}

.right-column {
  flex: 3;          /* 3/4 del espacio disponible */
  min-width: 0;
  box-sizing: border-box; /* Incluye padding y border en el cálculo */
  display:    flex;
  padding:    2px;
  flex-direction: column;
  border:        1px solid #ddd;
  background:    #f8f9fa;
  border-radius: 8px;

    /* Control de altura máxima */
  max-height: 600px; /* O la altura máxima que prefieras */
  min-height: 200px; /* Altura mínima */
  
  /* Para que el contenido interno se ajuste */
  overflow: hidden; /* Oculta cualquier desbordamiento */
  position: relative; /* Para el posicionamiento interno */
}

 .tutorial-img {
    width:        100%;
    height:       100%;
    align-items:  center;
    object-fit:   contain;
    transform-box: fill-box;


    /*display: flex;
    justify-content: center;
    overflow: hidden;
    position: relative; */
  }

  .tutorial-img svg[viewBox] {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }  
  
  .tutorial-img svg text {
    font-size:   small;
    font-family: Arial, sans-serif;
  }
  .tutorial-img svg polygon,
  .tutorial-img svg path {
    stroke-width: 2px !important;
  }
  
/* Estilos CSS para nodos seleccionados */
.tutorial-img g.node.selected ellipse,
.tutorial-img g.node.selected polygon,
.tutorial-img g.node.selected path {
  stroke-width: 3px !important;
  stroke:       #0066ff !important;
  filter:       drop-shadow(0 0 5px rgba(0, 100, 255, 0.5));
}

.tutorial-img g.node:hover ellipse,
.tutorial-img g.node:hover polygon,
.tutorial-img g.node:hover path {
  stroke-width: 2px !important;
  stroke:       #444444 !important;
  cursor:       pointer;
}

.form-group {
  margin-bottom: 3px;
  padding-right: 10px;
}

.form-row {
  display:               grid;
  grid-template-columns: 1fr 140px;
  gap:                   1px;
}

.form-group label {
  display:       block;
  margin-bottom: 2px;
  font-size:     medium;
  font-weight:   500;
  color:         #374151;
}

.required {
  color:       #ef4444;
  font-weight: 600;
}

.form-group input,
.form-group textarea,
.form-group select {
  width:         100%;
  padding:       4px 6px;
  border:        1px solid #d1d5db;
  border-radius: 8px;
  font-size:     medium;
  color:         #111827;
  transition:    border-color 0.2s;
  font-family:   inherit;
  box-sizing:    border-box;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline:      none;
  border-color: #3b82f6;
  box-shadow:   0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group textarea {
  height:      60px;
  resize:      vertical;
  line-height: 1.2;
}

.label-input-row {
  display:       flex;
  align-items:   center;
  margin-bottom: 2px;
  gap:           8px;
  width:         100%;
}

.label-input-row label {
  flex-shrink: 0; 
  text-align:  right;
  font-weight: 500;
  white-space: nowrap; 
}

.name-input {
  flex:      1; /* Ocupa todo el espacio disponible */
  min-width: 0; /* Importante para que funcione flex */
  padding:   8px;
  border:    1px solid #ccc;
  border-radius: 4px;
  box-sizing: border-box;
}

/* Selector preset with text input combo */
.selector-preset {
  margin-bottom: 4px;
}

.selector-input {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size:   small;
}

.step-card {
  display:        flex;
  background:     #f9fafb;
  border:        1px solid #e5e7eb;
  border-radius: 10px;
  padding:       10px 10px;
  margin-bottom: 8px;
  position:      relative;
}

.step-header {
  display:         flex;
  justify-content: space-between;
  align-items:     center;
  margin-bottom:   8px;
}

.step-number {
  background:  #3b82f6;
  color:       white;
  font-size:   small;
  font-weight: 600;
  padding:     4px 8px;
  border-radius: 12px;
  min-width:  12px;
  max-width:  24px;
  text-align: center;
}

.remove-btn {
  background: #ef4444;
  color:      white;
  border:     none;
  border-radius: 4px;
  width:     24px;
  height:    24px;
  font-size: medium;
  cursor:    pointer;
  display:   flex;
  align-items:     center;
  justify-content: center;
  transition:      background-color 0.2s;
}

.remove-btn:hover {
  background: #dc2626;
}

.validation-card {
  background:    #fef3c7;
  border:        1px solid #f59e0b;
  border-radius: 8px;
  padding:       8px 8px;
  margin-top:    2px;
}

.validation-card h4 {
  margin:       0 0 16px 0;
  font-size:   small;
  font-weight: 600;
  color:       #92400e;
  text-align:  center;
}

.validation-details {
  margin-top: 12px;
}

/* Step type selector */
.step-type-selector {
  display: flex;
  gap:     12px;
}

.type-radio {
  display:     flex;
  align-items: center;
  gap:         6px;
  cursor:      pointer;
  font-size:   medium;
  color:       #374151;
}

.type-radio input {
  width:  auto;
  margin: 0;
  cursor: pointer;
}

/* Question card styles */
.question-card {
  display:      flex;
  background:   #f5f3ff;
  border-color: #8b5cf6;
}

.question-number {
  background: #8b5cf6 !important;
}

/* Answer mode selector */
.answer-mode-selector {
  display:    flex;
  gap:        4px;
  margin-top: 4px;
  flex-direction: column;
}

.mode-radio {
  display:     flex;
  align-items: center;
  gap:         4px;
  cursor:      pointer;
  font-size:   small;
  color:       #374151;
}

.mode-radio input {
  width:  auto;
  margin: 4px;
  cursor: pointer;
}

/* Image upload section */
.image-upload-section {
  display:        flex;
  flex-direction: column;
  gap:            8px;
}

.image-input {
  padding:       8px;
  border:        2px dashed #d1d5db;
  border-radius: 8px;
  cursor:        pointer;
  transition:    border-color 0.2s;
}

.image-input:hover {
  border-color: #3b82f6;
}

.image-preview {
  position:  relative;
  display:   inline-block;
  max-width: 400px;
}

.image-preview img {
  max-width:     100%;
  max-height:    250px;
  border-radius: 6px;
  border:        1px solid #e5e7eb;
}

.remove-image-btn {
  position:   absolute;
  top:        8px;
  right:      8px;
  background: #ef4444;
  color:      white;
  border:     none;
  border-radius: 4px;
  padding:       4px 6px;
  font-size:  small;
  cursor:     pointer;
  transition: background 0.2s;
}

.remove-image-btn:hover {
  background: #dc2626;
}

/* Answers section */
.answers-section {
  margin-top:    1px;
  padding-left:  8px;
  background:    white;
  border-radius: 8px;
  border:        1px solid #e5e7eb;
}

.answers-section h4 {
  margin:      0 0 2px 0;
  font-size:   small;
  font-weight: 600;
  color:       #374151;
}

.answer-card {
  background:    #f9fafb;
  border:        1px solid #e5e7eb;
  border-radius: 8px;
  padding:       6px;
  margin-bottom: 6px;
  transition:    all 0.2s;
}

.answer-card.correct-answer {
  background:   #ecfdf5;
  border-color: #10b981;
}

.answer-header {
  display:       flex;
  align-items:   center;
  gap:           6px;
  margin-bottom: 6px;
}

.answer-letter {
  background:    #6b7280;
  color:         white;
  font-size:     small;
  font-weight:   600;
  padding:       4px 6px;
  border-radius: 4px;
}

.correct-answer .answer-letter {
  background: #10b981;
}

.correct-checkbox {
  display:     flex;
  align-items: center;
  gap:         4px;
  cursor:      pointer;
  font-size:   small;
  color:       #374151;
  margin-left: auto;
}

.correct-checkbox input {
  width: auto;
  margin: 0;
  cursor: pointer;
}

.remove-answer-btn {
  background: #ef4444;
  color:      white;
  border:     none;
  border-radius: 4px;
  width:    16px;
  height:   16px;
  font-size: small;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.remove-answer-btn:hover {
  background: #dc2626;
}

.feedback-group {
  margin-top:  8px;
  padding:     8px;
  background:  rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  border: 1px dashed #d1d5db;
}

.feedback-group .form-group {
  margin-bottom: 8px;
}

.feedback-group .form-group:last-child {
  margin-bottom: 0;
}

.feedback-group label {
  font-size: small;
  color: #6b7280;
}

.add-answer-btn {
  background:    #6b7280;
  color:         white;
  border:        none;
  padding:       5px 10px;
  border-radius: 6px;
  font-size:     medium;
  font-weight:   500;
  cursor:        pointer;
  transition:    background-color 0.2s;
  display:       block;
  width:         100%;
}

.add-answer-btn:hover {
  background: #4b5563;
}

</style>
