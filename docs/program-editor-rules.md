# Program editor: coherence rules

These rules relate the **loop stride**, the **vector lanes**, and the **memory strides and offsets** of an RVCAT program. The editor checks them live, in the panel below the instruction table (implemented in `src/programChecks.js`):

- **Errors (✖, E-rules)** make the program meaningless for RVCAT. A program with errors cannot be saved.
- **Warnings (⚠, W-rules)** are usual mistakes that some algorithms legitimately need. The editor asks for confirmation before saving a program with warnings.

## Concepts

| Symbol | Field | Meaning |
|---|---|---|
| N | *N* in the Program panel | **Algorithmic operations**: iterations of the original loop, before unrolling or vectorization. An O(N) algorithm performs N of them. |
| S | stride of the final BRANCH (*Alg opers/iter (S)* in the editor) | **Loop stride**: algorithmic operations done by each loop iteration. The loop runs N/S iterations. |
| L | *Lanes* | Elements processed by a vector instruction (VINT, VMEM, VFLOAT). Scalar instructions have L = 1. |
| s | *Stride* of a MEM/VMEM instruction | The access advances L·s elements per loop iteration. |
| c | *Constant* of a MEM/VMEM instruction | Offset, in elements, of the first access. |
| d | *Size* | Element size: byte = 1, word = 4, long = 8 bytes. |

Typical values:

| Loop version | S |
|---|---|
| Original loop | S = 1 |
| Unrolled U times | S = U |
| Vectorized with L lanes | S = L |
| Vectorized with L lanes and unrolled U times | S = L·U |

**Memory model.** In loop iteration k = 0 … N/S − 1, a memory instruction accesses L consecutive elements of its array (the array is named in *source2*). The first element depends on the sign of the stride:

| Stride | First element accessed in iteration k | Typical source code |
|---|---|---|
| s > 0 (forward) | c + k·L·s | `A[i+c]` |
| s < 0 (backward) | N − c + k·L·s | `A[N−c−i]` |
| s = 0 (fixed) | c, in every iteration | scalar or table kept in memory |

The byte address is the array base + element × d. Each array is placed after the previous one, in program order.

## Instruction text

The text of an instruction is checked against its fields when it has one of the canonical forms below (implemented in `src/instructionText.js`). Other texts are allowed, but they are marked **ℹ T1 (not analyzed)** and their fields are not checked.

| Form | Instruction |
|---|---|
| `x = y op z`, op `+ -` | INT ARITH / FLOAT ADD |
| `x = y * z` | INT ARITH / FLOAT MUL |
| `x = y / z`, `x = sqrt(y)`, `x = a*b + c` (or `c + a*b`) | FLOAT DIV, SQRT, FMA |
| `x = y op z`, op `& \| ^` / `<< >>` | INT LOGIC / INT SHIFT |
| `c = y op z`, op `== != < <= > >=` | INT ARITH (comparison) |
| `x = A[index]` / `A[index] = x` | MEM LOAD / MEM STORE |
| `x[0:3]` in any of the above | vector instruction with 4 lanes (VINT, VFLOAT, VMEM) |
| `if c go back` | the final BRANCH |

- Operands are variables or one number, which goes to the *Constant* field.
- Sources are the variables in order of appearance, without repetitions. For an FMA, the two factors come first and then the addend. For memory instructions the order is fixed: LOAD has *source1* = index and *source2* = array; STORE has *source1* = value, *source2* = array and *source3* = index.
- Memory index forms:
  - `i+c` or `a*i+c`: forward, offset c;
  - `N-c-i` or `N-c-a*i`: backward, offset c;
  - a number c: fixed element, stride 0;
  - vector accesses use a range: `A[i:i+3]` or `A[N-4-i:N-1-i]`.
- The memory stride is deduced from the loop counter `i = i + k`: s = a·k / L, negative for backward accesses.
- Texts that are not analyzed:
  - several operations;
  - copies (`x = y`), which have no RVCAT instruction;
  - constant assignments;
  - stores of an expression;
  - parentheses;
  - indirect indexes (`A[B[i]]`);
  - different lanes in one instruction.

**Autofill.** When the text of an instruction changes, every field that can be deduced from it is filled in, overwriting the previous value. Fields that cannot be deduced, such as the type of `x = y + z` when the type of its variables is unknown, are kept. Any field can then be changed by hand; if it no longer agrees with the text, warning T2 says so. Type, operation and size fields that are still empty are filled in as soon as they can be deduced, for example when another instruction gives the data type of the variable.

### Data types

The data type of each variable (INT or FLOAT, and its size) is inferred for the whole program, not only from the previous instructions. For example, in `tmp = V[i]` followed by `sum = sum + tmp` as FLOAT single, the load gets size `word` from the second instruction.

- **Same data.** Variables that exchange values have the same type:
  - the operands and the result of an operation;
  - the value and the array of a load or a store.
- **Type from the operations.** `/`, `sqrt` and FMA are FLOAT. Logic operations, shifts, memory indexes, loop counters, comparisons and the branch condition are INT.
- **Type from the fields and declarations.** The *Type* and *Size* fields of the instructions, and the declarations of the program, also give the type.
- **Size.** It is shared by the same data, with single = word (4 bytes) and double = long (8 bytes). An INT with no size anywhere is assumed to be word.

### Declarations

The **Declarations** section, below the coherence checks, can be expanded to see each variable with:
- its role: array, index, counter, condition, size (N in a backward index), read-only or data;
- its type and size, and its lanes;
- the variables with the same data;
- the instructions that use it.

Choosing a type or size in the table sets it for all the variables with the same data, and rewrites the Type, Oper and Size fields of their instructions.

The declarations are saved in the program JSON, as a list:

```json
"declarations": [
  {"name": "V", "role": "array", "type": "FLOAT", "size": "single"},
  {"name": "i", "role": "index", "type": "INT", "size": "word"}
]
```

When a program is uploaded, in the Program panel or in the editor, its declarations are checked against its instructions. A warning lists:
- contradictions;
- declared variables that are not used;
- variables that are not declared.

### Warnings

| Code | Meaning |
|---|---|
| T1 (info) | The text does not have a canonical form: its fields are not checked. |
| T2 | A field differs from what the text gives (empty Type/Oper/Size fields are not reported: they are filled automatically). |
| T3 | Contradictory data types for variables with the same data (operations, fields or declarations). |
| T5 | A vector register is used with different numbers of lanes. |

## N and the memory trace

**N** is saved with the program (field `N` of the JSON file, optional). When the program is selected or uploaded in the Program panel, it becomes the current N; programs without N keep the current one. Reloading the page keeps the last N used.

The **Memory trace** section, below the coherence checks, can be expanded to see the memory accesses of the edited program:

- One column per memory instruction (array, lanes L, stride s, offset c, element size), and one row per iteration.
- The first K and the last K iterations are shown (K = 1 … 16); the omitted iterations are indicated between them.
- Each cell shows the elements accessed (`A[4..7]`) and their byte addresses (decimal or hexadecimal).
- The addresses are computed by RVCAT (`Program.get_memory_trace`), with the same model as the simulator: the arrays are placed one after another from address 0, in program order, and each array is as large as its accesses reach.
- Cells outside the elements swept by the access over the whole loop (iterations × L·|s|) are shown in red. For example, `A[i+1]` in the last iteration, or a backward access with c < L (W7). Accesses to a fixed address (s = 0) are not marked.
- Hovering a column highlights its instruction. **Copy** copies the trace as tab-separated text.
- The trace is not computed while the program has errors.

## Rules enforced by construction

The editor makes these rules impossible to break:

- The program ends with exactly one BRANCH instruction (`if c go back`), and it cannot be moved or deleted.
- Only memory instructions (MEM, VMEM) have a stride field. Changing the type of any other instruction sets its stride to 1.
- Only vector instructions have a lanes field. Changing the type to a scalar type sets lanes to 1; changing it to a vector type sets lanes to 4 if it was below 2.
- S is edited in its own field (*Alg opers/iter (S)*), and is always an integer ≥ 1.
- Changing the type clears the operation and size, so that they are chosen again among the valid ones.

## Errors (the program cannot be saved)

| Code | Rule | Reason |
|---|---|---|
| E1 | S is an integer ≥ 1. | The loop runs N/S iterations. |
| E2 | Vector instructions have L ≥ 2; scalar instructions have L = 1. | RVCAT uses L to compute the bytes accessed per iteration (d·L·s), so lanes on a scalar access would silently enlarge it. |
| E3 | Only memory instructions and the BRANCH have a stride ≠ 1. | The stride of other instructions has no meaning. |
| E4 | s and c are integers. A forward or fixed access (s ≥ 0) has c ≥ 0. | Arrays start at element 0: `A[i−1]` with i starting at 0 reads before the array. Write the loop so that indexes are never negative (for example `A[i]`, `A[i+1]`, `A[i+2]` instead of `A[i−1]`, `A[i]`, `A[i+1]`). |

The upload of a program also checks:
- the types, operations and sizes;
- that memory instructions name an array;
- that, for the selected N, no access falls before the start of its array.

## Warnings (probable mistakes)

| Code | Rule | Typical mistake | When it is correct anyway |
|---|---|---|---|
| W1 | If vector instructions have L lanes, S is a multiple of L (S = L·U). | A loop is vectorized, but S stays at 1, so cycles/alg oper is L times too large. | Each algorithmic operation processes several elements (e.g. one complex number = 2 lanes). |
| W2 | All vector instructions use the same L. | One instruction keeps an old number of lanes. | Conversions between element sizes. |
| W3 | Each memory access advances a multiple of S elements per iteration: L·\|s\| = e·S (e = elements per algorithmic operation, usually 1, so s = S/L). | A loop is unrolled or vectorized, but the memory strides are not updated, so consecutive iterations read the same elements again. | Accesses whose step is not proportional to the algorithmic operations (rare). |
| W4 | Accesses to the same array, with the same operation, L and s, have different offsets. | An unrolled copy keeps offset 0 instead of `A[i+1]` → c = 1. | The same element is really read twice. |
| W5 | Those accesses do not partially overlap: their offsets differ by a multiple of L. | Vector copies with offsets 0 and 2 instead of 0 and L. | Stencils, sliding windows (`A[i:i+3]` and `A[i+1:i+4]`). |
| W6 | With S > 1 and one element per algorithmic operation, the copies of an access cover all L·s elements of each iteration. | An unrolled copy is missing. | The original loop does not access every element. |
| W7 | A backward access (s < 0) has c ≥ L, so that the first access stays inside the N elements of the array. | c = 0 reads A[N], one element past the end. | — |
| W8 | A loop counter `i = i + k` has k = S. The counter is an INT instruction whose destination equals its source and is used as a memory index; k is its *constant*, or else the number in its text. | The counter or S is not updated after unrolling or vectorizing. | The index advances by something other than the algorithmic operations (e.g. bytes). |

RVCAT does not use the value of the counter (addresses come from s and c), so W8 only checks that the program reads coherently.

## Not checked

These rules cannot be checked from the program fields:

- **Texts without a canonical form** (T1). Only the canonical forms of the text are checked against the fields.
- **Algorithmic equivalence.** The editor cannot check that the unrolled or vectorized version computes the same as the original loop. This matters for reductions: several partial accumulators must be combined after the loop, and that code is not simulated.
- **Remainder iterations.** Real code has an epilogue loop when N is not a multiple of S. RVCAT instead rounds N down to a multiple of S.

## Can incoherent programs be prevented automatically?

- **Structural rules (E1–E3) can be enforced, and they are.** The fields that make no sense for an instruction are not editable, and S has its own validated field. A student can no longer produce these errors from the editor.
- **E4 is a hard error.** It is checked live, and the program cannot be saved while it fails.
- **The W-rules cannot be hard constraints.** Each one has legitimate exceptions (stencils, strided algorithms, fixed addresses, reused elements). Blocking them would make valid programs impossible to write. They are shown live, marked on the row, and confirmed before saving.

The **Unroll / Vectorize assistant** goes one step further: it *derives* the fields instead of checking them. Programs generated with it satisfy W1, W3, W4, W5, W6 and W8 by construction. Manual editing is left for the special cases.

## Unroll / Vectorize assistant

The **Unroll / Vectorize…** button opens a dialog with these options:
- **Vectorize** with L = 2, 4, 8 or 16 lanes;
- **Unroll** U = 2, 3, 4, 6 or 8 times;
- **Partial accumulators**, when the loop has reductions.

The dialog shows the resulting program, its S, and the instructions per algorithmic operation before and after. It also shows the notes and checks of the result. **Apply** replaces the edited program, and **↶ Undo** restores the previous one. When both options are chosen, the loop is vectorized first and then unrolled, so S = L·U. The implementation is in `src/loopTransforms.js`.

### Loop analysis

- **Loop control.** These are the INT instructions that compute memory indexes or the branch condition, and the instructions they depend on: the counter `i = i + k` and the compare `c = i != N`. They are not vectorized, and they appear only once per iteration.
- **Loop-carried variables.** A variable is loop-carried when it is read before being written in the body. There are two kinds:
  - **Reduction:** `v = v ⊕ x`. Every instruction that writes v reads it once, with the same associative operation (ADD/FMA as the addend, or MUL), and no other instruction reads v. Example: `sum = sum + tmp`.
  - **Recurrence:** any other loop-carried variable. Each iteration needs the result of the previous one.

### Vectorize with L lanes

The loop must be the original one: S = 1 and no vector instructions. The assistant applies these rules:

| Element | Rule |
|---|---|
| Recurrences and indirect accesses | Refused. Recurrences cannot run in parallel lanes, and gathers are not supported. |
| Data instructions (not loop control) | They become VINT/VMEM/VFLOAT with L lanes. |
| Memory stride s | Unchanged: the access now advances L·s elements per iteration. |
| Offset c of a backward access | Becomes c + L − 1, so the first vector covers elements N−c−L+1 … N−c. |
| Accesses to a fixed address (s = 0) | Stay scalar: their value is shared by all the lanes. |
| Counter | Advances k·L. |
| S | Becomes L. |
| Text | Rewritten in the usual form: `V[i]` → `V[i:i+3]`, `sum` → `sum[0:3]`. |
| Reductions | Become L partial results. Combining them after the loop is not simulated. |

### Unroll U times

The assistant applies these rules:

| Element | Rule |
|---|---|
| Body (except the loop control) | Repeated U times. Copy j of a memory access with lanes L, stride s and offset c gets offset c + j·L·s (backward: c − j·L·s), and its stride becomes U·s. |
| Loads from a fixed address | Kept only in the first copy. |
| Loop control | Kept once, after the copies. The counter advances k·U. |
| S | Multiplied by U. |
| Text | Index shifted: `V[i]` → `V[i+1]`, and `V[i:i+3]` → `V[i+4:i+7]`. |
| Reductions, with *Partial accumulators* | Copy j uses its own variable (`sum`, `sum1`, …). This splits the dependence chain into U shorter ones, which divides the latency bound. Adding the partial results after the loop is not simulated. |
| Reductions, without partial accumulators | The copies form a single chain, as in the original loop. |
| Recurrences | The copies always form a single chain. |

Applied to the distributed programs:
- unrolling Base 2 times gives exactly V2;
- vectorizing Base with 4 lanes gives exactly BaseSIMD.

### Special cases left to manual editing

- stencils (`A[i] + A[i+1]`);
- strided or indirect accesses;
- loops whose index is not a simple counter;
- remainder iterations.
