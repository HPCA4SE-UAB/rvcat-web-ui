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

function insert_cache_annotations(cache) {
  if (cache.nBlocks>0){
     document.getElementById('cache-info').innerHTML=`
      <b>Cache:</b><span>${cache.nBlocks} blocks of ${cache.blkSize} bytes. Miss penalty: ${cache.mPenalty}. Miss Issue time: ${cache.mIssueTime}</span>`;
  }
  else {
     document.getElementById('cache-info').innerHTML="<b>Processor does not simulate a cache memory.</b>";
  }
}

async function getProcessorGraph(processorInfo) {
  try {
    const dotCode = construct_reduced_processor_dot(
       processorInfo.stages.dispatch,
       Object.keys(processorInfo.ports).length, 
       processorInfo.stages.retire,  
       {
          'nBlocks':    processorInfo.nBlocks,
          'blkSize':    processorInfo.blkSize,
          'mPenalty':   processorInfo.mPenalty,
          'mIssueTime': processorInfo.mIssueTime
       }
    );
    const svg = await createGraphVizGraph(dotCode);  
    return svg;
    
  } catch (error) {
    throw error;
  }
}

async function getTimeline(num_iters, rob_size) {
    let controls = document.getElementById('dependencies-controls');
}

////////////////////////////////////////
////  Helping functions  ///////////////
////////////////////////////////////////

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
