<template>
 <div class="main">
    <div class="header fullscreen-header">
      <div class="section-title-and-info">
        <span ref="helpIcon" class="info-icon" @click="openHelp" :title="t('Show help')"><img src="/img/info.png" class="info-img"></span>
        <span class="header-title">{{ t('Tutorial  Editor') }}</span>
      </div>

      <div class="settings-container fullscreen-settings">
        <div class="buttons">
          <button class="blue-button" :title="t('Save current tutorial on your local file system')"
                @click="downloadTutorial">   {{ t('Download') }} </button>
          <button class="blue-button" :title="t('Load new tutorial from your local file system')"
                @click="uploadTutorial"> {{ t('Upload') }}   </button>
        </div>

        <div class="buttons">
          <button class="blue-button" :title="t('Clear current tutorial draft and start fresh')"
                @click="clearDraft">  {{ t('Clear Draft') }}  </button>
        </div>
      </div>
    </div>

    <div class="tutorial-editor" :class="{ 'is-order-open': isStepOrderOpen }">

      <!-- Header: Tutorial Description -->
      <div class="editor-content" :class="{ 'step-order-open': isStepOrderOpen }">
        <div class="section tutorial-header">
          <div class="form-group left-column">
            <div class="label-input-row">
              <label>{{ t('Name') }} <span class="required">*</span></label>
              <input v-model="tutorial.name" type="text" :placeholder="t('Enter tutorial name, used to identify tutorial')" :title="t('Tutorial name, used to identify tutorial')" class="name-input">
            </div>
            <label>{{ t('Description') }}</label>
            <textarea v-model="tutorial.description" :placeholder="t('Brief description of the tutorial')" :title="t('Description of the tutorial')"></textarea>
            <div class="buttons">
              <button class="blue-button" :title="t('Add new step to the tutorial (after selected step)')"
                :disabled="stepNumber >= maxSteps"
                @click="addStep('step', stepNumber)">{{ t('Add new Step') }}</button>
              <button class="blue-button" :title="t('Add new question to the tutorial (after selected step)')"
                :disabled="stepNumber >= maxSteps"
                @click="addStep('question', stepNumber)">{{ t('Add new Question') }}</button>
              <button class="blue-button" :title="t('Duplicate selected step (after the selected one)')"
                :disabled="stepNumber < 0 || stepNumber >= maxSteps"
                @click="addStep(null, stepNumber)">{{ t('Duplicate') }}</button>
            </div>
            <button v-if="tutorial.steps.length" type="button"
              class="step-order-toggle"
              :aria-expanded="isStepOrderOpen"
              aria-controls="step-order-panel"
              @click="isStepOrderOpen = !isStepOrderOpen">
              {{ isStepOrderOpen ? 'Close card order' : 'Reorder cards / questions' }}
              <span aria-hidden="true">{{ isStepOrderOpen ? '▲' : '▼' }}</span>
            </button>
          </div>
          <div class="form-group right-column">
            <div class="tutorial-img">
              <div v-html="tutorialSvg" v-if="tutorialSvg"></div>
            </div>
            <div v-if="tutorial.steps.length" class="graph-legend">
              <span style="--c: blue; --f: lightblue">{{ t('Card') }}</span>
              <span style="--c: #b58900; --f: #fff3c4">{{ t('Optional branch (2nd successor)') }}</span>
              <span style="--c: purple; --f: #ab82ff">{{ t('Question') }}</span>
              <span style="--c: transparent; --f: transparent">{{ t('Click a node to edit it') }}</span>
            </div>
          </div>
        </div>

        <section v-if="tutorial.steps.length && isStepOrderOpen" id="step-order-panel"
          class="step-order-section" aria-labelledby="step-order-title">
          <div class="step-order-heading">
            <h3 id="step-order-title">{{ t('Card order') }}</h3>
            <span>{{ t('Numbers match the graph (starting at 0). Drag a row to change order; connections stay the same.') }}</span>
          </div>
          <ol class="step-order-list">
            <li v-for="(step, index) in tutorial.steps" :key="step.id"
              class="step-order-item"
              :class="{
                'is-selected': currentStep?.id === step.id,
                'is-drop-target': dropTargetStepId === step.id
              }"
              :data-step-id="step.id"
              :aria-label="`Graph node ${index}: ${step.title || (step.type === 'question' ? 'Question' : 'Step')}. Drag to reorder, or use Alt+Arrow keys.`"
              tabindex="0"
              draggable="true"
              @click="selectStepById(step.id)"
              @keydown="handleStepOrderKeydown($event, step.id)"
              @dragstart="startStepDrag($event, step.id)"
              @dragover.prevent="dropTargetStepId = step.id"
              @drop.prevent.stop="dropStep(step.id)"
              @dragend="clearStepDrag">
              <span class="step-order-grip" aria-hidden="true">⠿</span>
              <span class="step-order-number">{{ index }}</span>
              <span class="step-order-type">{{ step.type === 'question' ? 'Question' : 'Step' }}</span>
              <span class="step-order-title">{{ step.title || '(Untitled)' }}</span>
            </li>
          </ol>
        </section>

        <!-- Card: step/question -->
        <div v-if="currentStep && !isStepOrderOpen" class="section">
          <div class="step-card" :class="{ 'question-card': currentStep.type === 'question' }">
            <div class="form-group left-column">
              <div class="form-row">
                <span class="step-number" :class="{ 'question-number': currentStep.type === 'question' }" :title="t('Remove selected step')">
                  {{ stepNumber }}
                </span>
                <div class="step-controls">
                  <button type="button" class="blue-button preview-btn" @click="previewFromCard"
                    id="tutorial-preview-button"
                    :title="t('Run this tutorial from this card, as students will see it (closing it returns to the editor)')">
                    ▶ Preview from this card
                  </button>
                  <button type="button" @click="removeStep(stepNumber)" class="remove-btn"
                    :title="t('Remove selected step')" aria-label="Remove selected step">×</button>
                </div>
              </div>
              <label>{{ t('First successor') }}</label>
              <select :value="currentStep.next?.[0] || ''" @change="setSuccessor(currentStep, 0, $event.target.value)">
                <option value="">{{ t('No successor') }}</option>
                <option value="end" :disabled="currentStep.next?.[1] === 'end'">{{ t('End Tutorial') }}</option>
                <option v-for="(step, index) in tutorial.steps" :key="step.id" :value="step.id"
                  :disabled="step.id === currentStep.id || step.id === currentStep.next?.[1]">
                  {{ index }} — {{ step.title || (step.type === 'question' ? 'Question' : 'Step') }}
                </option>
              </select>
              <input v-if="currentStep.next?.[0]" type="text" class="button-label-input"
                :value="currentStep.nextLabels?.[0] || ''"
                @input="setSuccessorLabel(currentStep, 0, $event.target.value)"
                :placeholder="`Button text (default: ${successorTitle(currentStep, 0)})`"
                :title="t('Text of the button that goes to this successor; empty = title of the target card')">
              <label>{{ t('Second successor (optional)') }}</label>
              <select :value="currentStep.next?.[1] || ''" @change="setSuccessor(currentStep, 1, $event.target.value)">
                <option value="">{{ t('No second successor') }}</option>
                <option value="end" :disabled="currentStep.next?.[0] === 'end'">{{ t('End Tutorial') }}</option>
                <option v-for="(step, index) in tutorial.steps" :key="step.id" :value="step.id"
                  :disabled="step.id === currentStep.id || step.id === currentStep.next?.[0]">
                  {{ index }} — {{ step.title || (step.type === 'question' ? 'Question' : 'Step') }}
                </option>
              </select>
              <input v-if="currentStep.next?.[1]" type="text" class="button-label-input"
                :value="currentStep.nextLabels?.[1] || ''"
                @input="setSuccessorLabel(currentStep, 1, $event.target.value)"
                :placeholder="`Button text (default: ${successorTitle(currentStep, 1)})`"
                :title="t('Text of the button that goes to this successor; empty = title of the target card')">
              <label>{{currentStep.type === 'question' ? 'Question title' : 'Step title'}}<span class="required">*</span></label>
              <input v-model="currentStep.title" type="text" :placeholder="currentStep.type === 'question' ? 'Question title' : 'Step title'">
              <label>{{ t('Description') }}</label>
              <RichTextArea v-model="currentStep.description" :placeholder="t('What the student should learn: start with the key idea in bold')" />
              <template v-if="currentStep.type === 'step'">
                <label>{{ t('Position') }}</label>
                <select v-model="currentStep.position">
                  <option value="bottom">{{ t('Bottom') }}</option>
                  <option value="top">{{ t('Top') }}</option>
                  <option value="left">{{ t('Left') }}</option>
                  <option value="right">{{ t('Right') }}</option>
                  <option value="inside-bottom">{{ t('Inside, bottom') }}</option>
                  <option value="inside-top">{{ t('Inside, top') }}</option>
                </select>
                <label>{{ t('Element to Highlight') }} <span class="required">*</span></label>
                <select v-model="currentStep.selectorPreset" @change="onSelectorPresetChange(currentStep)" class="selector-preset">
                  <option v-for="opt in predefinedSelectors" :key="opt.label" :value="opt.value" :disabled="opt.disabled">
                    {{ opt.label }}
                  </option>
                </select>
                <input v-model="currentStep.selector" type="text" :placeholder="t('CSS selector (e.g., #my-button, .my-class)')" class="selector-input">
              </template>
              <template v-if="currentStep.type === 'question'">
                <label>{{ t('Answer Mode') }} <span class="required">*</span></label>
                <div class="answer-mode-selector">
                  <label class="mode-radio">
                    <input type="radio" v-model="currentStep.answerMode" value="single" @change="onAnswerModeChange(step)">
                    <span>{{ t('Single-choice') }}</span>
                  </label>
                  <label class="mode-radio">
                    <input type="radio" v-model="currentStep.answerMode" value="multiple" @change="onAnswerModeChange(step)">
                    <span>{{ t('Multiple-choice') }}</span>
                  </label>
                  <label class="mode-radio" :title="t('The student writes a number; it is correct within the tolerance')">
                    <input type="radio" v-model="currentStep.answerMode" value="number">
                    <span>{{ t('Number') }}</span>
                  </label>
                </div>
               </template>
            </div>

            <template v-if="currentStep.type === 'step'">
              <div class="form-group">
                <label>{{ t('Action (optional)') }}</label>
                <select v-model="currentStep.action">
                  <option value="">                                 {{ t('No action') }}            </option>
                  <option value="switchTo:simulationComponent">     {{ t('Go to Simulation') }}     </option>
                  <option value="switchTo:staticAnalysisComponent"> {{ t('Go to Static Analysis') }}</option>
                  <option value="switchTo:timelineComponent">       {{ t('Go to Timeline') }}       </option>
                  <option value="switchTo:aboutComponent">          {{ t('Go to About') }}          </option>
                  <option value="switchToFull:program">             {{ t('Open Program editor') }}  </option>
                  <option value="switchToFull:tutorial">            {{ t('Open Tutorial editor') }} </option>
                </select>

              <div class="form-group">
                <label :title="t('One action per line, run when the card is shown (e.g. selectProgram:Base)')">{{ t('Actions when the card is shown (opt.)') }}</label>
                <textarea v-model="currentStep.actionsText" rows="3" class="actions-input"
                          placeholder="selectProgram:Base&#10;selectProcessor:B4&#10;setN:1000"></textarea>
                <label :title="t('One action per line, run by the ▶ Show me button of the card')">{{ t('Show me actions (opt.)') }}</label>
                <textarea v-model="currentStep.showMeText" rows="3" class="actions-input"
                          placeholder="runSimulation"></textarea>
                <details class="actions-help"><summary>{{ t('Available actions and live values') }}</summary>
                  <div v-for="[pattern, text] in TUTORIAL_ACTIONS" :key="pattern"><code>{{ pattern }}</code>: {{ t(text) }}</div>
                  <p>{{ t('Texts can show live values of the simulator as') }} <code v-pre>{{name}}</code> ({{ t('or') }} <code v-pre>{{name|2}}</code> {{ t('for 2 decimals') }}):
                    <code>{{ TUTORIAL_VALUE_NAMES.join(', ') }}</code></p>
                </details>
              </div>

                <label>{{ t('Step Image (opt.)') }}</label>
                <div class="image-upload-section">
                  <input type="file" accept="image/*" @change="(e) => handleImageUpload(e, currentStep)" class="image-input">
                  <div v-if="currentStep.image" class="image-preview">
                    <img :src="currentStep.image" alt="Image preview">
                    <button @click="currentStep.image = ''" class="remove-image-btn" type="button">{{ t('× Remove') }}</button>
                  </div>
                </div>
              </div>

              <div v-if="currentStep.validationType" class="validation-card">
                <label>{{ t('Validation') }}</label>
                <div class="form-group">
                  <label>{{ t('Type') }}</label>
                  <select v-model="currentStep.validationType">
                    <option value=""> {{ t('No validation') }} </option>
                    <option value="program_selected">  {{ t('Program selected') }}     </option>
                    <option value="architecture_selected"> {{ t('Architecture selected') }}</option>
                    <option value="input_value">    {{ t('Exact input value') }}    </option>
                    <option value="input_value_min">   {{ t('Minimum input value') }}  </option>
                    <option value="button_clicked">  {{ t('Button clicked') }}    </option>
                    <option value="simulation_done"> {{ t('Simulation run') }}    </option>
                    <option value="chain_selected">  {{ t('Latency chain selected') }} </option>
                    <option value="graph_open">      {{ t('Dependence graph open') }}  </option>
                    <option value="timeline_option"> {{ t('Timeline option on') }}     </option>
                  </select>
                </div>

                <div v-if="currentStep.validationType" class="validation-details">
                  <div v-if="currentStep.validationType === 'program_selected'" class="form-group">
                    <label>{{ t('Program name') }}</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="Base, f0, V1...">
                  </div>

                  <div v-if="currentStep.validationType === 'chain_selected'" class="form-group">
                    <label>{{ t('Variable of the chain') }}</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="sum">
                  </div>
                  <div v-if="currentStep.validationType === 'timeline_option'" class="form-group">
                    <label>{{ t('Timeline option') }}</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="critical">
                  </div>

                  <div v-if="currentStep.validationType === 'architecture_selected'" class="form-group">
                    <label>{{ t('Architecture name') }}</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="B1, B4, GC...">
                  </div>

                  <div v-if="currentStep.validationType === 'input_value'" class="form-group">
                    <label>{{ t('Expected value') }}</label>
                    <input v-model="currentStep.validationValue" type="text" placeholder="16">
                  </div>

                  <div v-if="currentStep.validationType === 'input_value' || currentStep.validationType === 'input_value_min'" class="form-group">
                    <label>{{ t('Input Field') }}</label>
                    <select v-model="currentStep.validationSelectorPreset" @change="onValidationSelectorPresetChange(currentStep)" class="selector-preset">
                      <option v-for="opt in validationInputSelectors" :key="opt.label" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-model="currentStep.validationSelector" type="text" :placeholder="t('CSS selector for input field')" class="selector-input">
                  </div>

                  <div v-if="currentStep.validationType === 'input_value_min'" class="form-group">
                    <label>{{ t('Minimum value') }}</label>
                    <input v-model="currentStep.validationMinValue" type="number" placeholder="10">
                  </div>

                  <div v-if="currentStep.validationType === 'button_clicked'" class="form-group">
                    <label>{{ t('Button to Click') }}</label>
                    <select v-model="currentStep.validationSelectorPreset" @change="onValidationSelectorPresetChange(currentStep)" class="selector-preset">
                      <option v-for="opt in validationButtonSelectors" :key="opt.label" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-model="currentStep.validationSelector" type="text" :placeholder="t('CSS selector for button (e.g., #run-btn)')" class="selector-input">
                  </div>

                  <div class="form-group">
                    <label>{{ t('Error message') }}</label>
                    <input v-model="currentStep.validationMessage" type="text" :placeholder="t('Complete this action to continue')">
                  </div>
                </div>
              </div>

              <div v-else class="form-group">
                <label>{{ t('Validation') }}</label>
                <select v-model="currentStep.validationType">
                    <option value="">                      {{ t('No validation') }}        </option>
                    <option value="program_selected">      {{ t('Program selected') }}     </option>
                    <option value="architecture_selected"> {{ t('Architecture selected') }}</option>
                    <option value="input_value">           {{ t('Exact input value') }}    </option>
                    <option value="input_value_min">       {{ t('Minimum input value') }}  </option>
                    <option value="button_clicked">        {{ t('Button clicked') }}       </option>
                    <option value="simulation_done">       {{ t('Simulation run') }}       </option>
                    <option value="chain_selected">        {{ t('Latency chain selected') }} </option>
                    <option value="graph_open">            {{ t('Dependence graph open') }}  </option>
                    <option value="timeline_option">       {{ t('Timeline option on') }}     </option>
                  </select>
              </div>
            </template>

            <template v-else-if="currentStep.type === 'question'">
              <div class="form-group left-column">
                <label>{{ t('Question text') }} <span class="required">*</span></label>
                <RichTextArea v-model="currentStep.questionText" :placeholder="t('Enter your question here...')" :title="t('Question text')" />

                <label>{{ t('Question Image (optional)') }}</label>
                <div class="image-upload-section">
                  <input type="file" accept="image/*" @change="(e) => handleImageUpload(e, currentStep)" class="image-input">
                  <div v-if="currentStep.image" class="image-preview">
                    <img :src="currentStep.image" alt="Question image preview">
                    <button @click="currentStep.image = ''" class="remove-image-btn" type="button">{{ t('× Remove') }}</button>
                  </div>
                </div>
              </div>

              <div v-if="currentStep.answerMode === 'number'" class="answers-section right-column">
                <h4>{{ t('Numeric answer') }} <span class="required">*</span></h4>
                <div class="form-group">
                  <label :title="t('A number, or a live value such as') + ' {{minTime}}'">{{ t('Correct value') }}</label>
                  <input v-model="currentStep.numericValue" type="text" placeholder="4 or {{minTime}}">
                  <label>{{ t('Tolerance (absolute, default 0.01)') }}</label>
                  <input v-model="currentStep.tolerance" type="text" placeholder="0.01">
                  <label>{{ t('Unit (opt.)') }}</label>
                  <input v-model="currentStep.numericUnit" type="text" placeholder="cycles/iter">
                  <label>{{ t('Explanation when correct') }}</label>
                  <input v-model="currentStep.numericCorrect" type="text">
                  <label>{{ t('Hint when wrong') }}</label>
                  <input v-model="currentStep.numericWrong" type="text">
                  <label :title="t('One action per line, run when the question is shown')">{{ t('Actions when the question is shown (opt.)') }}</label>
                  <textarea v-model="currentStep.actionsText" rows="2" class="actions-input"></textarea>
                </div>
              </div>

              <div v-else class="answers-section right-column">
                <h4>Answers (up to 6)
                   <span class="required">*</span>
                   - {{ currentStep.answerMode === 'single' ? 'Only one must be correct' : 'At least one must be correct' }}
                </h4>
                <div v-for="(answer, ansIndex) in currentStep.answers" :key="ansIndex" class="answer-card" :class="{ 'correct-answer': answer.isCorrect }">
                  <div class="answer-header">
                    <span class="answer-letter">{{ String.fromCharCode(65 + ansIndex) }}</span>
                    <label>{{ t('Answer Text') }} <span class="required">*</span></label>
                    <label class="correct-checkbox">
                      <input type="checkbox" v-model="answer.isCorrect" @change="onCorrectAnswerChange(currentStep, ansIndex)">
                      <span>{{ t('Correct') }}</span>
                    </label>
                    <button v-if="currentStep.answers.length > 2" @click="removeAnswer(currentStep, ansIndex)" class="remove-answer-btn">×</button>
                  </div>

                  <div class="form-group">
                    <input v-model="answer.text" type="text" :placeholder="t('Answer option...')">
                  </div>

                  <div class="feedback-group">
                    <div class="form-group">
                      <label v-if="answer.isCorrect">{{ t('✓ Explanation (shown when user selects this correct answer)') }}</label>
                      <label v-else>{{ t('✗ Explanation (shown when user selects this wrong answer)') }}</label>
                      <input v-model="answer.explanation" type="text" :placeholder="answer.isCorrect ? 'Great! This is correct because...' : 'This is incorrect because...'">
                    </div>
                  </div>
                </div>

                <button v-if="currentStep.answers.length < 6" @click="addAnswer(currentStep)" class="add-answer-btn">{{ t('+ Add Answer') }}</button>
              </div>
            </template>

          </div>
        </div>

    </div>
  </div>

  <Teleport to="body">
    <HelpComponent v-if="showHelp" :position="helpPosition"
    :text="t('help.tutorialEditor')"
    :title="t('Tutorial edition, download and upload')"
    @close="closeHelp"  />
  </Teleport>

  </div>
</template>

<script setup>
  import { t } from '@/i18n'
import { ref, computed, inject, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'
import HelpComponent                                     from '@/components/helpComponent.vue'
import RichTextArea                                      from '@/components/RichTextArea.vue'
import { TUTORIAL_ACTIONS, actionList, isKnownAction }   from '@/tutorialActions'
import { TUTORIAL_VALUE_NAMES }                          from '@/tutorialValues'
import { flattenStep, flattenTexts, restoreTexts }       from '@/i18nContent'
import {
  downloadJSON, uploadJSON, createGraphVizGraph,
  createTutorialStepId, migrateTutorialFlow, TUTORIAL_FLOW_VERSION
} from '@/common'

const simState = inject('simulationState');

// ============================================================================
// Edited Tutorial & LocalStorage
// ============================================================================

const tutorial    = reactive({ id: 'newTut', name: '', description: '', flowVersion: TUTORIAL_FLOW_VERSION, steps: [] })   // default edited
const stepNumber  = ref(0)
const tutorialSvg = ref('')
const isStepOrderOpen = ref(false)
const draggedStepId = ref(null)
const dropTargetStepId = ref(null)

const MAX_IMAGE_SIZE = 500 * 1024 // 500KB

const currentStep = computed(() =>
  stepNumber.value >= 0 && stepNumber.value < tutorial.steps.length
    ? tutorial.steps[stepNumber.value]
    : null
);
const maxSteps    = computed(() => tutorial.steps.length)

// Predefined CSS selectors for highlighting elements
const predefinedSelectors = [
  { label: 'Custom', value: '' },
  { label: '── Main Areas ──',      value: '', disabled: true },
  { label: 'Header / Title',        value: '.header-title' },
  { label: 'Program Area',          value: '.program-container' },
  { label: 'Processor Area',        value: '.processor-container' },
  { label: 'Results Area',          value: '.results' },
  { label: '── File Selection ──',  value: '', disabled: true },
  { label: 'Program Selector',      value: '#programs-list' },
  { label: 'Processor Selector',    value: '#processors-list' },
  { label: '── Processor Config ──', value: '', disabled: true },
  { label: 'Save Processor Button', value: '#save-processor-button' },
  { label: 'Simulation iterations', value: '#simulation-iterations' },
  { label: '── Buttons ──',         value: '', disabled: true },
  { label: 'Run Simulation Button', value: '#run-simulation-button' },
  { label: '── Navigation Tabs ──', value: '', disabled: true },
  { label: 'Simulation Tab',        value: '#simulation-button' },
  { label: 'Static Analysis Tab',   value: '#analysis-button' },
  { label: 'Timeline Tab',          value: '#timeline-button' },
  { label: 'Program Editor Tab',    value: '#program-button' }
]

const validationInputSelectors = [
  { label: 'Custom',               value: '' },

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

  { label: 'Open dependence graph window',    value: '#open-dependence-graph' },
  { label: 'Dependence graph (window)',       value: '#dependence-graph' },
  { label: 'Graph: non-cyclic nodes',         value: '#show-internal-dependences' },
  { label: 'Graph: latencies',                value: '#show-latency-dependences' },
  { label: 'Graph: instruction text',         value: '#show-instruction-dependences' },
  { label: 'Graph: constants & inputs',       value: '#show-full-dependences' },

  { label: 'Performance bound information',   value: '#performance-bound' },
  { label: 'Performance latency limit',       value: '#latency-limit' },
  { label: 'Performance throughput limit',    value: '#throughput-limit' },
  { label: 'Performance best limit',          value: '#best-limit' },
  { label: 'Latency bounds table',            value: '#latency-bounds' },
  { label: 'Throughput bounds table',         value: '#throughput-bounds' },

  { label: 'Main RVCAT header',               value: '#top' },
  { label: 'Processor panel',                 value: '#processor-panel' },
  { label: 'Program panel',                   value: '#program-panel' },
  { label: 'Tutorial panel',                  value: '#tutorial-panel' },
  { label: 'Right panel',                     value: '#right-panel' },
  { label: 'Tutorial activation icon',        value: '#tutorial-activation' }
]

const validationButtonSelectors = [
  { label: 'Custom',                     value: '' },
  { label: 'Set program panel',          value: '#program-button' },
  { label: 'Set tutorial panel',         value: '#tutorial-button' },
  { label: 'Set simulation panel',       value: '#simulation-button' },
  { label: 'Set analysis panel',         value: '#analysis-button' },
  { label: 'Set timeline panel',         value: '#timeline-button' },
  { label: 'Set about panel',            value: '#about-button' },
  { label: 'Run Simulation',             value: '#run-simulation-button' },
  { label: 'Save Processor Config.',     value: '#save-processor-button' },
  { label: 'Download Program',           value: '#program-download-button' },
  { label: 'Upload Program',             value: '#program-upload-button' },
  { label: 'Clear Edited Program',       value: '#clear-program-button' },
  { label: 'Toggle Instruction Operands', value: '#show-instr-operands' }
]

// ============================================================================
// STEP CREATION HELPERS
// ============================================================================
const createEmptyStep = () => ({
  id:               createTutorialStepId(),
  next:             [],
  nextLabels:       [],
  type:            'step',
  title:           '',
  description:     '',
  image:           '',
  selectorPreset:  '',
  selector:        '',
  position:        'bottom',
  action:          '',
  actionsText:     '',
  showMeText:      '',
  validationType:  '',
  validationValue: '',
  validationSelector: '',
  validationMinValue: '',
  validationMessage:  '',
  validationSelectorPreset: ''
})

const createEmptyQuestion = () => ({
  id:           createTutorialStepId(),
  next:         [],
  nextLabels:   [],
  type:          'question',
  title:         '',
  questionText:  '',
  image:         '',
  answerMode:    'single',
  actionsText:   '',
  numericValue:  '',
  tolerance:     '',
  numericUnit:   '',
  numericCorrect: '',
  numericWrong:  '',
  answers: [
    { text: '', isCorrect: true, explanation: '' },
    { text: '', isCorrect: false, explanation: '' }
  ]
})

const addStep = (type = 'step', atIndex = -1) => {
  let insertIndex= atIndex+1
  let newStep = null
  const previousStep = tutorial.steps[atIndex]
  const previousTargets = previousStep?.next?.filter(Boolean) || []

  if (!type) {  // duplicate current
    insertIndex = Math.max(0, Math.min(insertIndex-1, tutorial.steps.length - 1));
    // Create deep copy
    newStep = JSON.parse(JSON.stringify(tutorial.steps[insertIndex]));
    newStep.title = `${newStep.title} (copy)`;
    newStep.id = createTutorialStepId()
    insertIndex = insertIndex+1
  }
  else
    newStep = (type === 'question' ? createEmptyQuestion() : createEmptyStep());

  newStep.next = previousTargets
  if (previousStep)
    previousStep.next = [newStep.id]

  tutorial.steps.splice(insertIndex, 0, newStep);
  stepNumber.value = insertIndex;
  // selectNodeByIndex(stepNumber)
}

const removeStep = (index) => {
  const [removedStep] = tutorial.steps.splice(index, 1)
  if (!removedStep) return

  const replacementTargets = (removedStep.next || []).filter(targetId => targetId && targetId !== removedStep.id)
  tutorial.steps.forEach(step => {
    const updatedTargets = []
    for (const targetId of step.next || []) {
      const replacements = targetId === removedStep.id ? replacementTargets : [targetId]
      for (const replacement of replacements) {
        if (replacement && replacement !== step.id && !updatedTargets.includes(replacement))
          updatedTargets.push(replacement)
      }
    }
    step.next = updatedTargets.slice(0, 2)
  })
  stepNumber.value = index-1;
}

const selectStepById = (stepId) => {
  const index = tutorial.steps.findIndex(step => step.id === stepId)
  if (index !== -1) stepNumber.value = index
}

const moveStepTo = (stepId, targetIndex) => {
  const sourceIndex = tutorial.steps.findIndex(step => step.id === stepId)
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= tutorial.steps.length) return

  const selectedStepId = currentStep.value?.id
  const [step] = tutorial.steps.splice(sourceIndex, 1)
  tutorial.steps.splice(targetIndex, 0, step)
  selectStepById(selectedStepId)
}

const startStepDrag = (event, stepId) => {
  draggedStepId.value = stepId
  dropTargetStepId.value = stepId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', stepId)
}

const dropStep = (targetStepId) => {
  const sourceIndex = tutorial.steps.findIndex(step => step.id === draggedStepId.value)
  const targetIndex = tutorial.steps.findIndex(step => step.id === targetStepId)
  if (sourceIndex !== -1 && targetIndex !== -1)
    moveStepTo(draggedStepId.value, targetIndex - (sourceIndex < targetIndex ? 1 : 0))
  clearStepDrag()
}

const clearStepDrag = () => {
  draggedStepId.value = null
  dropTargetStepId.value = null
}

const handleStepOrderKeydown = (event, stepId) => {
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    const index = tutorial.steps.findIndex(step => step.id === stepId)
    const targetIndex = index + (event.key === 'ArrowUp' ? -1 : 1)
    moveStepTo(stepId, targetIndex)
    nextTick(() => {
      Array.from(document.querySelectorAll('.step-order-item'))
        .find(item => item.getAttribute('data-step-id') === stepId)
        ?.focus()
    })
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectStepById(stepId)
  }
}

const setSuccessor = (step, slot, targetId) => {
  // successors and their optional button texts move together
  const pairs = [0, 1].map(i => ({ id: step.next?.[i] || '', label: step.nextLabels?.[i] || '' }))
  pairs[slot].id = targetId
  if (!targetId) pairs[slot].label = ''
  const kept = pairs.filter(p => p.id)
  step.next       = kept.map(p => p.id)
  step.nextLabels = kept.map(p => p.label)
}

const setSuccessorLabel = (step, slot, label) => {
  const labels = [...(step.nextLabels || [])]
  while (labels.length <= slot) labels.push('')
  labels[slot] = label
  step.nextLabels = labels.slice(0, (step.next || []).length)
}

// Title of the card a successor slot points to (default button text)
const successorTitle = (step, slot) => {
  const id = step.next?.[slot]
  if (!id) return ''
  if (id === 'end') return 'End Tutorial'
  return tutorial.steps.find(s => s.id === id)?.title || ''
}

// Exported only when some button has its own text
const exportLabels = (step) => {
  const labels = (step.nextLabels || []).slice(0, (step.next || []).length).map(l => (l || '').trim())
  return labels.some(Boolean) ? labels : null
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
    alert(t('Image is too large. Please use an image smaller than 500KB.'))
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
    case 'chain_selected':
    case 'timeline_option':
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

const convertStepForExport = (step) => restoreTexts(convertStepTexts(step), step._i18n, step._i18nLang)

const convertStepTexts = (step) => {
  if (step.type === 'question') {
    const q = {
      id:           step.id,
      next:         (step.next || []).filter(Boolean),
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
    if (exportLabels(step)) q.nextLabels = exportLabels(step)
    if (actionList(step.actionsText).length) q.actions = actionList(step.actionsText)
    if (step.answerMode === 'number') {
      q.answers = []
      const value = String(step.numericValue ?? '').trim()
      q.numericValue = value.includes('{{') ? value : Number(value)
      if (String(step.tolerance ?? '').trim() !== '') q.tolerance = Number(step.tolerance)
      for (const key of ['numericUnit', 'numericCorrect', 'numericWrong'])
        if (step[key]) q[key] = step[key]
    }
    return q
  }

  const s = {
    id:          step.id,
    next:        (step.next || []).filter(Boolean),
    type:        'step',
    title:       step.title,
    description: step.description,
    selector:    step.selector,
    position:    step.position
  }
  if (step.anchor)  s.anchor = step.anchor
  if (step.image)   s.image  = step.image
  if (step.action)  s.action = step.action
  if (actionList(step.actionsText).length) s.actions = actionList(step.actionsText)
  if (actionList(step.showMeText).length)  s.showMe  = actionList(step.showMeText)
  if (exportLabels(step)) s.nextLabels = exportLabels(step)

  const validation = buildValidation(step)
  if (validation)
    s.validation = validation

  return s
}

const buildTutorialData = () => restoreTexts({
  flowVersion: TUTORIAL_FLOW_VERSION,
  name:        tutorial.name,
  description: tutorial.description,
  steps:       tutorial.steps.map(convertStepForExport)
}, tutorial._i18n, tutorial._i18nLang)

// ============================================================================
// VALIDATION
// ============================================================================
const validateTutorial = () => {
  const errors = []

  if (!tutorial.name?.trim())         errors.push(t('• Tutorial Name is required'))
  if (!tutorial.steps.length)         errors.push(t('• At least one step or question is required'))

  tutorial.steps.forEach((step, i) => {
    const n = i
    if (!step.title?.trim())          errors.push(t('• Step {1}: Title is required', { 1: n }))
    const unknown = [...actionList(step.actionsText), ...actionList(step.showMeText)].filter(a => !isKnownAction(a))
    if (unknown.length)               errors.push(t('• Step {1}: unknown action {2}', { 1: n, 2: unknown.join(', ') }))

    const successors = (step.next || []).filter(Boolean)
    if (successors.length > 2)         errors.push(t('• Step {1}: At most 2 successors are allowed', { 1: n }))
    if (new Set(successors).size !== successors.length)
                                      errors.push(t('• Step {1}: Successors must be different', { 1: n }))
    if (successors.includes(step.id)) errors.push(t('• Step {1}: A card cannot link to itself', { 1: n }))
    successors.forEach(targetId => {
      if (targetId !== 'end' && !tutorial.steps.some(target => target.id === targetId))
                                      errors.push(t('• Step {1}: Successor does not exist', { 1: n }))
    })

    if (step.type === 'question') {
      if (!step.questionText?.trim()) errors.push(t('• Step {1}: Question Text is required', { 1: n }))
      if (!step.answerMode)           errors.push(t('• Step {1}: Answer Mode is required', { 1: n }))
      if (step.answerMode === 'number') {
        if (String(step.numericValue ?? '').trim() === '')
                                      errors.push(t('• Step {1}: the correct value of the numeric question is required', { 1: n }))
        return
      }

      const validAnswers = step.answers?.filter(a => a.text?.trim()) || []
      if (validAnswers.length < 2)    errors.push(t('• Step {1}: At least 2 answers with text are required', { 1: n }))

      const correctAnswers = step.answers?.filter(a => a.isCorrect && a.text?.trim()) || []
      if (step.answerMode === 'single' && correctAnswers.length !== 1) {
                                      errors.push(t('• Step {1}: Single-choice mode requires exactly one correct answer', { 1: n }))
      } else if (correctAnswers.length === 0) {
                                      errors.push(t('• Step {1}: At least one answer must be marked as correct', { 1: n }))
      }
    } else if (!step.selector?.trim()) {
                                      errors.push(t('• Step {1}: CSS Selector is required', { 1: n }))
    }
  })

  return errors
}

// ============================================================================
// HELP
// ============================================================================
  const showHelp     = ref(false)
  const helpPosition = ref({ top: '0%', left: '40%' })
  const helpIcon     = ref(null)

  function openHelp()  { nextTick(() => { showHelp.value = true }) }
  function closeHelp() { showHelp.value  = false }


// ============================================================================
// TUTORIAL ACTIONS: loadEditedTutorial, clearDraft
//                   downloadTutorial, uploadTutorial, removeTutorial
// ============================================================================

function loadEditedTutorial() {
  const stored = localStorage.getItem('tutorialTemp');
  if (!stored) {
    clearDraft(false)
    console.log('🎓🔄 Reloading edited tutorial with clear draft.')
    return
  }
  try {
    const data = JSON.parse(stored);
    const normalized = migrateTutorialFlow(data)
    tutorial.name        = normalized.name        || ''
    tutorial.description = normalized.description || ''
    tutorial._i18n       = data._i18n
    tutorial._i18nLang   = data._i18nLang
    tutorial.flowVersion = normalized.flowVersion
    tutorial.steps       = normalized.steps
    stepNumber.value     = 0
    console.log('🎓🔄 Reloading Edited tutorial with existing draft')
    // selectNodeByIndex(0)
  } catch (e) {
    console.error('📄❌ Failed to load edited tutorial from localStorage:', e);
  }
}

const clearDraft = (check = true) => {
  if ( !check || confirm(t('Are you sure you want to clear the current draft? This action cannot be undone.')) ) {
    tutorial.name        = ''
    tutorial.description = ''
    tutorial._i18n       = undefined
    tutorial.flowVersion = TUTORIAL_FLOW_VERSION
    tutorial.steps       = []
    stepNumber.value     = -1
  }
}

const downloadTutorial = () => {
  const errors = validateTutorial()
  if (errors.length) {
    alert(errors.join('\n'))
    return
  }

  const tutorialData = buildTutorialData();
  downloadJSON(tutorialData, 'tempTut', 'tutorial');
};

// Loads a tutorial (file format) into the editor draft
const importTutorialData = (data) => {
  try {
    const head = flattenTexts({ name: data.name, description: data.description }, ['name', 'description'])
    const converted = { ...data, steps: data.steps.map(convertUploadedStep) }
    const normalized = migrateTutorialFlow(converted)
    tutorial.name        = head.flat.name         || ''
    tutorial.description = head.flat.description  || ''
    tutorial._i18n       = head.i18n
    tutorial._i18nLang   = head.lang
    tutorial.flowVersion = normalized.flowVersion
    tutorial.steps       = normalized.steps
    stepNumber.value     = 0
  } catch (error) {
    console.error('🎓❌ Failed to import tutorial flow:', error)
    alert(t('Could not load tutorial: {1}', { 1: error.message }))
  }
}

const uploadTutorial = () => {
  uploadJSON(importTutorialData, 'tutorial');
};

// ✎ in the tutorial menu: load that tutorial into the editor
watch(() => simState.tutorialToEdit?.nonce, (nonce) => {
  if (!nonce) return
  const id = simState.tutorialToEdit.id
  try {
    const data = JSON.parse(localStorage.getItem(`tutorial.${id}`))
    if (tutorial.steps.length &&
        !confirm(t('Replace the current draft ("{1}") with the tutorial "{2}"?', { 1: tutorial.name || 'untitled', 2: data.name })))
      return
    importTutorialData(data)
  } catch (error) {
    alert(t('Could not open tutorial "{1}": {2}', { 1: id, 2: error.message }))
  }
})

// ▶ Preview: run the draft in the tutorial engine, starting at the selected card
const previewFromCard = () => {
  if (!currentStep.value) return
  try {
    localStorage.setItem('tutorialPreview', JSON.stringify(buildTutorialData()))
    simState.tutorialPreview = { stepId: currentStep.value.id, nonce: Date.now() }
  } catch (error) {
    alert(t('Cannot preview: {1}', { 1: error.message }))
  }
}

// ============================================================================
// Utilities: convertUploadedStep, processTutorialUpdate
// ============================================================================

// Multilingual texts ({ en, es, ca }) are edited in the current language (restored when exporting)
const convertUploadedStep = (source) => {
  const { flat, i18n, lang } = flattenStep(source)
  const step = convertUploadedTexts(flat)
  if (Object.keys(i18n).length) { step._i18n = i18n; step._i18nLang = lang }
  return step
}

const convertUploadedTexts = (step) => {
  if (step.type === 'question') {
    const q = {
      id:            step.id,
      next:          step.next,
      nextLabels:    step.nextLabels || [],
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
    q.actionsText    = actionList(step.actions).join('\n')
    q.numericValue   = step.numericValue ?? ''
    q.tolerance      = step.tolerance ?? ''
    q.numericUnit    = step.numericUnit || ''
    q.numericCorrect = step.numericCorrect || ''
    q.numericWrong   = step.numericWrong || ''
    while (q.answers.length < 2) {
      q.answers.push({ text: '', isCorrect: false, explanation: '' })
    }
    if (!q.answers.some(a => a.isCorrect)) q.answers[0].isCorrect = true
    return q
  }

  const s = {
    ...createEmptyStep(),
    id:          step.id,
    next:        step.next,
    nextLabels:  step.nextLabels || [],
    title:       step.title       || '',
    description: step.description || '',
    image:       step.image       || '',
    selector:    step.selector    || '',
    position:    step.position    || 'bottom',
    anchor:      step.anchor      || '',
    action:      step.action      || '',
    actionsText: actionList(step.actions).join('\n'),
    showMeText:  actionList(step.showMe).join('\n')
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

let graphRenderRequest = 0

async function processTutorialUpdate(t) {
  try {
    localStorage.setItem('tutorialTemp', JSON.stringify(t));
    console.log('🎓📥 Edited tutorial saved in localStorage', t.name);

    await updateTutorialGraph(t, stepNumber.value)
  } catch (error) {
    console.error('🎓❌ Failed to save edited tutorial in localStorage and update tutorial view:', error);
  }
}

async function updateTutorialGraph(t, selectedIndex) {
  const renderRequest = ++graphRenderRequest
  const dotCode = generateTutorialDot(t, selectedIndex)
  const svg = await createGraphVizGraph(dotCode)
  // keep the natural size (readable titles); the container scrolls horizontally if needed
  const vb = svg.viewBox?.baseVal
  if (vb?.width) svg.style.minWidth = `${Math.round(vb.width * 0.9)}px`

  if (renderRequest === graphRenderRequest)
    tutorialSvg.value = svg.outerHTML
}

// ============================================================================
// GRAPH: generateTutorialDot
// ============================================================================
function generateTutorialDot(tut) {   // the selected node is highlighted on the SVG
  const num_steps = tut.steps.length
  const indexById = new Map(tut.steps.map((step, index) => [step.id, index]))
  let dot_code = `
digraph "Tutorial Graph" {
  rankdir=LR; splines=spline; newrank=true;
  subgraph cluster_0 {
   style="filled,rounded"; color=grey; tooltip="Tutorial flow-graph"; fillcolor=lightgrey;
   node [style=filled,margin="0.05,0.05", fontname="courier", URL="javascript:void(0)"];
`
  // Optional cards: reached as the second successor of some card (e.g. "In depth" branches)
  const optional = new Set(tut.steps.map(s => s.next?.[1]).filter(id => id && id !== 'end'))
  for (let i = 0; i < num_steps; i++) {
    const step  = tut.steps[i]
    const type  = step.type
    const title = step.title || `(untitled ${type})`
    let color = "blue", fill = "lightblue", kind = "step"
    if (type !== "step") {
      color = "purple"; fill = "mediumpurple1"; kind = "question"
    } else if (optional.has(step.id)) {
      color = '"#b58900"'; fill = '"#fff3c4"'; kind = "optional branch"
    }
    const label = `${i}\\n${wrapDotLabel(title)}`
    dot_code += `    a${i} [id="${getGraphNodeId(step.id)}", shape=box, style="rounded,filled", color=${color}, fillcolor=${fill}, label="${label}",
                            tooltip="${escapeDotString(`${i} (${kind}): ${title}`)}"]\n`
  }
  dot_code += `
  }
`
  for (let i = 0; i < num_steps; i++) {
    for (const targetId of (tut.steps[i].next || []).filter(Boolean)) {
      if (targetId === 'end') {
        dot_code += `  a${i} -> end\n`
        continue
      }
      const targetIndex = indexById.get(targetId)
      if (targetIndex !== undefined)
        dot_code += `  a${i} -> a${targetIndex}\n`
    }
  }
  if (tut.steps.some(step => step.next?.includes('end')))
    dot_code += '  end [id="tutorial-end", shape=doublecircle, label="End Tutorial"]\n'
  return dot_code + `
  }`
}

function getGraphNodeId(stepId) {
  const encodedId = Array.from(String(stepId), char => char.codePointAt(0).toString(16)).join('-')
  return `tutorial-step-${encodedId}`
}

// Title of a graph node: at most 2 lines of 16 characters (escaped for DOT)
function wrapDotLabel(text, width = 16, maxLines = 2) {
  const words = String(text).replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word }
    else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, width - 1) + '…'
  }
  return lines.map(l => escapeDotString(l.length > width ? l.slice(0, width - 1) + '…' : l)).join('\\n')
}

function escapeDotString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
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

watch(stepNumber, (index) => {
  updateTutorialGraph(tutorial, index).catch((error) => {
    console.error('🎓❌ Failed to update tutorial graph for selected step:', error);
  });
});

// Watch for changes on Simulation state
watch(() => simState.state, (newValue) => {
  if (newValue == 3) { // Initialization Stage
    simState.state = 4;   // Signal tutorial engine to obtain list of tutorials from localStorage
    console.log('🎓📥 Initialization step (4): tutorial editor')
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

    // Resolve nodes by their explicit SVG ids; Graphviz's DOM order can differ from step order.
    const nodes = svgElement.querySelectorAll('g.node');
    nodes.forEach((node) => {
      node.style.cursor = 'pointer';

      const handleClick = (event) => {
        event.stopPropagation();
        const nodeId = node.getAttribute('id')
        const stepN = nodeId === 'tutorial-end'
          ? -1
          : tutorial.steps.findIndex(step => getGraphNodeId(step.id) === nodeId)
        if (stepN === -1 && nodeId !== 'tutorial-end') return

        console.log('🎓 Selected step:', stepN);

        // 1. DESELECT previous node
        if (lastSelectedNode && lastSelectedNode !== node) {
          resetNodeStyle(lastSelectedNode);
        }

        // 2. SELECT new node
        highlightNodeAsSelected(node);

        // 3. Update State
        lastSelectedNode = node;
        stepNumber.value = stepN;
        selectNodeByIndex(stepN)
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
    });

    selectNodeByIndex(stepNumber.value)
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
  const nodeId = index === -1 ? 'tutorial-end' : getGraphNodeId(tutorial.steps[index]?.id)
  const node = Array.from(nodes).find(candidate => candidate.getAttribute('id') === nodeId)
  if (node) {

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
  addClickListenersToSvg()
  loadEditedTutorial()
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
    margin:         auto;
  }

  .tutorial-editor.is-order-open {
    height: calc(100vh - 64px);
    height: calc(100dvh - 64px);
    min-height: 0;
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
    display:    flex;
    flex:       1;
    overflow-y: auto;
    padding:    0;
    flex-direction: column;
    max-height:     2000px;
  }

  .editor-content.step-order-open {
    height: 100%;
    max-height: none;
    min-height: 0;
    overflow: hidden;
  }

  .editor-content.step-order-open > .tutorial-header {
    flex: 0 0 auto;
  }

  .step-order-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    margin-top: 6px;
    padding: 7px 10px;
    border: 1px solid #9ca3af;
    border-radius: 6px;
    background: #f3f4f6;
    color: #1f2937;
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
  }

  .step-order-toggle:hover {
    border-color: #2563eb;
    background: #eff6ff;
  }

  .section {
    flex: 1;
    overflow-y:    auto;
    min-height:    0; /* Importante para flex + overflow */
    padding:       10px 10px;
    border-bottom: 1px solid #f3f4f6;
  }

  .section:last-child {
    border-bottom: none;
  }

  .step-order-section {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding: 10px;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }

  .step-order-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    margin-bottom: 6px;
  }

  .step-order-heading h3 {
    margin: 0;
    color: #374151;
    font-size: 0.95rem;
  }

  .step-order-heading span {
    color: #6b7280;
    font-size: 0.8rem;
  }

  .step-order-list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 0 4px 0 0;
    list-style: none;
  }

  .step-order-item {
    display: grid;
    grid-template-columns: 18px 28px 72px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 3px 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
    color: #374151;
    cursor: grab;
    user-select: none;
  }

  .step-order-item:active {
    cursor: grabbing;
  }

  .step-order-item:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 1px;
  }

  .step-order-item.is-selected {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 0 0 1px #2563eb;
  }

  .step-order-item.is-drop-target {
    border-top: 3px solid #f59e0b;
  }

  .step-order-grip {
    color: #6b7280;
    font-size: 1.1rem;
    text-align: center;
  }

  .step-order-number {
    color: #6b7280;
    font-size: 0.8rem;
    text-align: right;
  }

  .step-order-type {
    color: #6b7280;
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  .step-order-title {
    overflow: hidden;
    font-size: 0.88rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tutorial-header {
    display:     flex;
    gap:         10px;
    align-items: flex-start;
    min-height:  120px; /* Altura mínima para la sección */
    position:    relative;
  }

  .tutorial-header > .left-column {
    flex: 0 0 calc(25% - 2.5px);
  }

  .left-column {
    flex:      1;      /* 1/4 del espacio disponible */
    min-width: 0; /* Evita que crezca más de lo necesario */
  }

  .right-column {
    flex:       3;          /* 3/4 del espacio disponible */
    min-width:  0;
    box-sizing: border-box; /* Incluye padding y border en el cálculo */
    display:    flex;
    padding:    2px;
    flex-direction: column;
    border:        1px solid #ddd;
    background:    #f8f9fa;
    border-radius: 8px;

    overflow: hidden; /* Oculta cualquier desbordamiento */
    position: relative; /* Para el posicionamiento interno */
  }

  .tutorial-header > .right-column {
    flex: 0 0 auto;
    position: absolute;
    top: 10px;
    right: 0;
    bottom: 10px;
    width: calc(75% - 7.5px);
    min-height: 0;
  }

 .tutorial-img {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-width: 0;
    min-height: 0;
    margin: 0;
    transform-box: fill-box;
    overflow-x: auto;     /* graph keeps a readable size: scroll when it does not fit */
  }

  .tutorial-img > div {
    display: flex;
    flex: 1 1 0;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    align-items: center;
    justify-content: safe center;
  }

  .graph-legend {
    display:     flex;
    flex-wrap:   wrap;
    gap:         4px 14px;
    font-size:   0.8em;
    color:       #555;
    padding:     2px 4px;
  }
  .graph-legend span::before {
    content:       '';
    display:       inline-block;
    width:         10px;
    height:        10px;
    margin-right:  4px;
    border-radius: 3px;
    vertical-align: -1px;
    border:        1px solid var(--c);
    background:    var(--f);
  }

  .tutorial-img svg[viewBox] {
    display: block;
    width:    100%;
    height:   100%;
    min-width: 0;
    min-height: 0;
    object-fit: contain;
    overflow: visible;
  }

  .tutorial-img svg text {
    font-size:   small;
    font-family: Arial, sans-serif;
  }
  .tutorial-img svg polygon,
  .tutorial-img svg path {
    stroke-width: 2px !important;
  }

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
    margin-bottom: 8px;
    padding-right: 10px;
  }

  .form-row {
    display:               grid;
    grid-template-columns: 1fr auto;
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
    padding:       1px 6px;
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

  .step-controls {
    display:         flex;
    justify-content: flex-end;
    gap:             4px;
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
    padding:       3px;
    margin-bottom: 3px;
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
    margin-bottom: 2px;
  }

  .answer-letter {
    background:    #6b7280;
    color:         white;
    font-size:     small;
    font-weight:   600;
    padding:       2px 4px;
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
    margin-top:  2px;
    padding:     2px;
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
    padding:       2px 10px;
    border-radius: 6px;
    font-size:     medium;
    font-weight:   500;
    cursor:        pointer;
    transition:    background-color 0.2s;
    display:       block;
    width:         100%;
    margin-bottom: 20px;
  }

  .add-answer-btn:hover {
    background: #4b5563;
  }


  .actions-input { width: 100%; font-family: monospace; font-size: 0.9em; box-sizing: border-box; }
  .actions-help { font-size: 0.85em; color: #444; margin-top: 0.3em; }
  .actions-help code { background: #f3f4f6; padding: 0 3px; border-radius: 3px; }

</style>
