# RVCAT-WEB

Web interface of RVCAT, an educational tool to analyze the performance of small
loops on a configurable out-of-order processor (dispatch/retire width, ROB,
execution ports, latencies and a data cache). It shows the dependence graph and
performance bounds, simulation results and a cycle-by-cycle execution timeline
with the critical path.

The app is fully static: the RVCAT simulator (Python) runs in the browser with
[Pyodide](https://pyodide.org/) inside a Web Worker (`public/worker.js`), and
the user interface is built with Vue 3 and Vite.

| Repository | Role |
|---|---|
| [JCMoure/RVCAT](https://github.com/JCMoure/RVCAT) | Python simulator, packaged as `public/rvcat-0.1-py3-none-any.whl` |
| [JCMoure/rvcat-web-ui](https://github.com/JCMoure/rvcat-web-ui) (`origin`) | Development; every push to `main` deploys a testing site |
| [HPCA4SE-UAB/rvcat-web-ui](https://github.com/HPCA4SE-UAB/rvcat-web-ui) (`hpca`) | Releases; deploys the site used by students |

## Development

```sh
npm install
npm run dev          # development server with hot reload
npx vitest run       # unit tests (npm run test:unit for watch mode)
npm run lint         # ESLint (with --fix)
npm run build        # production build in dist/
```

## Updating the Python simulator

With the RVCAT repository checked out next to this one (`../RVCAT`, or set
`RVCAT_DIR`), run:

```sh
npm run update-wheel
```

It builds the wheel with pip and copies it to `public/`. Commit the new wheel.

## Releasing

1. Push work in progress to `origin` (`git push origin main`) and check the
   testing site.
2. Bump `RVCAT_VERSION` in `src/common.js` and `version` in `package.json`
   (e.g. `1.15` and `1.15.0`) and commit. Users' saved data is cleared when the
   version changes.
3. Run `npm run release` (`npm run release -- --dry-run` to only run the checks).
   It verifies that both remotes are already contained in `main`, runs the
   version check, lint, tests and build, creates the tag `v<version>` and pushes
   `main` and the tag to `origin` and `hpca`.

GitHub Actions (`.github/workflows/deploy-pages.yml`) runs the same checks on
every push and pull request, and deploys to GitHub Pages on pushes to `main`.

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
