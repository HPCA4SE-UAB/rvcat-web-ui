
export const instructionTypes = ['INT', 'VINT', 'MEM', 'VMEM', 'FLOAT', 'VFLOAT','BRANCH'];

export const typeOperations = {
    'INT':    ['ARITH', 'LOGIC', 'SHIFT'],
    'VINT':   ['ARITH', 'LOGIC', 'SHIFT'],
    'MEM':    ['STORE', 'LOAD'],
    'VMEM':   ['STORE', 'LOAD'],
    'FLOAT':  ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT'],
    'VFLOAT': ['ADD', 'MUL', 'FMA', 'DIV', 'SQRT'],
    'BRANCH': []
  };

export const typeSizes = {
    'INT':    ['byte', 'word', 'long'],
    'VINT':   ['byte', 'word', 'long'],
    'MEM':    ['byte', 'word', 'long'],
    'VMEM':   [],
    'FLOAT':  ['single', 'double'],
    'VFLOAT': ['single', 'double'],
    'BRANCH': []
  };

export function charToProcessingState(ch, port, addr) {
  if (port != null) {
    if (ch === "L")
      return `Load from address ${addr}, port P${port}`
    else if (ch === "S")
      return `Store to address ${addr}, port P${port}`
    else
      return `Execution issued to port P${port}`
  }
  switch (ch) {
    case "E": return "Execution continues on pipeline";
    case "L": return "Load operation running";
    case "S": return "Store operation running";
    case "R": return "Retire: write to architected register";
    case "D": return "Dispatch: enter execution engine";
    case "-": return "Waiting for older instructions to retire ";
    case "W": return "Write back result on ROB";
    case ".": return "Waiting due to data dependencies";
    case "*": return "Waiting due to port collision";
    case "#": return "Main Memory receiving request";
    case ":": return "Waiting for data block from MM";
    case "!": return "Cache miss: waiting to send MM read request";
    case "2": return "Secondary cache miss";
    case "U": return "Cache block Update: send write request to MM";
    default:  return null;
  }
}

export const resourceConfig = {
  processor: {
    storagePrefix: 'processor',
    resourceName:  'processor configuration',
    logPrefix:     '💻'
  },
  program: {
    storagePrefix: 'program',
    resourceName:  'program',
    logPrefix:     '📄'
  },
  tutorial: {
    storagePrefix: 'tutorial',
    resourceName:  'tutorial',
    logPrefix:     '👨‍🎓'
  },
  timeline: {
    storagePrefix: 'timeline',
    resourceName:  'timeline',
    logPrefix:     '📈'
  },
  result: {
    storagePrefix: 'results',
    resourceName:  'results',
    logPrefix:     '🕐'
  }
};

export function updateProcess(process) {

  const { latencies, ports, instruction_list } = process

  // 🔹 Precalcular mapa op → bitmask
  const opToMask = {}

  Object.entries(ports).forEach(([portIdStr, supportedOps]) => {

    const portId = Number(portIdStr)
    const bit    = (1 << portId)

    supportedOps.forEach(op => {
      if (!opToMask[op]) opToMask[op] = 0
      opToMask[op] |= bit
    })
  })

  // 🔹 Recalcular cada instrucción
  instruction_list.forEach(instr => {

    const keyFull  = `${instr.type}.${instr.oper}.${instr.size}`
    const keyOp    = `${instr.type}.${instr.oper}`
    const keyType  = instr.type

    // Latency
    instr.latency =
      latencies[keyFull] ??
      latencies[keyOp]   ??
      latencies[keyType] ??
      1

    // Ports
    instr.ports =
      opToMask[keyOp] ??
      opToMask[keyType] ??
      0

    if (instr.ports === 0) {
      console.warn(`⚠️ No ports found for instruction ${instr.id} (${keyOp}). Check processor configuration.`)
    }
  })
}

/**
 * @param {Object} data +  @param {String} filename + @param {String} resourceType
 */
export async function downloadJSON(data, filename, resourceType) {
  try {
    const jsonString   = JSON.stringify(data, null, 2);
    const config       = resourceConfig[resourceType];
    const fullFilename = `${filename}.json`;

    // File System Access API -> force a Save As...
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fullFilename,
        types: [{
          description: 'JSON files',
          accept: { 'application/json': ['.json'] }
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
    } else {
      // Fallback: traditional anchor download
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    console.log(`${config?.logPrefix}💾✅ Downloaded ${config?.resourceName}: ${filename}`);
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(`${resourceConfig[resourceType]?.logPrefix}💾❌ Failed to download:`, error);
    }
    return false;
  }
}

/**
 * uploadJSON  @param {Function} onSuccess (Callback) @param {String} resourceType
 *             @returns {Promise<Object|null>}
 */
export async function uploadJSON(onSuccess, resourceType) {
  return new Promise((resolve) => {
    const input         = document.createElement('input');
    input.type          = 'file';
    input.accept        = 'application/json';
    input.style.display = 'none';

    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.name && !data.id) {
          alert(`The JSON file must contain a 'name' or 'id' field.`);
          resolve(null);
          return;
        }

        const config = resourceConfig[resourceType];
        console.log(`${config?.logPrefix}📥✅ Uploaded ${config?.resourceName}:`, data.name || data.id);

        if (onSuccess)
          onSuccess(data, file.name.replace(/\.[^.]+$/, ''));
        resolve(data);
      } catch (error) {
        console.error(`${resourceConfig[resourceType]?.logPrefix}📥❌ Failed to upload&parse JSON:`, error);
        alert('Could not load JSON file. Please check the file format.');
        resolve(null);
      }
    };

    document.body.appendChild(input);
    input.click();
    setTimeout(() => document.body.removeChild(input), 1000);
  });
}

/**
 * saveToLocalStorage @param {String} resourceType + @param {String} id + @param {Object} data + @param {Array} availableList
 *                @returns {Boolean} True si se guardó exitosamente
 */
export function saveToLocalStorage(resourceType, id, data, availableList) {
  try {
    const config = resourceConfig[resourceType];
    if (!config) {
      console.error(`Unknown resource type: ${resourceType}`);
      return false;
    }

    const key        = `${config.storagePrefix}.${id}`;
    const jsonString = JSON.stringify(data, null, 2);
    localStorage.setItem(key, jsonString);

    // Update available list
    if (availableList && !availableList.includes(id)) {
      availableList.push(id);
    }

    console.log(`${config.logPrefix}✅ Saved ${config.resourceName}: ${id}`);
    return true;
  } catch (error) {
    console.error(`${resourceConfig[resourceType]?.logPrefix}❌ Failed to save to localStorage:`, error);
    return false;
  }
}

/**
 * removeFromLocalStorage @param {String} resourceType + @param {String} id + @param {Array} availableList
 *          @returns {Boolean} True si se eliminó exitosamente
 */
export function removeFromLocalStorage(resourceType, id, availableList) {
  try {
    const config = resourceConfig[resourceType];
    if (!config) {
      console.error(`Unknown resource type: ${resourceType}`);
      return false;
    }

    const key = `${config.storagePrefix}.${id}`;
    localStorage.removeItem(key);

    // Remover de la lista de disponibles
    if (availableList) {
      const index = availableList.indexOf(id);
      if (index > -1) {
        availableList.splice(index, 1);
      }
    }

    // Delete related keys
    const relatedKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey.startsWith(`${key}.`)) {
        relatedKeys.push(storageKey);
      }
    }

    relatedKeys.forEach(relatedKey => {
      localStorage.removeItem(relatedKey);
      console.log(`${config.logPrefix}🗑️ Removed related: ${relatedKey}`);
    });

    console.log(`${config.logPrefix}🧹 Removed ${config.resourceName}: ${id}`);
    return true;
  } catch (error) {
    console.error(`${resourceConfig[resourceType]?.logPrefix}❌ Failed to remove from localStorage:`, error);
    return false;
  }
}

/**
 * loadFromLocalStorage   @param {String} resourceType + @param {String} id
 *       @returns {Object|null}
 */
export function loadFromLocalStorage(resourceType, id) {
  try {
    const config = resourceConfig[resourceType];
    if (!config) {
      console.error(`Unknown resource type: ${resourceType}`);
      return null;
    }

    const key        = `${config.storagePrefix}.${id}`;
    const jsonString = localStorage.getItem(key);

    if (!jsonString) return null;

    const data = JSON.parse(jsonString);
    console.log(`${config.logPrefix}📥 Loaded ${config.resourceName}: ${id}`);
    return data;
  } catch (error) {
    console.error(`${resourceConfig[resourceType]?.logPrefix}❌ Failed to load from localStorage:`, error);
    return null;
  }
}

function getResourceKeys(prefix) {
  const keys = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(prefix)) {
      const id = key.substring(prefix.length);
      keys.push(id);
    }
  }

  return keys;
}

/* ------------------------------------------------------------------
 * Initialize Programs/Processors/Tutorials resources using data from
 *  distribution files if not already in localStorage
 * ------------------------------------------------------------------ */
export async function initResource (resourceType, optionsObj, currentKey, availableKey) {
  const config = resourceConfig[resourceType];
  if (!config) {
    console.error(`Unknown resource type: ${resourceType}`);
    return
  }
  const storagePrefix = config.storagePrefix;
  const logPrefix     = config.logPrefix;

  console.log(`${logPrefix}🔄 Loading ${resourceType}s ...`);
  try {
    let keys = getResourceKeys(`${storagePrefix}.`);
    if (keys.length === 0) {
      const response = await fetch('./index.json');
      const data     = await response.json();
      const fileList = data[storagePrefix];
      if (!fileList) {
        console.log(`No ${storagePrefix} found in index.json`);
        keys = []
      } else {
        for (const fileName of fileList) {
          const name     = `./${storagePrefix}/${fileName}.json`;
          const response = await fetch(name)
          const filedata = await response.json()
          console.log(`${logPrefix}📥 loadJSONfile: ${name}`)
          localStorage.setItem(`${storagePrefix}.${fileName}`, JSON.stringify(filedata));
        }
        keys = getResourceKeys(`${storagePrefix}.`);
        console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from distribution files`);
      }
    } else {
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceType}s from localStorage`);
    }
    optionsObj[availableKey] = keys;
    if (currentKey && !keys.includes(optionsObj[currentKey])) {
      optionsObj[currentKey] = keys[0];
    }
  } catch (error) {
    console.error(`${logPrefix}❌ Failed to load ${resourceType}s:`, error);
  }
};

/* ------------------------------------------------------------------
 * GraphViz conversion to SVG
 * ------------------------------------------------------------------ */
export async function createGraphVizGraph(dotCode) {
  try {
    const viz = new Viz();

    const svg = await viz.renderSVGElement(dotCode, { engine: "dot" })

    // Make SVG responsive
    let width  = svg.getAttribute("width")
    let height = svg.getAttribute("height")

    if (!svg.getAttribute("viewBox") && width && height) {

      // quitar unidades como "pt"
      width  = parseFloat(width)
      height = parseFloat(height)

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    }

    // dejar que CSS controle el tamaño
    svg.removeAttribute("width")
    svg.removeAttribute("height")
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet")

    return svg;
    } catch(error) {
      console.error("🕸️❌ GraphVizGraph: rendering error.", error);
      throw error;
    }
}

export function fitSvgToContainer(svg, container) {

  const vb        = svg.viewBox.baseVal
  const svgWidth  = vb.width
  const svgHeight = vb.height

  const containerWidth  = container.clientWidth
  const containerHeight = container.clientHeight

  const scale = Math.min(
    containerWidth  / svgWidth,
    containerHeight / svgHeight
  )

  svg.style.transformOrigin = "top left"
  svg.style.transform = `scale(${scale})`

  // ajustar tamaño del wrapper para centrar
  svg.style.width  = svgWidth + "px"
  svg.style.height = svgHeight + "px"
}

export function get_processor_dot(process, highlightPort = -1) {

    const ports    = process.ports
    const lat      = process.latencies
    const port_ids = Object.keys(ports)
    const ROBsize  = process.ROBsize || 20
    const sched    = process.sched
    const dispatch = process.dispatch || 1
    const retire   = process.retire || 1
    const CachePenalty   = process.mPenalty || 1
    const CacheIssueTime = process.mIssueTime || 1
    const CacheBlocks    = process.nBlocks || 0
    const CacheBlockSize = process.blkSize || 32

    function type_color(type) {
      if (type === "INT")    return "#d6e4ff"
      if (type === "MEM")    return "#d6ffd6"
      if (type === "FLOAT")  return "#fff2b3"
      if (type === "VINT")   return "#e6e4ff"
      if (type === "VMEM")   return "#e6ffd6"
      if (type === "VFLOAT") return "#eff2b3"
      if (type === "BRANCH") return "#ffd6d6"
      return "#f0f0f0"
    }

    function op_type(op) {
      return op.split(".")[0]
    }

    function latency_tooltip(op) {

      const base = lat[op]

      const variants = Object.keys(lat)
        .filter(k => k.startsWith(op + "."))

      if (variants.length === 0)
        return base !== undefined ? `${op} latency: ${base}` : ""

      let txt = `${op} latencies:\n`

      if (base !== undefined)
        txt += `base: ${base}\n`

      for (let v of variants)
        txt += `${v}: ${lat[v]}\n`

      return txt
    }

    function compress_ops(ops) {
      const grouped = {}
      for (let op of ops) {
        const [type, sub] = op.split(".")
        if (!grouped[type]) grouped[type] = new Set()
        if (sub) grouped[type].add(sub)
      }

      const result = []
      for (let type in grouped) {
        const all_ops = typeOperations[type] || []
        if (all_ops.length === 0 || grouped[type].size === all_ops.length) {
          result.push({
            label: type,
            big: true
          })
        } else {
          for (let sub of grouped[type]) {
            result.push({
              label: `${type}.${sub}`,
              big: false
            })
          }
        }
      }
      return result
    }

    const highlight = highlightPort !== null && highlightPort !== undefined
      ? String(highlightPort)
      : null

    const port_ops = {}
    for (let p of port_ids)
      port_ops[p] = compress_ops(ports[p])

    const total_rows = Math.max(...Object.values(port_ops).map(o => o.length))

    // ---- Dispatch + ROB ----
    let decode_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="dispatch" TITLE="Edit dispatch width"><FONT POINT-SIZE="20">🔄&nbsp;<B>Dispatch:&nbsp;</B>&nbsp;${dispatch}/cycle</FONT></TD>
      <TD ROWSPAN="${total_rows+4}" BGCOLOR="#f0f0f0" HREF="#" ID="rob" TITLE="Edit ROB size" ALIGN="CENTER" VALIGN="MIDDLE"><FONT POINT-SIZE="20">🔄<BR/><BR/><B>ROB</B><BR/><BR/><B>${ROBsize}</B></FONT><BR/><FONT POINT-SIZE="16">entries</FONT></TD>
    </TR>`

    // ---- Waiting Buffer ----
    let schedLabel = "❌optimal ✅greedy"
    if (sched !== "greedy"){
      schedLabel = "✅optimal ❌greedy"
    }
    let wb_row = `<TR>
      <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="sched" TITLE="Toggle scheduler"><FONT POINT-SIZE="20"><B>Waiting Buffer</B></FONT>&nbsp;&nbsp;&nbsp;<FONT POINT-SIZE="16">Scheduler:&nbsp;</FONT><FONT POINT-SIZE="18"><B>${schedLabel}</B></FONT></TD>
    </TR>`

    // ---- Port headers ----
    let port_header = "<TR>"

    for (let p of port_ids) {
      const isHighlighted = (p === highlight)
      const style = isHighlighted
        ? ' BGCOLOR="#ffcccc" BORDER="1" COLOR="red"'
        : ' BGCOLOR="#f5f5f5"'

      port_header += `<TD ${style} HREF="#" ID="port:${p}" TITLE="Select port ${p}"><FONT POINT-SIZE="20"><B>P${p}</B></FONT></TD>`
    }

    port_header += "</TR>"

    // ---- Operation rows ----
    let op_rows = ""

    for (let i = 0; i < total_rows; i++) {

      op_rows += "<TR>"

      for (let p of port_ids) {
        const isHighlighted = (p === highlight)
        const highlightAttr = isHighlighted
          ? ' BORDER="1" COLOR="red"'
          : ''

        const op = port_ops[p][i]

        if (!op) {
          op_rows += `<TD ${highlightAttr}></TD>`
          continue
        }

        const type    = op_type(op.label)
        const color   = type_color(type)
        const tooltip = latency_tooltip(op.label)

        op_rows += `
          <TD BGCOLOR="${color}" TITLE="${tooltip}" HREF="#" ID="op:${p}:${i}:${op.label}" ${highlightAttr}><FONT POINT-SIZE="${op.big ? 16 : 14}">${op.big ? `<B>${op.label}</B>` : op.label}</FONT></TD>`
      }

      op_rows += "</TR>"
    }

    let cache_row = ""
    // ---- Cache configuration ----
    if (CacheBlocks > 0) {
      cache_row = `<TR>
        <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="cache" TITLE="Edit cache configuration"><FONT POINT-SIZE="20">🔄&nbsp;<B>Cache:</B>&nbsp;${CacheBlocks} blocks&nbsp;x&nbsp;${CacheBlockSize} bytes&nbsp;&nbsp;Penalty: ${CachePenalty}&nbsp;IssueTime: ${CacheIssueTime}</FONT></TD>
      </TR>`
    } else {
      cache_row = `<TR>
        <TD COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="cache" TITLE="Edit cache configuration"><FONT POINT-SIZE="20">🔄&nbsp;<B>Cache:</B>&nbsp;No cache</FONT></TD>
      </TR>`
    }

    // ---- Retire ----
    let reg_row = `<TR>
      <TD WIDTH="538" COLSPAN="${port_ids.length}" BGCOLOR="#eeeeee" HREF="#" ID="retire" TITLE="Edit retire width"><FONT POINT-SIZE="20">🔄&nbsp;<B>Retire:</B>&nbsp;${retire}/cycle&nbsp;&nbsp;<B>(Architected Registers)</B></FONT></TD>
    </TR>`

    const dot = `
      digraph CPU {
        node [shape=plain fontname="Arial" width=0 height=0 margin=0]
        pipeline [
          label=<
            <TABLE WIDTH="600" BORDER="2" CELLBORDER="1" CELLSPACING="2" CELLPADDING="1">
              ${decode_row}
              ${wb_row}
              ${port_header}
              ${op_rows}
              ${cache_row}
              ${reg_row}
            </TABLE>
          >
        ]
      }`

    return dot
  }
