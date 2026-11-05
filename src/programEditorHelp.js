// Help of the Program Editor (HTML). Full reference: docs/program-editor-rules.md

export const PROGRAM_EDITOR_HELP = `
<p>The simulated program is a <em>fixed-iteration</em> loop of <strong>machine instructions</strong>, described in informal
high-level language. For each instruction you edit its <em>type</em>, operation and <em>size</em>, its input/output
operands (<b>InOut</b>), and, for memory and vector instructions, its <em>stride</em> and <em>lanes</em> (<b>Stride/Lanes</b>).
Programs are downloaded and uploaded as JSON files.</p>

<p><strong>Alg opers/iter (S)</strong> is the loop stride: how many <em>algorithmic operations</em> (iterations of the
original loop) each iteration does. N algorithmic operations take N/S iterations.
<strong>Unroll / Vectorize…</strong> transforms the loop keeping everything coherent; the panel below the table checks
the coherence: errors (✖) must be fixed before saving, warnings (⚠) are usual mistakes.</p>

<details><summary><b>Algorithmic operations and the loop stride S</b></summary>
<p>An algorithmic operation is one iteration of the original loop, before unrolling or vectorization: an O(N) algorithm
performs N of them. S = 1 for the original loop, U if it is unrolled U times, L if it is vectorized with L lanes, and
L×U if both. Cycles/Alg Oper (= cycles/iter ÷ S) compares versions of the same algorithm.</p>
</details>

<details><summary><b>Memory accesses: lanes L, stride s, offset c</b></summary>
<p>A MEM/VMEM instruction accesses L consecutive elements of the array named in <em>source2</em>; the element size is
its <em>size</em> (byte 1, word 4, long 8 bytes). In loop iteration k = 0, 1, … the first element is:</p>
<p>&bull; s &gt; 0: <b>c + k·L·s</b> (forward from the start, e.g. A[i+c])<br>
&bull; s &lt; 0: <b>N − c + k·L·s</b> (backward from the end, e.g. A[N−c−i])<br>
&bull; s = 0: <b>c</b> in every iteration (a value kept in memory)</p>
<p>So each access advances L·|s| elements per iteration. In an unrolled or vectorized loop, usually L·|s| = S:
one element per algorithmic operation.</p>
</details>

<details><summary><b>Instruction text, autofill and declarations</b></summary>
<p>When the <b>text</b> of an instruction changes, the fields that can be deduced from it are filled in (and
overwritten): type, operation, size, destination, sources, constant, stride and lanes. You can then change any field
by hand; if it no longer agrees with the text, a warning <b>T2</b> says so. The text must use these forms:</p>
<p>&bull; <b>x = y op z</b> with op <b>+ - * /</b>, <b>&amp; | ^ &lt;&lt; &gt;&gt;</b> or a comparison
(<b>== != &lt; &lt;= &gt; &gt;=</b>); y and z are variables or one number (the constant).<br>
&bull; <b>x = a*b + c</b> (FMA), <b>x = sqrt(y)</b>, and conversions <b>x = double(y)</b> (also single, byte, word, long).<br>
&bull; <b>x[0:3] = shuffle(y[0:3], z[0:3])</b>: combines the lanes of one or two vector registers (VINT or VFLOAT
SHUFFLE, with the type of its data). The sources may have other lanes, e.g. x[0:7] = shuffle(a[0:3], b[0:3]).
<b>permute(…)</b> is the same, moving elements across 128-bit blocks (PERMUTE).<br>
&bull; <b>x = A[index]</b> (load) and <b>A[index] = x</b> (store), with index <b>i+c</b> or <b>a*i+c</b> (forward),
<b>N-c-i</b> (backward from the end) or a number (fixed element).<br>
&bull; Vectors: <b>x[0:3]</b> is a vector register of 4 lanes; <b>A[i:i+3]</b> and <b>A[N-4-i:N-1-i]</b> access 4
elements.</p>
<p>The memory stride is deduced from the loop counter <b>i = i + k</b>: s = a·k / L. An index that the loop does not
change (e.g. a stack pointer s in STK[s+4:s+5]) accesses a fixed address: s = 0. Other texts (several operations,
copies, parentheses, indirect indexes…) are marked <b>ℹ T1 not analyzed</b>, and their fields are not checked.</p>
<p>The <b>data type</b> (INT or FLOAT, and size) is inferred for the whole program. Variables that exchange values
(the operands and result of an operation, the value and the array of a load or store) have the same type. The type
comes from the operations (/, sqrt and FMA are FLOAT; logic operations, shifts, indexes and comparisons are INT), from
the Type and Size fields, and from the declarations; a variable whose type is unknown takes it as soon as another
instruction gives it. Contradictions are warned (<b>T3</b>), as are vector registers with different lanes (<b>T5</b>).</p>
<p><b>Declarations</b> (below the checks) lists the variables with their role (array, index, counter, condition,
read-only, data), type, size, lanes and the instructions that use them. Choosing a type or size there sets it for the
variables with the same data and rewrites their instructions. The declarations are saved with the program and checked
when it is uploaded.</p>
</details>

<details><summary><b>Conversions and vector registers</b></summary>
<p>A conversion is written as a call to the type of the result: <b>y = double(x)</b>, <b>y = single(x)</b>
(FLOAT), <b>y = word(x)</b>, <b>y = long(x)</b>, <b>y = byte(x)</b> (INT). Its fields are the type of the result,
oper <b>CVT</b> and the size of the result. Conversions go between INT and FLOAT, or between single and double
(warning <b>T6</b> otherwise).</p>
<p><b>Vector regs</b> is the width in bytes of the vector registers: a vector instruction holds width / element size
lanes, e.g. 32 bytes hold 8 single or 4 double. Auto takes the largest vector instruction of the program. Warnings:
<b>W2</b> an instruction fills only part of the registers, <b>W9</b> it does not fit in them.</p>
<p>So converting 8 single into double needs two instructions, one per half of the source register, each producing a
register of 4 double: <b>y_lo[0:3] = double(x[0:3])</b> and <b>y_hi[0:3] = double(x[4:7])</b>. Converting 8 double
into single takes two halves, each writing half of the result: <b>b[0:3] = single(a_lo[0:3])</b> and
<b>b[4:7] = single(a_hi[0:3])</b>. Writing the upper lanes keeps the lower ones, so that instruction also reads b.
The Unroll / Vectorize assistant does this automatically. L lanes are counted for the smallest elements, and the
instructions on larger elements are done in halves.</p>
<p><b>128-bit blocks.</b> In x86 AVX, registers of 32 or 64 bytes are made of 128-bit blocks. SHUFFLE moves elements
within each block (1 cycle); moving them across blocks needs <b>PERMUTE</b> (3 cycles in Intel processors).
When a vectorized loop moves data across blocks, the assistant asks which model to use:</p>
<p>&bull; <b>AVX</b>: it generates the PERMUTE instructions. A conversion reads the lowest elements of a register,
so the upper half is extracted first (x_up[0:3] = permute(x[0:7])); a conversion to a smaller size is done into
another register and inserted into the upper half (b[0:7] = permute(b[0:3], b_up[0:3])).<br>
&bull; <b>Generic</b>: vector registers without 128-bit blocks; conversions read and write halves directly.</p>
<p>The data moves are needed, for example, when a backward access is combined with forward ones (B[i] = A[N-1-i]): the
lanes of the backward vector are in reverse order and must be reversed (PERMUTE in AVX, SHUFFLE in the generic model).
A reduction of a backward access needs no reversal.</p>
</details>

<details><summary><b>Source code</b></summary>
<p>The <b>Source code</b> section keeps the code (e.g. C) of the loop from which the program was generated. It is saved
with the program (field <i>description</i> of the JSON file) and shown, in the Program panel, when the mouse is over
the header <i>&lt;program&gt;: Program Instructions</i> or when it is clicked.</p>
</details>

<details><summary><b>N and the memory trace</b></summary>
<p><b>N</b> (algorithmic operations) is saved with the program: when the program is selected or uploaded in the
Program panel, it becomes the current N. The loop runs N/S iterations (N is rounded down to a multiple of S).</p>
<p><b>Memory trace</b> (below the checks) shows, for the first and the last iterations, the elements and the byte
addresses accessed by each memory instruction, computed by RVCAT with the same model as the simulator. The arrays
are placed one after another from address 0, in program order; each one is as large as its accesses reach.
Elements outside the range swept by the access over the whole loop are shown in red (e.g. A[i+1] in the last
iteration, or a backward access with offset smaller than its lanes). Hovering a column highlights its instruction;
<b>Copy</b> copies the trace as tab-separated text. The trace is not shown while the program has errors.</p>
</details>

<details><summary><b>Errors ✖ (the program cannot be saved)</b></summary>
<p><b>E1</b> S is an integer ≥ 1.<br>
<b>E2</b> Vector instructions (VINT, VMEM, VFLOAT) have L ≥ 2 lanes; scalar ones have 1 lane. RVCAT uses L to compute
the bytes accessed per iteration, so lanes on a scalar access would silently enlarge it.<br>
<b>E3</b> Only memory instructions (and the final BRANCH) have a stride.<br>
<b>E4</b> s and c are integers, and an access with s ≥ 0 has c ≥ 0: arrays start at element 0, so A[i−1] would read
before the array. Write such loops with non-negative offsets (A[i], A[i+1], A[i+2] instead of A[i−1], A[i], A[i+1]).</p>
<p>E2 and E3 cannot happen when editing: the fields that make no sense are not editable, and changing the type adjusts
them.</p>
</details>

<details><summary><b>Warnings ⚠ (probable mistakes)</b></summary>
<p><b>W1</b> With L-lane vector instructions, S should be a multiple of L (S = L×U). <i>Typical mistake:</i> a vectorized
loop keeps S = 1, so cycles/alg oper is L times too large.<br>
<b>W2</b> Each vector computation should fill the vector registers: lanes × element size = register width (memory
accesses, shuffles and permutes may use part of a register).<br>
<b>W3</b> Each memory access should advance a multiple of S elements per iteration (L·|s| = S when it reads one element
per algorithmic operation, so s = S/L). <i>Typical mistake:</i> after unrolling, the strides stay at 1 and the
iterations read the same elements again.<br>
<b>W4</b> Copies of an access (same array, operation, lanes and stride) should have different offsets.
<i>Typical mistake:</i> the copy for A[i+1] keeps offset 0.<br>
<b>W5</b> Copies should not partially overlap: their offsets differ by a multiple of L.<br>
<b>W6</b> With S &gt; 1, the copies should cover all the elements advanced per iteration. <i>Typical mistake:</i> an
unrolled copy is missing.<br>
<b>W7</b> A backward access (s &lt; 0) should have c ≥ L, or its first access reads past the end of the array.<br>
<b>W9</b> A vector instruction does not fit in the vector registers (lanes × element size &gt; width).<br>
<b>W10</b> A PERMUTE with vector registers of 16 bytes or less (a single 128-bit block): a SHUFFLE does the same.<br>
<b>W8</b> The loop counter i = i + k (an INT instruction that increments a memory index; k is its constant) should
advance k = S.</p>
<p>Some algorithms need these patterns (stencils such as A[i] + A[i+1], strided accesses such as A[2i], values kept in
memory), so warnings do not block the program: you are asked to confirm before saving.</p>
</details>

<details><summary><b>Unroll / Vectorize assistant</b></summary>
<p>It transforms the edited program and shows the result before applying it (<b>↶ Undo</b> restores the previous one):</p>
<p>&bull; <b>Vectorize with L lanes</b> (original loop only): every instruction that computes the data becomes a vector
instruction with L lanes; memory strides keep their value (L·s elements per iteration); S = L. Accesses to a fixed
address stay scalar. Loops with a <em>recurrence</em> (a value that needs the previous iteration, other than a
reduction such as sum = sum + x) or with indirect accesses cannot be vectorized.<br>
&bull; <b>Unroll U times</b>: the body is repeated U times; copy j of an access has offset c + j·L·s (backward:
c − j·L·s) and every stride becomes U·s; the counter and the compare are kept once, at the end; S = U × S.<br>
&bull; <b>Partial accumulators</b>: each copy of a reduction uses its own variable (sum, sum1, …), which splits the
dependence chain and reduces the latency bound. The partial results must be added after the loop (not simulated).</p>
<p>Edit the result manually only for special cases (stencils, strided or indirect accesses, remainder iterations).</p>
</details>

<details><summary><b>Not checked</b></summary>
<p>&bull; Texts that do not have the forms above (they are marked ℹ T1).<br>
&bull; That the transformed loop computes the same as the original one.<br>
&bull; Remainder iterations: RVCAT rounds N down to a multiple of S instead of running an epilogue loop.</p>
</details>
`
