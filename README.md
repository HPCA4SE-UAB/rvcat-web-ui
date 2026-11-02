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

The execution timeline's **Show Ports** control toggles the per-cycle rows for
all configured execution ports. **Show Cache** independently toggles the Main
Memory channel and cache-line rows, and is disabled when the selected processor
has no cache. An `X` marks a port issue cycle; `R`/`W` mark Main Memory
read/write transfers. Cache rows show `C`/`D` for ready clean/dirty blocks and
`r`/`w` while a clean/dirty block fill is pending. Hover a cache cell to see its
block address, readiness cycle, and LRU rank.
