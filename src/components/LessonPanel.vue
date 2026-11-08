<script setup>
  import { t, localized } from '@/i18n'
  // Lessons: menu (load a lesson file, start, export a self-contained copy, remove), the bar of
  // the lesson in progress (student, tasks, completion code, exit) and their dialogs.
  import { ref, computed, inject, watch, nextTick, onMounted } from 'vue'
  import { validateLesson, normalizeLocks, lessonResources, exportLesson, lessonTasks,
           completionCode, validStudentId, normalizeId } from '@/lessons'
  import { createActionRunner }                         from '@/tutorialActions'
  import { clearSnapshot }                              from '@/tutorialActions'
  import { processorDraftFrom, processorSignature }     from '@/editDrafts'
  import { downloadJSON }                               from '@/common'

  const simState = inject('simulationState')
  const props = defineProps({ activeView: { type: String, default: 'simulationComponent' } })
  const emit  = defineEmits(['requestSwitchPanel'])

  const INDEX_KEY   = 'lessonIndex'
  const SESSION_KEY = 'lessonSession'
  const lessonKey   = (id) => `lesson.${id}`
  const progressKey = (id, student) => `lessonProgress.${id}.${normalizeId(student)}`

  const read  = (key) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } }
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) { console.error('📘❌', e) } }

  // resources stored by RVCAT: program.NAME, processor.NAME, tutorial.NAME
  const storage = { get: (type, name) => read(`${type}.${name}`) }

  const lessons   = ref(read(INDEX_KEY) ?? [])        // [{ id, title, description }]
  const showMenu  = ref(false)
  const message   = ref('')
  const fileInput = ref(null)
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  const runActions = createActionRunner({ simState, switchPanel: (name) => emit('requestSwitchPanel', name) })

// ---- Loading, exporting and removing lessons ----
  function pickFile() { message.value = ''; fileInput.value?.click() }

  async function loadFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    let lesson
    try { lesson = JSON.parse(await file.text()) } catch { message.value = t('{f} is not a JSON file', { f: file.name }); return }
    const errors = validateLesson(lesson)
    const missing = errors.length ? [] : lessonResources(lesson, storage).missing
    if (errors.length || missing.length) {
      message.value = [...errors, ...missing.map(m => t('{m} is not in this RVCAT (embed it in the lesson)', { m }))].join('; ')
      return
    }
    write(lessonKey(lesson.lesson), lesson)
    lessons.value = [...lessons.value.filter(l => l.id !== lesson.lesson),
                     { id: lesson.lesson, title: lesson.title, description: lesson.description ?? '' }]
    write(INDEX_KEY, lessons.value)
    message.value = t('Lesson "{title}" loaded', { title: localized(lesson.title) })
  }

  async function exportSelfContained(id) {
    try {
      await downloadJSON(exportLesson(read(lessonKey(id)), storage), `${id}`, 'lesson')
    } catch (e) { message.value = e.message }
  }

  function removeLesson(id) {
    localStorage.removeItem(lessonKey(id))
    lessons.value = lessons.value.filter(l => l.id !== id)
    write(INDEX_KEY, lessons.value)
  }

// ---- Starting a lesson: the student writes the identifier assigned by the teacher ----
  const startingId = ref(null)                 // lesson waiting for the student identifier
  const studentId  = ref('')
  const startingLesson = computed(() => startingId.value ? read(lessonKey(startingId.value)) : null)
  const idLabel    = computed(() => localized(startingLesson.value?.completion?.idLabel) ?? t('Student ID'))
  const idError    = computed(() => {
    const c = startingLesson.value?.completion
    if (!c) return ''
    if (!studentId.value.trim()) return t('Write your {label}', { label: idLabel.value })
    return validStudentId(studentId.value, c.idPattern) ? '' : t('This is not a valid {label}', { label: idLabel.value })
  })

  function askStart(id) {
    showMenu.value = false
    startingId.value = id
    studentId.value = ''
    if (!read(lessonKey(id))?.completion) confirmStart()   // no completion code: no identifier
  }

  async function confirmStart() {
    if (idError.value) return
    const id = startingId.value
    const lesson = read(lessonKey(id))
    const label = idLabel.value                   // before closing the dialog (it depends on it)
    startingId.value = null
    if (!lesson) return
    const res = lessonResources(lesson, storage)
    if (res.missing.length) { message.value = t('Not found: {list}', { list: res.missing.join(', ') }); showMenu.value = true; return }

    // embedded resources replace stored ones with the same name until the lesson ends
    const backup = {}
    const install = (type, name, data) => {
      const key = `${type}.${name}`
      if (!(key in backup)) backup[key] = localStorage.getItem(key)
      localStorage.setItem(key, JSON.stringify({ ...data, name: type === 'tutorial' ? data.name : name }))
    }
    for (const r of res.programs)   if (r.embedded) install('program', r.name, r.data)
    for (const r of res.processors) if (r.embedded) install('processor', r.name, r.data)
    const tutorialId = res.tutorial.name
    if (res.tutorial.embedded) install('tutorial', tutorialId, res.tutorial.data)

    const snapshot = {
      program:   simState.simulatedProcess?.name ?? '',
      processor: simState.processorName ?? '',
      N:         document.querySelector('#program-iterations')?.value ?? '',
      settings:  { ...simState.simulationSettings },
      view:      props.activeView,
      processorConfig: processorDraftFrom(simState.simulatedProcess),
    }
    const student = lesson.completion ? studentId.value.trim() : ''
    simState.lesson = {
      id, title: lesson.title, studentId: student, idLabel: label,
      programs:   res.programs.map(r => r.name),
      processors: res.processors.map(r => r.name),
      tutorial:   tutorialId,
      locks:      normalizeLocks(lesson.locks),
      tasks:      lessonTasks(res.tutorial.data),
      done:       read(progressKey(id, student)) ?? {},
      extraPrograms: [],
      hasCompletion: !!lesson.completion,
    }
    write(SESSION_KEY, { backup, snapshot })
    await nextTick()

    const start = lesson.start ?? {}
    simState.reloadNonce = Date.now()             // stored versions may have been replaced
    await sleep(300)
    await runActions([
      `selectProcessor:${start.processor ?? res.processors[0].name}`,
      `selectProgram:${start.program ?? res.programs[0].name}`,
      ...(start.N ? [`setN:${start.N}`] : []),
    ])
    simState.lessonTutorial = { id: tutorialId, action: 'start', nonce: Date.now() }
  }

// ---- The lesson in progress ----
  const lesson    = computed(() => simState.lesson)
  const doneCount = computed(() => (lesson.value?.tasks ?? []).filter(t => lesson.value.done?.[t]).length)
  const completed = computed(() => !!lesson.value && doneCount.value === lesson.value.tasks.length)
  const code = computed(() => {
    if (!completed.value || !lesson.value.hasCompletion) return ''
    const secret = read(lessonKey(lesson.value.id))?.completion?.secret
    return secret ? completionCode(lesson.value.id, lesson.value.studentId, secret) : ''
  })
  const copied = ref(false)
  async function copyCode() {
    try { await navigator.clipboard.writeText(code.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) }
    catch { /* the code is shown anyway */ }
  }

  // the lesson and its progress survive a reload of the page
  watch(lesson, (l) => {
    if (!l) return
    const session = read(SESSION_KEY) ?? {}
    write(SESSION_KEY, { ...session, state: l })
    write(progressKey(l.id, l.studentId), l.done ?? {})
  }, { deep: true })

  onMounted(() => {
    const session = read(SESSION_KEY)
    if (session?.state && !simState.lesson) simState.lesson = session.state
  })

// ---- Exit: confirmation, then everything returns to its state before the lesson ----
  const askExit = ref(false)
  async function exitLesson() {
    askExit.value = false
    const session = read(SESSION_KEY) ?? {}
    clearSnapshot()                                   // the lesson restores, not its tutorial
    simState.lessonTutorial = { action: 'stop', nonce: Date.now() }
    await sleep(500)
    for (const [key, value] of Object.entries(session.backup ?? {})) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    simState.lesson = null
    simState.lessonAllow = []
    localStorage.removeItem(SESSION_KEY)
    await nextTick()
    simState.reloadNonce = Date.now()
    await sleep(300)
    const snap = session.snapshot
    if (!snap) return
    await runActions([`selectProcessor:${snap.processor}`])
    if (snap.processorConfig && processorSignature(simState.simulatedProcess) !== processorSignature(snap.processorConfig)) {
      const config = JSON.parse(JSON.stringify(snap.processorConfig))
      delete config.name
      Object.assign(simState.simulatedProcess, config)
    }
    await runActions([`selectProgram:${snap.program}`, ...(snap.N ? [`setN:${snap.N}`] : [])])
    if (snap.settings) Object.assign(simState.simulationSettings, snap.settings)
    if (snap.view) emit('requestSwitchPanel', snap.view)
  }

  function restartTutorial() {
    simState.lessonTutorial = { id: lesson.value.tutorial, action: 'start', nonce: Date.now() }
  }
</script>

<template>
  <!-- Header button and menu -->
  <div class="lesson-menu-anchor">
    <button v-if="!lesson" class="blue-button" id="lessons-button" :class="{ active: showMenu }"
            :title="t('Lessons: a set of programs, processors and a tutorial with tasks')" @click="showMenu = !showMenu">
      📘 {{ t('Lessons') }}
    </button>
    <div v-if="showMenu && !lesson" class="lesson-menu" id="lesson-menu">
      <h4>{{ t('Lessons') }}</h4>
      <div v-if="!lessons.length" class="lesson-empty">{{ t('No lessons loaded: load a lesson file given by your teacher.') }}</div>
      <div v-for="l in lessons" :key="l.id" class="lesson-item">
        <button class="lesson-start" :title="l.description || 'Start this lesson'" @click="askStart(l.id)">
          <strong>{{ localized(l.title) }}</strong><span>{{ l.id }}</span>
        </button>
        <button class="lesson-small" :title="t('Download a self-contained copy (programs, processors and tutorial included)')"
                @click="exportSelfContained(l.id)">⬇</button>
        <button class="lesson-small" :title="t('Remove this lesson from the list')" @click="removeLesson(l.id)">🧹</button>
      </div>
      <button class="blue-button lesson-load" id="lesson-load-button" @click="pickFile">{{ t('Load lesson file…') }}</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="loadFile" />
      <div v-if="message" class="lesson-message">{{ message }}</div>
    </div>
  </div>

  <!-- Bar of the lesson in progress -->
  <Teleport defer to="#lesson-bar-slot">
    <div v-if="lesson" class="lesson-bar" id="lesson-bar">
      <span class="lesson-title">📘 {{ localized(lesson.title) }}</span>
      <span v-if="lesson.studentId" class="lesson-student">{{ lesson.idLabel }}: <b>{{ lesson.studentId }}</b></span>
      <span class="lesson-progress" :title="t('Tasks of the lesson completed (questions, predictions and goals of its tutorial)')">
        {{ t('Tasks {d} / {n}', { d: doneCount, n: lesson.tasks.length }) }}
      </span>
      <span v-if="completed && code" class="lesson-code" id="lesson-code"
            :title="t('Give this code to your teacher: it shows that you completed the lesson with your identifier')">
        ✔ {{ t('Completed · code') }} <b>{{ code }}</b>
        <button class="lesson-small" @click="copyCode">{{ copied ? t('copied') : t('copy') }}</button>
      </span>
      <span v-else-if="completed" class="lesson-code">{{ t('✔ Completed') }}</span>
      <button class="lesson-small" :title="t('Start the tutorial of the lesson again (your completed tasks are kept)')" @click="restartTutorial">↻ tutorial</button>
      <button class="lesson-exit" id="lesson-exit-button" @click="askExit = true">{{ t('Exit lesson') }}</button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="startingId" class="lesson-overlay" @click.self="startingId = null">
      <div class="lesson-dialog">
        <h4>{{ localized(startingLesson?.title) }}</h4>
        <p v-if="startingLesson?.description" v-html="localized(startingLesson.description)"></p>
        <label for="lesson-student-id">{{ idLabel }}:</label>
        <input id="lesson-student-id" v-model="studentId" type="text" @keyup.enter="confirmStart" />
        <div v-if="idError" class="lesson-error">{{ idError }}</div>
        <p class="lesson-note">{{ t('Write the identifier assigned by your teacher: when you complete the lesson you will get a code for it.') }}</p>
        <div class="lesson-actions">
          <button class="blue-button" id="lesson-start-confirm" :disabled="!!idError" @click="confirmStart">{{ t('Start') }}</button>
          <button class="blue-button" @click="startingId = null">{{ t('Cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="askExit" class="lesson-overlay" @click.self="askExit = false">
      <div class="lesson-dialog">
        <h4>{{ t('Exit the lesson?') }}</h4>
        <p>{{ t('The simulator returns to its state before the lesson. Your completed tasks are kept: if you start the lesson again with the same identifier, you continue where you left it.') }}</p>
        <p v-if="code">{{ t('Completion code:') }} <b>{{ code }}</b></p>
        <div class="lesson-actions">
          <button class="blue-button" id="lesson-exit-confirm" @click="exitLesson">{{ t('Exit') }}</button>
          <button class="blue-button" @click="askExit = false">{{ t('Stay') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
  .lesson-menu-anchor { position: relative; }
  .lesson-menu {
    position: absolute; top: 120%; right: 0; z-index: 2000; width: 340px;
    background: white; color: #222; border-radius: 8px; padding: 10px 12px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.25); font-size: 14px;
  }
  .lesson-menu h4 { margin: 0 0 8px; color: #1a4fb3; }
  .lesson-empty, .lesson-message { color: #555; font-size: 0.9em; margin: 6px 0; }
  .lesson-message { color: #8a5a00; }
  .lesson-item { display: flex; gap: 4px; margin: 4px 0; }
  .lesson-start {
    flex: 1; text-align: left; background: #f3f6fb; border: 1px solid #c9d6ea; border-radius: 6px;
    padding: 5px 8px; cursor: pointer; display: flex; flex-direction: column;
  }
  .lesson-start span { color: #666; font-size: 0.85em; }
  .lesson-start:hover { background: #e3ebf8; }
  .lesson-small { background: none; border: 1px solid #c9d6ea; border-radius: 4px; cursor: pointer; padding: 0 6px; }
  .lesson-load { margin-top: 8px; width: 100%; }

  .lesson-bar {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 4px 12px; background: #fff7e0; border-bottom: 1px solid #e0c56e; font-size: 14px; color: #333;
  }
  .lesson-title { font-weight: 600; }
  .lesson-progress { color: #555; }
  .lesson-code { color: #1b5e20; }
  .lesson-exit {
    margin-left: auto; background: #fbe9e7; border: 1px solid #e57373; color: #b71c1c;
    border-radius: 4px; padding: 2px 10px; cursor: pointer;
  }

  .lesson-overlay {
    position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .lesson-dialog {
    background: white; border-radius: 8px; padding: 20px 24px; width: min(460px, 92vw);
    box-shadow: 0 6px 20px rgba(0,0,0,0.3); font-size: 14px;
  }
  .lesson-dialog h4 { margin: 0 0 10px; color: #1a4fb3; }
  .lesson-dialog label { display: block; font-weight: 600; margin: 8px 0 4px; }
  .lesson-dialog input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 15px; }
  .lesson-error { color: #c62828; font-size: 0.9em; margin-top: 4px; }
  .lesson-note { color: #666; font-size: 0.85em; }
  .lesson-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
</style>
