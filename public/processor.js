  function insert_cache_annotations(cache) {
    if(cache.nBlocks>0){
      document.getElementById('cache-info').innerHTML=`
      <b>Cache:</b><span>${cache.nBlocks} blocks of ${cache.blkSize} bytes. Miss penalty: ${cache.mPenalty}. Miss Issue time: ${cache.mIssueTime}</span>`;
    }
    else {
      document.getElementById('cache-info').innerHTML="<b>Processor does not simulate a cache memory.</b>";
    }
  }

  function construct_reduced_processor_dot(dispatch_width, num_ports, retire_width, cache) {
    insert_cache_annotations(cache)
    let dot_code = `
    digraph "Processor Pipeline Graph" {
      rankdir=TB;
      node [fontsize=14, fontname="Arial"];

      Fetch [
        shape=point
        width=0
        height=0
        fixedsize=true
        label=""
        margin=0
        style=invis
      ];
    `;

    // --- FETCH  ---
    dot_code += `  Fetch [style=invis, shape=box, height=0, width=0];\n`;
    dot_code += `
      Fetch -> "Waiting Buffer" [
        label="Dispatch = ${dispatch_width}",
        fontsize=14, fontname="Arial"
      ];
    `;

    // --- WAITING BUFFER ---
    dot_code += `"Waiting Buffer" [label="Waiting\\nBuffer", shape=box, height=1, width=1, fixedsize=true];\n`;

    // --- EXECUTE PORTS ---
    dot_code += `subgraph cluster_execute {
        rankdir=TB;
        node [shape=box3d, height=0.4, width=0.6, fixedsize=true];
    `;

    let shown_ports = [];
    if (num_ports >= 4) {
      shown_ports = [0, 1, 2, num_ports - 1];

      dot_code += `P${num_ports - 1} [label="P${num_ports - 1}"];\n`;
      if (num_ports > 4) {
        dot_code += `"..." [label="..."];\n`;
      }
      dot_code += `P2 [label="P2"];\n`;
      dot_code += `P1 [label="P1"];\n`;
      dot_code += `P0 [label="P0"];\n`;
    } else {
      for (let i = num_ports - 1; i >= 0; i--) {
        shown_ports.push(i);
        dot_code += `P${i} [label="P${i}"];\n`;
      }
    }

    dot_code += `}\n`;

    for (let idx = 0; idx < shown_ports.length; idx++) {
      dot_code += `"Waiting Buffer" -> P${shown_ports[idx]};\n`;
    }
    if(num_ports>4){
      dot_code += `"Waiting Buffer" -> "..." [style=invis];\n`;
    }
    // REGISTERS
    dot_code += `Registers [shape=box, height=1, width=1, fixedsize=true];\n`;

    dot_code += `
    {
      rank=same;
      Fetch;
      "Waiting Buffer";
    `;

    if (num_ports >= 4) {
      dot_code += `P0; P1; P2;\n`;

      if (num_ports > 4) {
        dot_code += `"...";\n`;
      }
      dot_code += `P${num_ports - 1};\n`;
    } else {
      for (let i = 0; i < shown_ports.length; i++) {
        dot_code += `P${shown_ports[i]};\n`;
      }
    }

    dot_code += `Registers;\n  }\n`;

    // --- ROB ---
    dot_code += `ROB [label="ROB: ${document.getElementById('rob-size').value} entries", shape=box, height=0.6, width=5, fixedsize=true];\n`;
    dot_code += `{ rank=sink; ROB; }\n\n`;

    dot_code += `Fetch -> ROB;\n`;
    for (let i = 0; i < shown_ports.length; i++) {
      dot_code += `P${shown_ports[i]} -> ROB;\n`;
    }
    dot_code += `
      ROB -> Registers [
        label="Retire = ${retire_width}",
        fontsize=14, fontname="Arial"
      ];
    `;

    dot_code += `}\n`;
    return dot_code;
  }


function construct_full_processor_dot(dispatch_width, num_ports, retire_width, usage = null) {
  let dot_code = `
  digraph "Processor Pipeline Graph"{
    rankdir=TB;
    node [fontsize=14, fontname="Arial"];
  `;

  // Colorscale from white to red
  const color = [
    "#ffffff",
    "#eaffea",
    "#d5ffd5",
    "#c0ffc0",
    "#aaffaa",
    "#95ff95",
    "#80ff80",
    "#7ffb6e",
    "#86f55d",
    "#96ee4d",
    "#abe63d",
    "#bfde2d",
    "#d4d51e",
    "#e6ca11",
    "#f2bb07",
    "#f8a800",
    "#f18c00",
    "#ea7000",
    "#e35400",
    "#dc3800",
    "#d51c00",
    "#ce0000"
  ];

  let dispatch_color = color[Math.floor(usage.dispatch/5)];
  // --- FETCH ---
  dot_code += `Fetch [
        shape=point
        width=0
        height=0
        fixedsize=true
        label=""
        margin=0
        style=invis
      ];`;

  dot_code += `
    Fetch -> "Waiting Buffer" [
      label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" BGCOLOR="${dispatch_color}"><TR><TD>Dispatch = ${dispatch_width} (${usage.dispatch.toFixed(1)}%)</TD></TR></TABLE>>,
      fontsize=14,
      fontname="Arial",
      tooltip="Usage: ${usage.dispatch.toFixed(1)}%"
    ];
  `;


  // --- WAITING BUFFER ---
  dot_code += `  "Waiting Buffer" [label="Waiting\\nBuffer", shape=box, height=1.2, width=1.2, fixedsize=true];\n`;

  dot_code += `subgraph cluster_execute {
      rankdir="TB";
  `
  for (let i = num_ports-1; i >= 0; i--) {
    if (usage !== null && usage.ports[i]!==0.0) {
        let execute_color = color[Math.floor(usage.ports[i] / 5)];
        dot_code += `P${i} [shape=box3d,height=0.2,width=0.4, style=filled, fillcolor="${execute_color}", tooltip="Usage: ${usage.ports[i].toFixed(1)}%"];\n`
    } else {
        dot_code += `P${i} [shape=box3d,height=0.2,width=0.4, tooltip="Usage: 0.0%"];\n`
    }
    dot_code += `"Waiting Buffer" -> P${i};\n`;
  }

  dot_code += `label = "Execute";\n
  fontname="Arial";
  fontsize=12;
  }\n`

  dot_code += `  Registers [shape=box, height=1.2, width=1.2, fixedsize=true];\n`;

  // Align top row
  dot_code += `
    {
      rank=same;
      Fetch;
      "Waiting Buffer";
      ${[...Array(num_ports).keys()].map(i => `P${i}`).join("; ")};
      Registers;
    }
  `;

  // --- ROB ---
  dot_code += `
    ROB [label="ROB: ${document.getElementById('rob-size').value} entries", shape=box, height=0.6, width=5, fixedsize=true];
    {
      rank=sink;
      ROB;
    }
  `;

  dot_code += `  Fetch -> ROB;\n`;
  for (let i = 0; i < num_ports; i++) {
    dot_code += `  P${i} -> ROB;\n`;
  }

  let retire_color = color[Math.floor(usage.retire/5)];
  dot_code += `
    ROB -> Registers [
      label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" BGCOLOR="${retire_color}"><TR><TD>Retire = ${retire_width} (${usage.retire.toFixed(1)}%)</TD></TR></TABLE>>,
      fontsize=14,
      fontname="Arial",
      tooltip="Usage: ${usage.retire.toFixed(1)}%"
    ];
  `;

  dot_code += `}`;

  return dot_code;
}


// OLD PROCESSOR PIPELINE GRAPH
/*function construct_full_processor_dot(dispatch_width, num_ports, retire_width, usage=null) {
  let dot_code = PROCESSOR_GRAPH_PREAMBLE;

  // Colorscale from green to red
  let color = [
      "#00FF00",
      "#33FF00",
      "#66FF00",
      "#99FF00",
      "#CCFF00",
      "#FFFF00",
      "#FFCC00",
      "#FF9900",
      "#FF6600",
      "#FF3300",
      "#FF0000"
  ];

  console.log("Usage:");
  console.log(usage);

  // --- DISPATCH ---
  dot_code += `
  node [fontsize=8, fontname="Arial"];
  Fetch[style=invis,shape=box,height=0.6, width=0.1]
  `
  if (usage !== null) {
      let dispatch_color = color[Math.floor(usage.dispatch / 10)];
      dot_code += `Dispatch[shape=box,height=0.6,width=0.6,label="Dispatch\nw=${dispatch_width}\n", style=filled, fillcolor="${dispatch_color}", tooltip="Usage: ${usage.dispatch.toFixed(1)}%"]\n`
  } else {
      dot_code += `Dispatch[shape=box,height=0.6,width=0.6,label="Dispatch\nw=${dispatch_width}"]\n`
  }
  for (let i = 0; i < dispatch_width; i++) {
      dot_code += `Fetch:e${i} -> Dispatch:w${i}\n`
  }

  // --- EXECUTE ---
  dot_code += `subgraph cluster_execute {
      rankdir="LR";
  `
  for (let i = 0; i < num_ports; i++) {
      if (usage !== null && usage.ports[i]!==0.0) {
          let execute_color = color[Math.floor(usage.ports[i] / 10)];
          dot_code += `P${i} [shape=box3d,height=0.2,width=0.4, style=filled, fillcolor="${execute_color}", tooltip="Usage: ${usage.ports[i].toFixed(1)}%"];\n`
      } else {
          dot_code += `P${i} [shape=box3d,height=0.2,width=0.4, tooltip="Usage: 0.0%"];\n`
      }
  }

  dot_code += `label = "Execute";\n
  fontname="Arial";
  fontsize=12;
  }\n`

  for (let i=0; i<num_ports; i++) {
      dot_code += `Dispatch:e${i} -> P${i}\n`
  }

  // --- WRITEBACK ---
  dot_code += `
  WriteBack[shape=box,height=0.6,width=0.6,label="Write Back\nw=${num_ports}"]
  `
  for (let i = 0; i < num_ports; i++) {
      dot_code += `P${i}:e -> WriteBack:w${i}\n`
  }

  // --- RETIRE ---
  if (usage !== null) {
      let retire_color = color[Math.floor(usage.retire / 10)];
      dot_code += `Retire[shape=box,height=0.6,width=0.6,label="Retire\nw=${retire_width}", style=filled, fillcolor="${retire_color}", tooltip="Usage: ${usage.retire.toFixed(1)}%"]`
  } else {
      dot_code += `Retire[shape=box,height=0.6,width=0.6,label="Retire\nw=${retire_width}"]`
  }

  dot_code += `
  Ret[style=invis,shape=box,height=1.5,width=0.1]
  `
  for (let i = 0; i < num_ports; i++) {
      dot_code += `WriteBack:e${i} -> Retire:w${i}\n`
  }
  for (let i = 0; i < retire_width; i++) {
      dot_code += `Retire:e${i} -> Ret:w${i}\n`
  }

  return dot_code + `}`
}
*/
