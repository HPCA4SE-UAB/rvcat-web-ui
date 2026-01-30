<template>
 <div class="main">   
    <div class="header fullscreen-header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" title="Show help"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">Tutorial - <strong>{{ editedTutorialName }}</strong></span>
      </div>
   
      <div class="settings-container fullscreen-settings">
        <select v-model="editedTutorialName" title="Select Tutorial">
          <option value="" disabled>Select</option>
          <option v-for="tutorial in availableTutorials" :key="tutorial" :value="tutorial">
            {{ tutorial }}
          </option>
        </select>
        <div class="buttons">
          <button class="blue-button" title="Save current Tutorial" @click="downloadTutorial"> Download </button>
          <button class="blue-button" title="Load new Tutorial"     @click="uploadTutorial">   Upload   </button>
        </div>
        <div class="actions">
          <button @click="previewTutorial" class="btn-primary">   Preview  </button>
          <button @click="uploadTutorial"  class="btn-secondary"> Upload   </button>
          <button @click="downloadJSON"    class="btn-secondary"> Download </button>
          <button @click="finishTutorial"  class="btn-success">   Finish   </button>
        </div>
        <div class="add-buttons">
          <button @click="addStep('step')"     class="add-step-btn">    + Add Step    </button>
          <button @click="addStep('question')" class="add-question-btn">+ Add Question</button>
        </div>
      </div>
    </div>
   
    <div class="tutorial-editor">
      
    </div>
  </div>

    <div v-if="exportedContent" class="export-section">
      <h3>Generated JSON</h3>
      <textarea v-model="exportedContent" readonly></textarea>
      <p class="export-note">Save this as a .json file in public/tutorials/ and add to index.json</p>
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


  <!----
  
   <div class="tutorial-editor">
      
      <div class="editor-header">
        <div class="header-left">
          <h2>Tutorial Editor</h2>
          <span v-if="hasSavedContent" class="draft-indicator"></span>
        </div>
        <div class="header-right">
          <button v-if="hasSavedContent" @click="clearDraft" class="clear-btn" title="Clear draft and start fresh">
            Clear Draft
          </button>
          <button @click="$emit('close')" class="close-btn">&times;</button>
        </div>
      </div>
      
      <div class="editor-content">
        <div class="section">
          <div class="form-group">
            <label>Tutorial Name <span class="required">*</span></label>
            <input v-model="tutorial.name" type="text" placeholder="Enter tutorial name">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea v-model="tutorial.description" placeholder="Brief description of the tutorial"></textarea>
          </div>
        </div>

        <div class="section">
          <h3>Steps & Questions</h3>
          <div v-for="(step, index) in tutorial.steps" :key="index" class="step-card" :class="{ 'question-card': step.type === 'question' }">
            <div class="step-header">
              <span class="step-number" :class="{ 'question-number': step.type === 'question' }">{{ index + 1 }}</span>
              <div class="step-type-selector">
                <label class="type-radio">
                  <input type="radio" v-model="step.type" value="step" @change="onStepTypeChange(step)">
                  <span>Step</span>
                </label>
                <label class="type-radio">
                  <input type="radio" v-model="step.type" value="question" @change="onStepTypeChange(step)">
                  <span>Question</span>
                </label>
              </div>
              <button @click="removeStep(index)" class="remove-btn">×</button>
            </div>
            
            <div class="form-group">
              <label>Title <span class="required">*</span></label>
              <input v-model="step.title" type="text" :placeholder="step.type === 'question' ? 'Question title' : 'Step title'">
            </div>
            
            <template v-if="step.type === 'step'">
              <div class="form-group">
                <label>Description</label>
                <textarea v-model="step.description" placeholder="What happens in this step"></textarea>
              </div>
              
              <div class="form-group">
                <label>Step Image (optional)</label>
                <div class="image-upload-section">
                  <input type="file" accept="image/*" @change="(e) => handleStepImageUpload(e, step)" class="image-input">
                  <div v-if="step.stepImage" class="image-preview">
                    <img :src="step.stepImage" alt="Step image preview">
                    <button @click="step.stepImage = ''" class="remove-image-btn" type="button">× Remove</button>
                  </div>
                </div>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label>Element to Highlight <span class="required">*</span></label>
                  <select v-model="step.selectorPreset" @change="onSelectorPresetChange(step)" class="selector-preset">
                    <option v-for="opt in predefinedSelectors" :key="opt.label" :value="opt.value" :disabled="opt.disabled">
                      {{ opt.label }}
                    </option>
                  </select>
                  <input v-model="step.selector" type="text" placeholder="CSS selector (e.g., #my-button, .my-class)" class="selector-input">
                </div>
                
                <div class="form-group">
                  <label>Position</label>
                  <select v-model="step.position">
                    <option value="bottom">Bottom</option>
                    <option value="top">Top</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>
              
              <div class="form-group">
                <label>Action (optional)</label>
                <select v-model="step.action">
                  <option value="">No action</option>
                  <option value="switchTo:simulationComponent">Go to Simulation</option>
                  <option value="switchTo:staticAnalysisComponent">Go to Static Analysis</option>
                  <option value="switchTo:timelineComponent">Go to Timeline</option>
                  <option value="switchTo:processorEditorComponent">Go to Processor</option>
                  <option value="switchTo:programEditorComponent">Go to Program</option>
                  <option value="switchTo:comparisonComponent">Go to Comparison</option>
                </select>
              </div>

              <div v-if="step.validationType" class="validation-card">
                <h4>Validation</h4>
                <div class="form-group">
                  <label>Type</label>
                  <select v-model="step.validationType">
                    <option value="">No validation</option>
                    <option value="program_selected">Program selected</option>
                    <option value="architecture_selected">Architecture selected</option>
                    <option value="input_value">Exact input value</option>
                    <option value="input_value_min">Minimum input value</option>
                    <option value="button_clicked">Button clicked</option>
                  </select>
                </div>

                <div v-if="step.validationType" class="validation-details">
                  <div v-if="step.validationType === 'program_selected'" class="form-group">
                    <label>Program name</label>
                    <input v-model="step.validationValue" type="text" placeholder="rec, fact, sum, etc.">
                  </div>

                  <div v-if="step.validationType === 'architecture_selected'" class="form-group">
                    <label>Architecture name</label>
                    <input v-model="step.validationValue" type="text" placeholder="baseline, base2, ooo, etc.">
                  </div>

                  <div v-if="step.validationType === 'input_value'" class="form-group">
                    <label>Expected value</label>
                    <input v-model="step.validationValue" type="text" placeholder="128">
                  </div>

                  <div v-if="step.validationType === 'input_value' || step.validationType === 'input_value_min'" class="form-group">
                    <label>Input Field</label>
                    <select v-model="step.validationSelectorPreset" @change="onValidationSelectorPresetChange(step)" class="selector-preset">
                      <option v-for="opt in validationInputSelectors" :key="opt.label" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-model="step.validationSelector" type="text" placeholder="CSS selector for input field" class="selector-input">
                  </div>

                  <div v-if="step.validationType === 'input_value_min'" class="form-group">
                    <label>Minimum value</label>
                    <input v-model="step.validationMinValue" type="number" placeholder="100">
                  </div>

                  <div v-if="step.validationType === 'button_clicked'" class="form-group">
                    <label>Button to Click</label>
                    <select v-model="step.validationSelectorPreset" @change="onValidationSelectorPresetChange(step)" class="selector-preset">
                      <option v-for="opt in validationButtonSelectors" :key="opt.label" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-model="step.validationSelector" type="text" placeholder="CSS selector for button (e.g., #run-btn)" class="selector-input">
                  </div>

                  <div class="form-group">
                    <label>Error message</label>
                    <input v-model="step.validationMessage" type="text" placeholder="Complete this action to continue">
                  </div>
                </div>
              </div>
              
              <div v-else class="form-group">
                <label>Validation</label>
                <select v-model="step.validationType">
                  <option value="">No validation</option>
                  <option value="program_selected">Program selected</option>
                  <option value="architecture_selected">Architecture selected</option>
                  <option value="input_value">Exact input value</option>
                  <option value="input_value_min">Minimum input value</option>
                  <option value="button_clicked">Button clicked</option>
                </select>
              </div>
            </template>
            
            <template v-else-if="step.type === 'question'">
              <div class="form-group">
                <label>Question Text <span class="required">*</span></label>
                <textarea v-model="step.questionText" placeholder="Enter your question here..."></textarea>
              </div>
              
              <div class="form-group">
                <label>Question Image (optional)</label>
                <div class="image-upload-section">
                  <input type="file" accept="image/*" @change="(e) => handleImageUpload(e, step)" class="image-input">
                  <div v-if="step.questionImage" class="image-preview">
                    <img :src="step.questionImage" alt="Question image preview">
                    <button @click="step.questionImage = ''" class="remove-image-btn" type="button">× Remove</button>
                  </div>
                </div>
              </div>
              
              <div class="form-group">
                <label>Answer Mode <span class="required">*</span></label>
                <div class="answer-mode-selector">
                  <label class="mode-radio">
                    <input type="radio" v-model="step.answerMode" value="single" @change="onAnswerModeChange(step)">
                    <span>Single-choice</span>
                  </label>
                  <label class="mode-radio">
                    <input type="radio" v-model="step.answerMode" value="multiple" @change="onAnswerModeChange(step)">
                    <span>Multiple-choice</span>
                  </label>
                </div>
              </div>
              
              <div class="answers-section">
                <h4>Answers (up to 6) <span class="required">*</span> - {{ step.answerMode === 'single' ? 'Only one must be correct' : 'At least one must be correct' }}</h4>
                <div v-for="(answer, ansIndex) in step.answers" :key="ansIndex" class="answer-card" :class="{ 'correct-answer': answer.isCorrect }">
                  <div class="answer-header">
                    <span class="answer-letter">{{ String.fromCharCode(65 + ansIndex) }}</span>
                    <label class="correct-checkbox">
                      <input type="checkbox" v-model="answer.isCorrect" @change="onCorrectAnswerChange(step, ansIndex)">
                      <span>Correct</span>
                    </label>
                    <button v-if="step.answers.length > 2" @click="removeAnswer(step, ansIndex)" class="remove-answer-btn">×</button>
                  </div>
                  
                  <div class="form-group">
                    <label>Answer Text <span class="required">*</span></label>
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
                
                <button v-if="step.answers.length < 6" @click="addAnswer(step)" class="add-answer-btn">+ Add Answer</button>
              </div>
            </template>
          </div>
          
          <div class="add-buttons">
            <button @click="addStep('step')" class="add-step-btn">+ Add Step</button>
            <button @click="addStep('question')" class="add-question-btn">+ Add Question</button>
          </div>
        </div>

       </div>
   </div>
 -->

</template>

<script setup>
import { ref, reactive, watch, onMounted, computed } from 'vue'

// ============================================================================
// EMITS
// ============================================================================
const emit = defineEmits(['close', 'preview', 'tutorialFinished'])

// ============================================================================
// CONSTANTS
// ============================================================================
const STORAGE_KEY    = 'tutorial-editor-draft'
const MAX_IMAGE_SIZE = 500 * 1024 // 500KB



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
  { label: '── Configuration Inputs ──', value: '', disabled: true },
  { label: 'ROB Size Input',        value: '#rob-size' },
  { label: 'Number of Iterations',  value: '#num-iters' },
  { label: '── Buttons ──',         value: '', disabled: true },
  { label: 'Run Simulation Button', value: '#run-simulation-button' },
  { label: '── Navigation Tabs ──', value: '', disabled: true },
  { label: 'Simulation Tab',        value: 'button:contains(\"Simulation\")' },
  { label: 'Static Analysis Tab',   value: 'button:contains(\"Static Analysis\")' },
  { label: 'Timeline Tab',          value: 'button:contains(\"Timeline\")' },
  { label: 'Comparison Tab',        value: 'button:contains(\"Comparison\")' },
  { label: 'Processor Editor Tab',  value: 'button:contains(\"Processor\")' },
  { label: 'Program Editor Tab',    value: 'button:contains(\"Program\")' }
]

const validationInputSelectors = [
  { label: 'Custom',               value: '' },
  { label: 'ROB Size',             value: '#rob-size' },
  { label: 'Dispatch Width',       value: '#dispatch-width' },
  { label: 'Retire Width',         value: '#retire-width' },
  { label: 'INT latency',          value: '#INT-latency' },
  { label: 'Check of INT instructions available on Port0', value: '#Port0-INT-check' },
  { label: 'Number of Blocks in cache',  value: '#cache-blocks' },
  { label: 'Number of Iterations', value: '#simulation-iterations' }
]

const validationButtonSelectors = [
  { label: 'Custom',                         value: '' },
  { label: 'Run Simulation',                 value: '#run-simulation-button' },
  { label: 'Apply Processor Configuration',  value: '#apply-processorconfig-button' },
  { label: 'Upload Processor Configuration', value: '#upload-processorconfig-button' },
  { label: 'Download Program',               value: '#program-download-button' },
  { label: 'Upload Program',                 value: '#program-upload-button' },
  { label: 'Remove PortX',                   value: '#remove-port0-button' },
  { label: 'Add Port',                       value: '#add-port-button' }
]

// ============================================================================
// STATE
// ============================================================================
const tutorial           = reactive({ name: '', description: '', steps: [] })
const exportedContent    = ref('')
const availableTutorials = ref([])
const editedTutorialName = ref('')

// ============================================================================
// COMPUTED
// ============================================================================
const hasSavedContent = computed(() => 
  tutorial.name || tutorial.description || 
  tutorial.steps.some(s => s.title || s.description || s.selector || s.questionText)
)

// ============================================================================
// LOCAL STORAGE
// ============================================================================
const clearSavedData = () => localStorage.removeItem(STORAGE_KEY)

watch(tutorial, (t) => {
  try {
    if (t.name || t.description || t.steps.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
      console.log('👨‍🎓✅ Edited tutorial saved in localStorage', t.name)
    }
  } catch (error) {
    console.error('👨‍🎓❌ Failed to save edited tutorial in localStoraga:', error)
  }
}, { deep: true })


// ============================================================================
// STEP CREATION HELPERS
// ============================================================================
const createEmptyStep = () => ({
  type: 'step',
  title: '',
  description: '',
  stepImage: '',
  selectorPreset: '',
  selector: '',
  position: 'bottom',
  action: '',
  validationType: '',
  validationValue: '',
  validationSelectorPreset: '',
  validationSelector: '',
  validationMinValue: '',
  validationMessage: ''
})

const createEmptyQuestion = () => ({
  type: 'question',
  title: '',
  questionText: '',
  questionImage: '',
  answerMode: 'single',
  answers: [
    { text: '', isCorrect: true, explanation: '' },
    { text: '', isCorrect: false, explanation: '' }
  ]
})

const addStep = (type = 'step') => {
  tutorial.steps.push(type === 'question' ? createEmptyQuestion() : createEmptyStep())
}

// ============================================================================
// STEP TYPE & MODE CHANGES
// ============================================================================
const onStepTypeChange = (step) => {
  if (step.type === 'question') {
    step.questionText = step.questionText || ''
    step.answerMode   = step.answerMode || 'single'
    if (!step.answers?.length) {
      step.answers = [
        { text: '', isCorrect: true,  explanation: '' },
        { text: '', isCorrect: false, explanation: '' }
      ]
    }
  } else {
    step.description    = step.description || ''
    step.selector       = step.selector || ''
    step.position       = step.position || 'bottom'
    step.action         = step.action || ''
    step.validationType = step.validationType || ''
  }
}

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

const removeStep = (index) => tutorial.steps.splice(index, 1)

// ============================================================================
// IMAGE UPLOAD (unified handler)
// ============================================================================
const handleImageUpload = (event, step, imageField = 'questionImage') => {
  const file = event.target.files[0]
  if (!file) return
  
  if (file.size > MAX_IMAGE_SIZE) {
    alert('Image is too large. Please use an image smaller than 500KB.')
    event.target.value = ''
    return
  }
  
  const reader = new FileReader()
  reader.onload = (e) => { step[imageField] = e.target.result }
  reader.readAsDataURL(file)
}

const handleStepImageUpload = (event, step) => handleImageUpload(event, step, 'stepImage')

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
      type:  'question',
      title: step.title,
      questionText: step.questionText,
      answerMode:   step.answerMode,
      answers:      step.answers.filter(a => a.text).map(a => ({
        text: a.text,
        isCorrect: a.isCorrect,
        explanation: a.explanation || ''
      }))
    }
    if (step.questionImage) q.questionImage = step.questionImage
    return q
  }
  
  const s = {
    type:        'step',
    title:       step.title,
    description: step.description,
    selector:    step.selector,
    position:    step.position
  }
  if (step.stepImage) s.stepImage = step.stepImage
  if (step.action)    s.action    = step.action
  
  const validation = buildValidation(step)
  if (validation) s.validation = validation
  
  return s
}

const buildTutorialData = () => ({
  id:          tutorial.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
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
    const n = i + 1
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
// ACTIONS
// ============================================================================
const clearDraft = () => {
  if (confirm('Are you sure you want to clear the current draft? This action cannot be undone.')) {
    tutorial.name        = ''
    tutorial.description = ''
    tutorial.steps       = []
    addStep()
    clearSavedData()
  }
}

const previewTutorial = () => {
  if (!showValidationErrors()) return
  emit('preview', buildTutorialData())
}

const finishTutorial = () => {
  if (!showValidationErrors()) return
  downloadJSON()
  emit('tutorialFinished', buildTutorialData())
  clearSavedData()
  alert('Tutorial finished! It has been added to the tutorial menu.')
  emit('close')
}

const downloadJSON = () => {
  if (!showValidationErrors()) return
  
  const data = buildTutorialData()
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${data.id}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
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
      questionImage: step.questionImage || '',
      answerMode:    step.answerMode || 'single',
      answers:      (step.answers || []).map(a => ({
        text: a.text || '',
        isCorrect: a.isCorrect || false,
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
    title:       step.title || '',
    description: step.description || '',
    stepImage:   step.stepImage || '',
    selector:    step.selector || '',
    position:    step.position || 'bottom',
    action:      step.action || ''
  }
  
  if (step.validation) {
    s.validationType =     step.validation.type || ''
    s.validationMessage =  step.validation.message || ''
    s.validationValue =    step.validation.value || ''
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
      
      if (!data.name || !data.steps?.length) {
        alert('Invalid tutorial file format')
        return
      }
      
      tutorial.name        = data.name || ''
      tutorial.description = data.description || ''
      tutorial.steps       = data.steps.map(convertUploadedStep)
      
      alert('Tutorial loaded successfully!')
    } catch (err) {
      console.error('Failed to load tutorial:', err)
      alert('Failed to load tutorial file. Please check the file format.')
    }
  }
  
  document.body.appendChild(input)
  input.click()
  document.body.removeChild(input)
}

// ============================================================================
// LIFECYCLE
// ============================================================================
onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const data           = JSON.parse(saved)
      tutorial.name        = data.name || ''
      tutorial.description = data.description || ''
      tutorial.steps       = data.steps || []
      if (!tutorial.steps.length) addStep()
    } catch (err) {
      console.error('Failed to load saved tutorial:', err)
      addStep()
    }
  } else {
    addStep()
  }
})
</script>

<style scoped>

.tutorial-editor {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 900px;
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  margin: auto;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30px 30px;
  border-bottom: 1px solid #e5e7eb;
  border-radius: 12px 12px 0 0;
  background: #f9fafb;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.editor-header h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #111827;
}

.draft-indicator {
  background: #10b981;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  animation: pulse-green 2s infinite;
}

@keyframes pulse-green {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

.clear-btn {
  background: #ef4444;
  color: white;
  border: none;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.clear-btn:hover {
  background: #dc2626;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.section {
  padding: 30px 30px;
  border-bottom: 1px solid #f3f4f6;
}

.section:last-child {
  border-bottom: none;
}

.section h3 {
  margin: 0 0 24px 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  text-align: center;
}

.form-group {
  margin-bottom: 20px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 140px;
  gap: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.required {
  color: #ef4444;
  font-weight: 600;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  color: #111827;
  transition: border-color 0.2s;
  font-family: inherit;
  box-sizing: border-box;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group textarea {
  height: 90px;
  resize: vertical;
  line-height: 1.5;
}

/* Selector preset with text input combo */
.selector-preset {
  margin-bottom: 8px;
}

.selector-input {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px !important;
}

.step-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 24px 24px;
  margin-bottom: 20px;
  position: relative;
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.step-number {
  background: #3b82f6;
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  min-width: 24px;
  text-align: center;
}

.remove-btn {
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.remove-btn:hover {
  background: #dc2626;
}

.validation-card {
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 20px 20px;
  margin-top: 20px;
}

.validation-card h4 {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: #92400e;
  text-align: center;
}

.validation-details {
  margin-top: 16px;
}

.add-step-btn {
  background: #10b981;
  color: white;
  border: none;
  padding: 14px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.add-step-btn:hover {
  background: #059669;
}

.add-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
}

.add-question-btn {
  background: #8b5cf6;
  color: white;
  border: none;
  padding: 14px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.add-question-btn:hover {
  background: #7c3aed;
}

/* Step type selector */
.step-type-selector {
  display: flex;
  gap: 16px;
}

.type-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #374151;
}

.type-radio input {
  width: auto;
  margin: 0;
  cursor: pointer;
}

/* Question card styles */
.question-card {
  background: #f5f3ff;
  border-color: #8b5cf6;
}

.question-number {
  background: #8b5cf6 !important;
}

/* Answer mode selector */
.answer-mode-selector {
  display: flex;
  gap: 24px;
  margin-top: 8px;
}

.mode-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #374151;
}

.mode-radio input {
  width: auto;
  margin: 0;
  cursor: pointer;
}

/* Image upload section */
.image-upload-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.image-input {
  padding: 8px;
  border: 2px dashed #d1d5db;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.image-input:hover {
  border-color: #3b82f6;
}

.image-preview {
  position: relative;
  display: inline-block;
  max-width: 300px;
}

.image-preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.remove-image-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.remove-image-btn:hover {
  background: #dc2626;
}

/* Answers section */
.answers-section {
  margin-top: 20px;
  padding: 20px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.answers-section h4 {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.answer-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all 0.2s;
}

.answer-card.correct-answer {
  background: #ecfdf5;
  border-color: #10b981;
}

.answer-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.answer-letter {
  background: #6b7280;
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
}

.correct-answer .answer-letter {
  background: #10b981;
}

.correct-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  margin-left: auto;
}

.correct-checkbox input {
  width: auto;
  margin: 0;
  cursor: pointer;
}

.remove-answer-btn {
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  width: 20px;
  height: 20px;
  font-size: 14px;
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
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  border: 1px dashed #d1d5db;
}

.feedback-group .form-group {
  margin-bottom: 12px;
}

.feedback-group .form-group:last-child {
  margin-bottom: 0;
}

.feedback-group label {
  font-size: 12px;
  color: #6b7280;
}

.add-answer-btn {
  background: #6b7280;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
  display: block;
  width: 100%;
}

.add-answer-btn:hover {
  background: #4b5563;
}

.actions {
  padding: 30px 30px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
  display: flex;
  gap: 16px;
  border-radius: 0 0 12px 12px;
  justify-content: center;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-primary:hover {
  background: #2563eb;
}

.btn-secondary {
  background: #6b7280;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-secondary:hover {
  background: #4b5563;
}

.btn-success {
  background: #10b981;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-success:hover {
  background: #059669;
}

.export-section {
  padding: 30px 30px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

.export-section h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  text-align: center;
}

.export-section textarea {
  width: 100%;
  height: 140px;
  padding: 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  background: #f3f4f6;
  color: #374151;
  resize: vertical;
  line-height: 1.4;
  box-sizing: border-box;
}

.export-note {
  margin: 12px 0 0 0;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}
</style>
