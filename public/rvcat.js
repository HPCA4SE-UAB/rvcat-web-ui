/* ------------------------------------------------------------------ 
 * Read files from distribution folders & manage localStorage
 * ------------------------------------------------------------------ */

async function loadJSONfile(name) {
  try {
    const response = await fetch(name)
    const data     = await response.json()
    console.log('File read: ', name, data)
    return data
  } catch (error) {
    console.error(`Failed to load ${name}:`, error)
    throw error
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
    svg.style.width  = "100%"
    svg.style.height = "100%"
    svg.style.maxWidth = "100%"
    svg.style.maxHeight = "100%"
    svg.style.display = "block"
  
    return svg;
    } catch(error) {
      console.error("Error rendering graph:", error);
      throw error;
    }
}
