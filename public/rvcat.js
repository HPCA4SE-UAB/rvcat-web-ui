/* ------------------------------------------------------------------ 
 * Read files from distribution folders & manage localStorage
 * ------------------------------------------------------------------ */

async function loadJSONfile(name, icon) {
  try {
    const response = await fetch(name)
    const data     = await response.json()
    console.log(`${icon}📥 loadJSONfile: ${name}`)
    return data
  } catch (error) {
    console.error(`${icon}❌ loadJSONfile: failed to load ${name}:`, error)
    throw error
  }
}

async function downloadJSON( name, JSONstring) {
  // force a Save As... dialog if API is supported
  if (window.showSaveFilePicker) {
     const handle = await window.showSaveFilePicker({
       suggestedName: `${name}.json`,
       types: [{
         description: 'JSON files',
         accept: { 'application/json': ['.json'] }
       }],
     });
     const writable = await handle.createWritable();
     await writable.write(JSONstring);
     await writable.close();
  } else {
    // fallback: traditional anchor download
    const blob = new Blob([JSONstring], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${name}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
  
function getKeys(name) {
  const allKeys = [] 
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key.startsWith(`${name}.`)) {
      const suffix = key.substring(`${name}.`.length)
      allKeys.push(suffix)
    }
  }
  return allKeys
}

// Init Programs/Processors/Tutorials
const initResource = async ({resourceName, logPrefix, optionsObj, currentKey, availableKey, errorHandler = null }) => {
  console.log(`${logPrefix}🔄 Loading ${resourceName}s ...`);

  try {
    let keys = getKeys(resourceName);
    if (keys.length === 0) {
      const response = await fetch('./index.json');
      const data     = await response.json();
      const fileList = data[resourceName];
      if (!fileList) {
        throw new Error(`No ${resourceName} found in index.json`);
      }
      for (const fileName of fileList) {
        const filedata = await loadJSONfile(`./${resourceName}/${fileName}.json`, logPrefix);
        localStorage.setItem(`${resourceName}.${fileName}`, JSON.stringify(filedata));
      }
      
      keys = getKeys(resourceName);
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceName}s from distribution files`);
    } else {
      console.log(`${logPrefix}✅ Loaded ${keys.length} ${resourceName}s from localStorage`);
    }
    optionsObj[availableKey] = keys;
    if (currentKey && !keys.includes(optionsObj[currentKey])) {
      optionsObj[currentKey] = keys[0];
    }
  } catch (error) {
    console.error(`${logPrefix}❌ Failed to load ${resourceName}s:`, error); 
    if (errorHandler) errorHandler(error);
  }
};

async function createGraphVizGraph(dotCode) {
  try {
    const viz = new Viz();
    const svg = await viz.renderSVGElement(dotCode, { engine: "dot" })

    // 🔧 Make SVG responsive
    const width  = svg.getAttribute("width")
    const height = svg.getAttribute("height")

    if (!svg.getAttribute("viewBox") && width && height) {
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    }

    svg.removeAttribute("width")
    svg.removeAttribute("height")
    svg.style.width     = "100%"
    svg.style.height    = "100%"
    svg.style.maxWidth  = "100%"
    svg.style.maxHeight = "100%"
    svg.style.display   = "block"
  
    return svg;
    } catch(error) {
      console.error("🕸️❌ GraphVizGraph: rendering error.", error);
      throw error;
    }
}
