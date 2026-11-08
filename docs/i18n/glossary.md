# RVCAT glossary: English · Español · Català

**Keep** = the English term is used in the three languages (proposal, to be confirmed).
**Translate** = the Spanish and Catalan terms are used. For the terms kept in English, the
translations are given anyway, so that they can be changed.

Not translated in any case: the instruction texts (`if c go back`, `if c skip k`), the names of
types and operations (`FLOAT.ADD`, `VMEM.LOAD`...), the timeline symbols (D, E, W, R...), the program
code (C) and the files in `docs/`.

## 1. Processor and pipeline

| # | English | Proposal | Español | Català | Note |
|---|---|---|---|---|---|
| 1 | processor | Translate | procesador | processador | |
| 2 | pipeline | Translate | segmentación / pipeline | segmentació / pipeline | Only in help texts |
| 3 | dispatch (width) | **Keep** | emisión | emissió | Name of a row of the diagram |
| 4 | issue | **Keep** | lanzamiento | llançament | "issue width" in the timeline |
| 5 | retire (width) | **Keep** | retiro | retirada | Name of a row of the diagram |
| 6 | ROB (reorder buffer) | **Keep** | búfer de reordenación | memòria de reordenació | |
| 7 | in flight (instructions) | Translate | en vuelo | en vol | |
| 8 | execution port (P0, P1...) | Translate | puerto de ejecución | port d'execució | "P0" is kept |
| 9 | operation type | Translate | tipo de operación | tipus d'operació | |
| 10 | latency | Translate | latencia | latència | |
| 11 | scheduler | Translate | planificador | planificador | Simulation option |
| 12 | optimal / greedy | **Keep** | óptimo / voraz | òptim / voraç | Values of the Scheduler option |
| 13 | waiting buffer | Translate | búfer de espera | memòria d'espera | |

## 2. Memory and cache

| # | English | Proposal | Español | Català | Note |
|---|---|---|---|---|---|
| 14 | cache | **Keep** | caché | memòria cau | |
| 15 | block (cache block) | Translate | bloque | bloc | |
| 16 | cache miss | Translate | fallo (de cache) | fallada (de cache) | |
| 17 | primary / secondary miss | Translate | fallo primario / secundario | fallada primària / secundària | |
| 18 | miss penalty | Translate | penalización por fallo | penalització per fallada | |
| 19 | issue time (of misses) | Translate | tiempo entre peticiones | temps entre peticions | |
| 20 | fill buffer / write buffer | **Keep** | búfer de llenado / de escritura | memòria d'emplenat / d'escriptura | |
| 21 | return throughput | **Keep** | — | — | Parameter name |
| 22 | Main Memory (MM) | Translate | memoria principal (MM) | memòria principal (MM) | "MM" is kept |
| 23 | load / store | **Keep** | lectura / escritura | lectura / escriptura | Also the names of the operations |
| 24 | dirty / clean block | Translate | bloque modificado / limpio | bloc modificat / net | |
| 25 | prefetch / pollution | Translate | precarga / contaminación | precàrrega / contaminació | |

## 3. Performance analysis

| # | English | Proposal | Español | Català | Note |
|---|---|---|---|---|---|
| 26 | throughput | **Keep** | productividad | productivitat | |
| 27 | throughput bound | Translate | cota de throughput | cota de throughput | Follows #26 |
| 28 | latency bound | Translate | cota de latencia | cota de latència | |
| 29 | latency-bound / throughput-bound | Translate | limitado por latencia / por throughput | limitat per latència / per throughput | |
| 30 | minimum time | Translate | tiempo mínimo | temps mínim | |
| 31 | bottleneck | Translate | cuello de botella | coll d'ampolla | |
| 32 | critical path | Translate | camino crítico | camí crític | |
| 33 | data dependence | Translate | dependencia de datos | dependència de dades | |
| 34 | cyclic (dependence) chain | Translate | cadena cíclica (de dependencias) | cadena cíclica (de dependències) | |
| 35 | dependence graph | Translate | grafo de dependencias | graf de dependències | |
| 36 | timeline | **Keep** | cronograma | cronograma | Name of a panel |
| 37 | static analysis | Translate | análisis estático | anàlisi estàtica | Name of a panel |
| 38 | IPC, CPI | **Keep** | — | — | |
| 39 | cycles/iter | **Keep** | ciclos/iter | cicles/iter | Units in tables |
| 40 | speedup | **Keep** | aceleración | acceleració | |
| 41 | usage (of a resource) | Translate | uso | ús | |

## 4. Programs and loops

| # | English | Proposal | Español | Català | Note |
|---|---|---|---|---|---|
| 42 | loop / iteration | Translate | bucle / iteración | bucle / iteració | |
| 43 | loop stride (S) | Translate | paso del bucle (S) | pas del bucle (S) | |
| 44 | algorithmic operation | Translate | operación algorítmica | operació algorísmica | "Cycles/Alg Oper" is kept in tables |
| 45 | memory stride | **Keep** | — | — | Column "Stride" |
| 46 | lanes | Translate | carriles (lanes) | carrils (lanes) | |
| 47 | vector register | Translate | registro vectorial | registre vectorial | |
| 48 | unroll / vectorize | Translate | desenrollar / vectorizar | desenrotllar / vectoritzar | |
| 49 | SIMD, AVX, SSE | **Keep** | — | — | |
| 50 | shuffle / permute | **Keep** | — | — | Names of operations |
| 51 | reduction / accumulator | Translate | reducción / acumulador | reducció / acumulador | |
| 52 | read-only (variable) | Translate | de solo lectura | només de lectura | |
| 53 | declarations | Translate | declaraciones | declaracions | |

## 5. Branches and speculation

| # | English | Proposal | Español | Català | Note |
|---|---|---|---|---|---|
| 54 | conditional branch | Translate | salto condicional | salt condicional | |
| 55 | branch prediction | Translate | predicción de saltos | predicció de salts | |
| 56 | misprediction / mispredicted | Translate | predicción errónea / mal predicho | predicció errònia / mal predit | "Mispred/iter" is kept in tables |
| 57 | branch penalty | Translate | penalización por salto | penalització per salt | |
| 58 | wrong path / squash | Translate | camino erróneo / anular | camí erroni / anul·lar | |
| 59 | stall / wrong path (option) | **Keep** | — | — | Values of the Mispredictions option |
| 60 | resolution (of a branch) | Translate | resolución | resolució | |

## 6. Tutorials and lessons

| # | English | Proposal | Español | Català | Note |
|---|---|---|---|---|---|
| 61 | tutorial / card | Translate | tutorial / tarjeta | tutorial / targeta | |
| 62 | lesson / task / goal | Translate | lección / tarea / objetivo | lliçó / tasca / objectiu | |
| 63 | prediction | Translate | predicción | predicció | |
| 64 | Show me | Translate | Muéstramelo | Mostra-m'ho | Button of the cards |
| 65 | In depth | Translate | En detalle | En detall | |
| 66 | completion code | Translate | código de finalización | codi de finalització | |
