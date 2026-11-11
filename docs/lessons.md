# RVCAT lessons

A **lesson** is a JSON file that the teacher gives to the students. It defines:

- the programs and processors that can be used (the others are hidden during the lesson);
- one tutorial, whose cards include the **tasks** of the lesson (questions, predictions and goals);
- **locks**: what the student cannot change (editors, processor parameters, N, simulation options);
- optionally, a **completion code** for each student identifier.

The student loads it with **📘 Lessons → Load lesson file…**, starts it, writes the identifier
assigned by the teacher (if the lesson has a completion code) and follows its tutorial. A bar under
the header shows the progress (`Tasks k / n`) and, when every task is done, the completion code.
**Exit lesson** (with confirmation) returns the simulator to its state before the lesson; the
completed tasks are kept, so starting the lesson again with the same identifier continues it.

Lessons:

- [lessons/L1-example.json](lessons/L1-example.json): a short example of every kind of task.
- [lessons/L2-simd.json](lessons/L2-simd.json): **SIMD vectorization**. What SIMD is and what it gains (f0 / f0-SIMD),
  the conditions for an efficient vectorization (stride: f2; data sizes: f3; dependences: f4), and an exercise to
  vectorize Base by hand (a reduction with a vector accumulator), with an optional goal of two accumulators.
  Processor B4, N = 1000. Secret: `SIMD-L2-K4R8`.

## File format

```json
{
  "lesson": "L1-example",
  "title": "Example: bounds, ROB and your own loop",
  "description": "Shown when the lesson is started",
  "version": 1,
  "programs":   ["Base", "V1", { "name": "Mine", "instruction_list": [ ... ] }],
  "processors": ["B4"],
  "tutorial":   { "id": "L1-tutorial", "name": "...", "flowVersion": 2, "steps": [ ... ] },
  "start":      { "program": "Base", "processor": "B4", "N": 1000 },
  "locks":      { ... },
  "completion": { "secret": "RVCAT-L1-7Q2X", "idLabel": "NIU", "idPattern": "^[0-9]{7}$" }
}
```

| Field | Meaning |
|---|---|
| `lesson` | Identifier: letters, digits and `-`. It is part of the completion code. |
| `programs`, `processors` | Each element is the **name** of a program/processor of RVCAT, or a complete **embedded** object (the same JSON as a program or processor file, with its `name`). |
| `tutorial` | Name of a tutorial of RVCAT, or an embedded tutorial (with `id`). |
| `start` | Program, processor and N selected when the lesson starts. |
| `locks` | See below. |
| `completion` | Optional. `secret`: letters, digits and `-`. `idLabel`: name of the identifier (NIU, DNI...). `idPattern`: regular expression that the identifier must match. |

**Names or embedded objects.** While the lesson is being prepared, names are comfortable (the
programs are edited with the program editor). To distribute it, the **⬇** button of the lesson in
the Lessons menu downloads a **self-contained copy**: every name is replaced by the stored object,
so the lesson does not change if the programs of RVCAT change later. Embedded resources replace
the ones with the same name only during the lesson.

## Locks

```json
"locks": {
  "programEditor": false,
  "tutorialEditor": true,
  "loopTransforms": true,
  "upload": true,
  "remove": true,
  "processor": "all",
  "N": { "fixed": 1000 },
  "simulation": { "sched": "optimal", "speculation": "stall" }
}
```

| Lock | Default | Effect when `true` |
|---|---|---|
| `programEditor` | false | Hides *Edit Program* and 📝. |
| `tutorialEditor` | true | Hides *Edit Tutorial* and ✎. |
| `loopTransforms` | true | Hides the *Unroll / Vectorize* assistant of the program editor. |
| `upload` | true | Hides *Add new* in the lists of programs and processors, and *ADD NEW TUTORIAL*. |
| `remove` | true | Hides the 🧹 buttons. |
| `processor` | `[]` | `"all"`, or a list of `dispatch`, `retire`, `rob`, `cache`, `bPenalty`, `ports`, `latencies`: those cells of the Processor panel cannot be changed. |
| `N` | none | `{ "fixed": 1000 }` or `{ "min": 100, "max": 5000 }`. |
| `simulation` | `{}` | Fixed simulation options: `sched` (optimal, greedy), `speculation` (stall, wrong-path). |

Programs saved in the program editor during the lesson are added to its list (they cannot replace
a program of the lesson).

## Tasks: cards of the tutorial

Every card of type `question`, `predict` or `goal` is a task, unless it has `"optional": true`.
The cards can use everything of the tutorials: `actions` (run when the card is shown), `showMe`
(run by its ▶ Show me button), live values `{{name}}` in the texts, validations.

**Question** (single, multiple or numeric answer): done when answered correctly.

```json
{ "id": "bound", "type": "question", "title": "...", "questionText": "What is the latency bound?",
  "answerMode": "number", "answers": [], "numericValue": "{{latencyBound}}", "tolerance": 0.01,
  "numericUnit": "cycles/iter", "numericCorrect": "...", "numericWrong": "...", "next": ["..."] }
```

Several numbers in one question: `"answerMode": "numbers"` with `numericFields`, one input each, checked
one by one (each field has its own `correct` / `wrong` text). With `"predictOnly": true` the numbers are
only saved, as a prediction (no answer is right or wrong): `savedText` is shown, and a **Change** button lets
the student correct them later. The texts of any card can show the K-th number answered in a question with
`{{answer.ID.K}}`, and with `{{answerCheck.ID.K}}` the number and the label of its field, e.g. "2 (Base)", in bold,
green when it is right and red when it is wrong (e.g. the predictions, next to the right answers).

```json
{ "id": "q-fast", "type": "question", "title": "...", "questionText": "...", "answerMode": "numbers", "answers": [],
  "numericFields": [{ "label": "Base", "value": 2, "tolerance": 0.3, "unit": "cycles/iter", "correct": "...", "wrong": "..." },
                    { "label": "V1",   "value": 2, "tolerance": 0.3, "unit": "cycles/iter" }],
  "predictOnly": true, "savedText": "Prediction saved...", "next": ["..."] }
```

**Predict**: the student writes a number before simulating; the next simulation gives the real value.
Done after that simulation (any prediction). With `tolerance`, the card says whether the prediction was good.

```json
{ "id": "p1", "type": "predict", "title": "...", "selector": "#run-simulation-button", "position": "bottom",
  "description": "Predict the cycles per iteration, save it, and simulate.",
  "predictValue": "cyclesPerIter", "predictUnit": "cycles/iter", "tolerance": 0.3,
  "showMe": ["runSimulation"], "next": ["..."] }
```

**Goal**: a condition on the results, checked after every simulation while the card is shown.
Done when it is true once; with `best`, the best value obtained is recorded (`bestMode`: `min` or `max`).
`allow` lifts locks while the card is shown: `processor.rob`, `processor` (all its fields), `N`,
`programEditor`, `simulation.sched`... `program` requires that the simulated program is that one.
Any other card (a step or a question) can also have `allow`, e.g. a question that lets the student
change a latency to check the answer.

```json
{ "id": "g1", "type": "goal", "title": "...", "selector": "#process-panel .processor-container", "position": "right",
  "description": "Find the smallest ROB that keeps V1 below 2.1 cycles/iter.",
  "goal": "cyclesPerIter < 2.1", "program": "V1", "allow": ["processor.rob"], "best": "rob", "bestMode": "min",
  "next": ["..."] }
```

Conditions use the names of the live values (`cyclesPerIter`, `cyclesPerAlgOp`, `cycles`, `ipc`,
`port.P1`, `rob`, `dispatch`, `latency.FLOAT.ADD`, `program`, `latencyBound`...; the complete list is
in the help of the tutorial editor), numbers, strings (`"V2"`), `+ - * /`, `< <= > >= == !=`, `&& || !`
and parentheses. A name with `+` is written as `{{resource.P1+P3}}`.

The tutorial editor does not edit `predict` and `goal` cards: lessons are written in JSON.

## Completion code

When every task is done, the bar shows a code such as `77255-46554`. It depends only on the lesson
identifier, the student identifier and the secret:

```
t  = UPPER(lesson) | UPPER(student ID) | UPPER(secret)
h1 = MOD( Σ CODE(t_i) · MOD(131·i² + 71·i + 17, 997), 99991 )      (i = 1 ... length of t)
h2 = MOD( Σ CODE(t_i) · MOD(37·i² + 113·i + 29, 991), 99989 )
code = h1 (5 digits) - h2 (5 digits)
```

The spreadsheet [lessons/lesson-codes.xlsx](lessons/lesson-codes.xlsx) checks the codes delivered
by the students: write the lesson id and the secret, and the list of identifiers and codes
(Excel, LibreOffice Calc or Google Sheets).

**Security.** The code proves that the lesson was completed with that identifier, and a code copied
from a classmate does not fit another identifier. But the secret is inside the lesson file: a student
who reads it can compute a valid code without doing the lesson. Use it for low-stakes activities.

## Other fields of the cards

- `anchor`: selector used only to place the card (e.g. `#right-panel`); the card goes to an empty zone near it.
- `position`: `bottom`, `top`, `left`, `right`, or `inside-bottom`, `inside-top`, `inside-left`, `inside-right`, `inside-top-left` (within the anchor; `inside-top-left` near its top-left corner).
- `graphWindow`: `top-right` opens the dependence graph window at the top right while the card is shown (so that the card does not cover it).
  In a question, `"position": "right"` shows it as a panel at the right that does not cover the simulator.
- `wWidth`, `wHeight`: fixed size of the card (it grows with its content instead of showing scroll bars).
- `doneDescription`: second part of the text, shown when the validation of the card is met.
- validation `{ "type": "element_closed", "selector": ".pinned-detail" }`: met once that element is closed (e.g. the window with the C code).
- `predictGood`, `predictFar`: comments shown after a good or a far prediction.
- `resultDescription`: text shown after the result of the prediction, whatever it was (e.g. to explain the result).
- `explore`: `true`, `"required"` or `"auto"` (required, and started by itself when the card is shown): an **Explore** button hides the card so that the student can explore the
  simulator; an orange button at the bottom right brings it back. With `"required"` the card cannot be left before.
  `exploreHint` (HTML) is shown next to the orange button until it is closed.
  `exploreActions` run when the exploration starts (e.g. `timeline:width=0.97`), `exploreEndActions` when it ends.

## State of the simulator at each card

The state of the simulator at a card is computed from the tutorial file, not stored: the parts hidden by the
lesson are its initial `hidden` list with the `reveal`/`hide` actions of the cards before it (in the order of
the file), and, when the tutorial is resumed (e.g. after closing the browser) or the student goes back, the
processor (`selectProcessor`, `setProcessor`, `revertProcessor`), the program, the side panel, the program view
and the timeline settings of those cards are applied again (only what differs). What is stored is only the
position (card), the history (Previous) and the state of each card (answers, predictions, explorations,
place and size). If a new version of the lesson no longer has the card, the lesson goes on at the closest
card visited before.
