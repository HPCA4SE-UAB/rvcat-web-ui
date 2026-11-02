# rvcat-web

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

## Program JSON files

Imported program files must contain a non-empty `name` and a non-empty
`instruction_list`. Each instruction needs a description and a supported
`type`/`oper`/`size` combination. Programs must end with exactly one `BRANCH`;
its `stride` must be between 1 and the UI's 5000-element limit. Instruction
`stride` values are safe integers and `lanes` values are positive safe integers.
Memory instructions (`MEM` and `VMEM`) also require an array name in `source2`;
their optional `constant` is
a safe integer offset. `VMEM` supports the `byte`, `word`, and `long` sizes.

The program upload checks memory accesses against the selected logical element
count. Simulation and timeline generation repeat validation before execution
and report instructions unsupported by the active processor instead of running
them. Latencies, ports, and memory addresses are derived by the application.

The execution timeline's **Show Ports** control toggles per-cycle execution-port
rows. The **Cache** control toggles Main Memory, cache-line, fill-buffer, and
dirty write-buffer rows together, and is unavailable when the selected processor
has no cache.
Fill and write buffer capacities are configurable in Processor Settings and
default to two entries each. Misses are admitted by age, and requests to the same
block share a fill entry. A fill buffer remains occupied until the read completes
and every waiting instruction receives its data through the return queue. Its cache
line may be replaced meanwhile; queued returns use the fill buffer. A dirty victim
is held in a write buffer until its write completes before the replacement block is
fetched. `R`/`W` identify active fill/write-buffer entries.
Secondary misses to an already-loading block use `2`; `:` denotes waiting for
the fill and `@` waiting in the independent cache return queue. The configurable
`rThru` parameter (1–32, default 1) limits how many waiting LOAD/STORE instructions
receive returned data per cycle. They are served in program age order and do not
pay execution latency again or compete for execution ports.
The processor table shows the cache settings and lets you edit them by clicking
the Cache row; **Miss Penalty** is constrained to be at least **Miss Issue Time**.
The model does not include LSQ dependencies or load/store bypass. Each memory
block address has a distinct color shared across MM, cache-line, and buffer rows.
Simulation results keep read/write miss totals and display primary versus secondary
miss counts separately. MM read transfers fetch blocks after cache misses (including
STORE read-for-write fills); MM write transfers write back evicted dirty blocks.
The MM percentage is the fraction of total cycles in which the issue channel is busy.
