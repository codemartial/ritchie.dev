const examples = [
  {
    id: "hello-ritchie",
    name: "Hello, Ritchie",
    source: `main() {
  log("Hello from Ritchie")
}
`,
  },
  {
    id: "values-and-interpolation",
    name: "Values and interpolation",
    source: `main() {
  Int answer = 6 * 7
  log(f"The answer is {answer}")
}
`,
  },
  {
    id: "fibonacci",
    name: "Fibonacci",
    source: `Fibonacci {
  Int[] memo = [0, 1]
}

Fibonacci.get(Int n) -> Int {
  return self.memo[n] handle OutOfRange! => {
    Int r = self.get(n-1) + self.get(n-2)
    self.memo = append(self.memo, r)
    return r
  }
}

main() {
  Fibonacci f = Fibonacci{}
  log(f.get(42))
}`,
  },
  {
    id: "implicit-errors",
    name: "Implicit Errors",
    source: `DebitFailed! {
  Int balance
  Int attempted
}

Wallet {
  Int balance
}

Wallet.debit(Int amt) {
  if self.balance < amt {
    return DebitFailed!{self.balance, amt}
  }
  self.balance = self.balance - amt
}

OrderId = Int // type alias

Logistics {}
Logistics.ship(OrderId o_id) {
    log(f"Shipped Order: o_id")
}

checkout(Wallet w, Int bill_amt) -> OrderId {
  w.debit(bill_amt)
  return 909
}

main() {
  Wallet w = Wallet{20}
  OrderId o_id = checkout(w, 22)
  Logistics.ship(o_id)
}
`,
  },
  {
    id: "service-endpoints",
    name: "Service Endpoints",
    source: `NoTable! {Int partySize }
OutOfBalance!
Wallet { Decimal limit}
Wallet.authorize(Decimal total) {
  if self.limit < total {
    return OutOfBalance!
  }
}

Booking {
  String guest
  String table
  Int partySize
  Time at
  Decimal total
}

Booking.summary() -> String {
  return f"{self.guest}: {self.table} for {self.partySize} at {self.at}, total {self.total}"
}

@Tables { }

@Tables.available() -> Int {
  return 6
}

@Tables.assign(Int partySize, Time requested) -> (String, Time) | NoTable! {
  if partySize > @Tables.available() {
    return NoTable! { partySize }
  }
  return "window table", requested
}

@Payment { }

@Payment.authorize(Decimal total, Wallet wallet) -> none | OutOfBalance! {
  wallet.authorize(total)
}

@Restaurant { }

@Restaurant.reserve(String guest, Int partySize, Time requested, Wallet wallet) -> Booking | NoTable! | OutOfBalance! | OutOfRange! {
  String table, Time at = @Tables.assign(partySize, requested)
  Decimal total = Decimal.fromInt(partySize) * 25.00
  @Payment.authorize(total, wallet)
  return Booking { guest, table, partySize, at, total }
}

main() {
  Booking booking = @Restaurant.reserve("Sam", 4, t19:30:00, Wallet { 120.00 })
  log(booking.summary())
  String table, Time at = @Tables.assign(8, t20:00:00) handle NoTable! => "waitlist", t20:00:00
  log(f"large party: {table} at {at}")
}
`,
  },
  {
    id: "error-handling",
    name: "Error Handling",
    source: `toByte(Int n) -> Byte {
  return Byte.fromInt(n)
}

main() {
  Int tooBig = 300
  Int missing = 9
  Byte[] malformed = [255]

  {
    Byte value = toByte(tooBig)
    Int[] numbers = [10, 20]
    Int chosen = numbers[missing]
    String text = String.fromBytes(malformed)
    log(value)
    log(chosen)
    log(text)
  } handle {
    OutOfRange!, toByte => resume 255
    OutOfRange! => resume 0
    any => resume "?"
  }
}
`,
  },
  {
    id: "rejected-program",
    name: "A rejected program",
    source: `main() {
  log(unknown)
}
`,
  },
];

const source = document.querySelector("#source");
const sourceHighlights = document.querySelector("#source-highlights");
const lineNumbers = document.querySelector(".line-number");
const lineNumberContent = document.querySelector("#line-number-content");
const examplePicker = document.querySelector("#examples");
const runButton = document.querySelector("#run");
const outcome = document.querySelector("#outcome");
const duration = document.querySelector("#duration");
const terminal = document.querySelector("#terminal");
const diagnostics = document.querySelector("#diagnostics");
const revision = document.querySelector("#revision");
const topologyPanel = document.querySelector("#topology-panel");
const topologyCanvas = document.querySelector("#topology-canvas");
const topologySummary = document.querySelector("#topology-summary");
const sourceLineHeightProbe = source.cloneNode(false);
sourceLineHeightProbe.removeAttribute("id");
sourceLineHeightProbe.removeAttribute("aria-label");
sourceLineHeightProbe.className = "source-line-height-probe";
sourceLineHeightProbe.setAttribute("aria-hidden", "true");
sourceLineHeightProbe.tabIndex = -1;
source.insertAdjacentElement("afterend", sourceLineHeightProbe);
let measuredSourceLineHeight;

for (const example of examples) {
  const option = document.createElement("option");
  option.value = example.id;
  option.textContent = example.name;
  examplePicker.append(option);
}
const requestedExample = new URLSearchParams(window.location.search).get("example");
const initialExample = examples.find((example) => example.id === requestedExample) || examples[0];
examplePicker.value = initialExample.id;
source.value = initialExample.source;
updateLineNumbers();

examplePicker.addEventListener("change", () => {
  const selectedExample = examples.find((example) => example.id === examplePicker.value);
  if (!selectedExample) return;
  source.value = selectedExample.source;
  updateExampleUrl(selectedExample.id);
  updateLineNumbers();
  clearSourceDiagnostics();
  source.focus();
});
source.addEventListener("input", () => {
  updateLineNumbers();
  clearSourceDiagnostics();
});
source.addEventListener("scroll", syncSourceHighlights);
source.addEventListener("keydown", handleEditorKeydown);
window.addEventListener("resize", resetSourceLineHeight);
document.fonts?.ready.then(resetSourceLineHeight);

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    run();
  }
});
runButton.addEventListener("click", run);

function updateExampleUrl(exampleId) {
  const url = new URL(window.location.href);
  url.searchParams.set("example", exampleId);
  window.history.replaceState(window.history.state, "", url);
}

async function run() {
  if (runButton.disabled) return;
  const apiUrl = window.RITCHIE_PLAYGROUND_CONFIG?.apiUrl?.replace(/\/$/, "");
  if (!apiUrl) {
    showServiceError("The playground API has not been configured. Copy web/config.js.example to web/config.js and set apiUrl.");
    return;
  }
  setPending(true);
  diagnostics.hidden = true;
  diagnostics.replaceChildren();
  clearSourceDiagnostics();
  clearTopology();
  terminal.textContent = "Running…";
  revision.textContent = "";
  duration.textContent = "";
  try {
    const response = await fetch(`${apiUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: source.value }),
    });
    if (response.status === 429) {
      throw new Error("The playground is busy. Wait a moment, then run the program again.");
    }
    if (!response.ok) {
      throw new Error(`The playground service returned HTTP ${response.status}.`);
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The playground service returned a malformed response.");
    }
    if (!validResult(result)) {
      throw new Error("The playground service returned a malformed response.");
    }
    renderResult(result);
  } catch (error) {
    showServiceError(error instanceof Error ? error.message : "The playground service is unavailable.");
  } finally {
    setPending(false);
  }
}

function validResult(value) {
  return value && typeof value.outcome === "string" &&
    typeof value.exitCode === "number" && typeof value.stdout === "string" &&
    typeof value.stderr === "string" && Array.isArray(value.diagnostics) &&
    typeof value.durationMs === "number" && typeof value.compilerRevision === "string" &&
    (value.topology === undefined || validTopology(value.topology));
}

function renderResult(result) {
  const labels = {
    completed: "Completed",
    rejected: "Source rejected",
    runtime_error: "Runtime error",
    timed_out: "Timed out",
    output_limit: "Output limit reached",
    compiler_failure: "Compiler failure",
  };
  outcome.textContent = labels[result.outcome] || result.outcome;
  outcome.className = `outcome ${result.outcome}`;
  duration.textContent = `${(result.durationMs / 1000).toFixed(1)} s`;
  revision.textContent = `Compiler ${result.compilerRevision}`;
  const output = `${result.stdout}${result.stderr}`;
  terminal.textContent = output || "The program produced no output.";
  renderDiagnostics(result.diagnostics);
  renderSourceDiagnostics(result.diagnostics);
  renderTopology(result.topology);
}

function validTopology(value) {
  return value && typeof value.entry === "boolean" && Array.isArray(value.entryCalls) &&
    value.entryCalls.every(validTopologyLocator) && Array.isArray(value.units) &&
    value.units.every((unit) => unit && typeof unit.kind === "string" &&
      typeof unit.name === "string" && validTopologyLocator(unit.locator) &&
      Array.isArray(unit.methods) && unit.methods.every((method) => typeof method === "string") &&
      Array.isArray(unit.calls) && unit.calls.every(validTopologyLocator));
}

function validTopologyLocator(value) {
  return value && typeof value.publication === "string" && typeof value.module === "string" &&
    typeof value.unit === "string";
}

function renderTopology(topology) {
  clearTopology();
  if (!topology || topology.units.length === 0) return;

  const nodes = [];
  if (topology.entry) {
    nodes.push({ id: "entry", kind: "entry", name: "main", methods: [], calls: topology.entryCalls });
  }
  for (const unit of topology.units) {
    nodes.push({
      id: topologyLocatorKey(unit.locator),
      kind: unit.kind,
      name: unit.name,
      methods: unit.methods,
      calls: unit.calls,
      locator: unit.locator,
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  for (const node of nodes) {
    for (const call of node.calls) {
      const destination = topologyLocatorKey(call);
      if (nodeIds.has(destination)) edges.push({ from: node.id, to: destination });
    }
  }

  const layout = layoutTopology(nodes, edges);
  const svg = svgElement("svg", {
    class: "topology-svg",
    width: layout.width,
    height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    role: "img",
    "aria-labelledby": "topology-svg-title topology-svg-description",
  });
  const title = svgElement("title", { id: "topology-svg-title" });
  title.textContent = "Logical program topology";
  const description = svgElement("desc", { id: "topology-svg-description" });
  description.textContent = topologyDescription(nodes, edges);
  svg.append(title, description, topologyMarker());

  const edgeLayer = svgElement("g", { "aria-hidden": "true" });
  edges.forEach((edge, index) => {
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    edgeLayer.append(svgElement("path", {
      class: "topology-edge",
      d: topologyEdgePath(from, to, layout, index),
      "marker-end": "url(#topology-arrow)",
    }));
  });
  svg.append(edgeLayer);

  for (const node of nodes) {
    const position = layout.positions.get(node.id);
    const group = svgElement("g", {
      class: `topology-node ${node.kind.replace(/[^a-z0-9_-]/gi, "-")}`,
      transform: `translate(${position.x} ${position.y})`,
    });
    const nodeTitle = svgElement("title");
    nodeTitle.textContent = topologyNodeTitle(node);
    group.append(nodeTitle, svgElement("rect", {
      width: layout.nodeWidth,
      height: layout.nodeHeight,
      rx: 6,
    }));
    const kind = svgElement("text", { class: "node-kind", x: 14, y: 18 });
    kind.textContent = node.kind.toUpperCase();
    const name = svgElement("text", { class: "node-name", x: 14, y: 41 });
    name.textContent = truncateTopologyText(node.name, 22);
    const detail = svgElement("text", { class: "node-detail", x: 14, y: 61 });
    detail.textContent = topologyNodeDetail(node);
    group.append(kind, name, detail);
    svg.append(group);
  }

  topologyCanvas.append(svg);
  const nodeCount = nodes.length;
  const callCount = edges.length;
  topologySummary.textContent = `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"} · ${callCount} service ${callCount === 1 ? "invocation" : "invocations"}`;
  topologyPanel.hidden = false;
}

function clearTopology() {
  topologyCanvas.replaceChildren();
  topologySummary.textContent = "";
  topologyPanel.hidden = true;
}

function topologyLocatorKey(locator) {
  return `${locator.publication}\u0000${locator.module}\u0000${locator.unit}`;
}

function layoutTopology(nodes, edges) {
  const nodeWidth = 190;
  const nodeHeight = 76;
  const columnGap = 96;
  const rowGap = 34;
  const padding = 28;
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  const entry = nodes.find((node) => node.kind === "entry");
  let roots = entry ? [entry.id] : nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  if (roots.length === 0 && nodes.length > 0) roots = [nodes[0].id];
  const depth = new Map(roots.map((id) => [id, 0]));
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index];
    for (const to of outgoing.get(from)) {
      if (depth.has(to)) continue;
      depth.set(to, depth.get(from) + 1);
      queue.push(to);
    }
  }
  let maxDepth = Math.max(0, ...depth.values());
  for (const node of nodes) {
    if (!depth.has(node.id)) depth.set(node.id, maxDepth + 1);
  }
  maxDepth = Math.max(0, ...depth.values());

  const layers = Array.from({ length: maxDepth + 1 }, () => []);
  for (const node of nodes) layers[depth.get(node.id)].push(node);
  const rows = Math.max(1, ...layers.map((layer) => layer.length));
  const graphHeight = rows * nodeHeight + (rows - 1) * rowGap;
  const hasBackwardEdge = edges.some((edge) => depth.get(edge.to) < depth.get(edge.from));
  const width = Math.max(680, padding * 2 + layers.length * nodeWidth + (layers.length - 1) * columnGap);
  const height = padding * 2 + graphHeight + (hasBackwardEdge ? 58 : 0);
  const positions = new Map();
  layers.forEach((layer, column) => {
    const layerHeight = layer.length * nodeHeight + Math.max(0, layer.length - 1) * rowGap;
    const startY = padding + (graphHeight - layerHeight) / 2;
    layer.forEach((node, row) => positions.set(node.id, {
      x: padding + column * (nodeWidth + columnGap),
      y: startY + row * (nodeHeight + rowGap),
      depth: column,
    }));
  });
  return { width, height, positions, nodeWidth, nodeHeight };
}

function topologyEdgePath(from, to, layout, index) {
  const fromMiddleX = from.x + layout.nodeWidth / 2;
  const fromMiddleY = from.y + layout.nodeHeight / 2;
  const toMiddleX = to.x + layout.nodeWidth / 2;
  const toMiddleY = to.y + layout.nodeHeight / 2;
  const startX = from.x + layout.nodeWidth;
  const endX = to.x;

  if (from.x === to.x && from.y === to.y) {
    const loopX = startX + 30;
    return `M ${startX} ${fromMiddleY - 10} C ${loopX} ${fromMiddleY - 10}, ${loopX} ${fromMiddleY + 10}, ${startX} ${fromMiddleY + 10}`;
  }

  if (to.depth > from.depth) {
    const middle = (startX + endX) / 2;
    return `M ${startX} ${fromMiddleY} C ${middle} ${fromMiddleY}, ${middle} ${toMiddleY}, ${endX} ${toMiddleY}`;
  }

  if (to.depth === from.depth) {
    const offset = ((index % 3) - 1) * 12;
    if (to.y > from.y) {
      const startY = from.y + layout.nodeHeight;
      const endY = to.y;
      const middle = (startY + endY) / 2;
      return `M ${fromMiddleX + offset} ${startY} C ${fromMiddleX + offset} ${middle}, ${toMiddleX + offset} ${middle}, ${toMiddleX + offset} ${endY}`;
    }
    const routeX = startX + 24 + (index % 3) * 10;
    return `M ${startX} ${fromMiddleY} C ${routeX} ${fromMiddleY}, ${routeX} ${toMiddleY}, ${to.x + layout.nodeWidth} ${toMiddleY}`;
  }

  const routeY = layout.height - 22 - (index % 3) * 8;
  return `M ${startX} ${fromMiddleY} C ${startX + 38} ${routeY}, ${endX - 38} ${routeY}, ${endX} ${toMiddleY}`;
}

function topologyMarker() {
  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: "topology-arrow",
    markerWidth: 10,
    markerHeight: 10,
    refX: 8,
    refY: 5,
    viewBox: "0 0 10 10",
    orient: "auto",
    markerUnits: "userSpaceOnUse",
  });
  marker.append(svgElement("path", { class: "topology-arrow", d: "M 1 1 L 8 5 L 1 9" }));
  defs.append(marker);
  return defs;
}

function topologyNodeTitle(node) {
  if (node.kind === "entry") return "main — program entry";
  const locator = [node.locator.publication, node.locator.module, node.locator.unit].filter(Boolean).join("/");
  const methods = node.methods.length ? `; methods: ${node.methods.join(", ")}` : "; no methods";
  return `${node.kind} ${locator}${methods}`;
}

function topologyNodeDetail(node) {
  if (node.kind === "entry") return "program entry";
  if (node.methods.length === 0) return "no methods";
  return truncateTopologyText(node.methods.join(" · "), 27);
}

function topologyDescription(nodes, edges) {
  if (edges.length === 0) return `${nodes.length} logical program nodes with no calls between them.`;
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  const calls = edges.map((edge) => `${names.get(edge.from)} calls ${names.get(edge.to)}`);
  return `${nodes.length} logical program nodes. ${calls.join(". ")}.`;
}

function truncateTopologyText(value, length) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, String(value));
  }
  return element;
}

function renderDiagnostics(items) {
  diagnostics.hidden = items.length === 0;
  for (const diagnostic of items) {
    const row = document.createElement("article");
    row.className = "diagnostic";
    const location = diagnostic.location || diagnostic.primary || diagnostic.span || diagnostic;
    const line = location.line || location.start?.line;
    const column = location.column || location.start?.column;
    const where = line ? `Line ${line}${column ? `, column ${column}` : ""}` : "Compiler diagnostic";
    const label = document.createElement("strong");
    label.textContent = where;
    const message = document.createElement("span");
    message.textContent = diagnostic.message || diagnostic.text || JSON.stringify(diagnostic);
    row.append(label, message);
    diagnostics.append(row);
  }
}

function updateLineNumbers() {
  const count = source.value.split("\n").length;
  lineNumberContent.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
}

function handleEditorKeydown(event) {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();

  const indentation = "  ";
  const value = source.value;
  const start = source.selectionStart;
  const end = source.selectionEnd;

  if (!event.shiftKey && start === end) {
    source.setRangeText(indentation, start, end, "end");
    source.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const selectedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const followingNewline = value.indexOf("\n", selectedEnd);
  const lineEnd = followingNewline === -1 ? value.length : followingNewline;
  const lines = value.slice(lineStart, lineEnd).split("\n");

  if (!event.shiftKey) {
    const replacement = lines.map((line) => indentation + line).join("\n");
    source.setRangeText(replacement, lineStart, lineEnd);
    source.setSelectionRange(start + indentation.length, end + indentation.length * lines.length);
  } else {
    let firstRemoved = 0;
    let totalRemoved = 0;
    const replacement = lines.map((line, index) => {
      const prefix = line.match(/^(?: {1,2}|\t)/)?.[0] || "";
      if (index === 0) firstRemoved = prefix.length;
      totalRemoved += prefix.length;
      return line.slice(prefix.length);
    }).join("\n");
    source.setRangeText(replacement, lineStart, lineEnd);
    const nextStart = Math.max(lineStart, start - firstRemoved);
    source.setSelectionRange(nextStart, Math.max(nextStart, end - totalRemoved));
  }

  source.dispatchEvent(new Event("input", { bubbles: true }));
}

function diagnosticSpan(diagnostic) {
  const location = diagnostic.location || diagnostic.primary || diagnostic.span || diagnostic;
  const start = location.start || location;
  const end = location.end || start;
  if (!Number.isInteger(start.line) || !Number.isInteger(start.column)) return null;
  return {
    line: start.line,
    start: start.column,
    end: end.line === start.line && Number.isInteger(end.column) ? end.column : start.column + 1,
  };
}

function renderSourceDiagnostics(items) {
  const spans = items.map(diagnosticSpan).filter(Boolean);
  sourceHighlights.replaceChildren();
  for (const [index, line] of source.value.split("\n").entries()) {
    const lineNumber = index + 1;
    const ranges = spans
      .filter((span) => span.line === lineNumber)
      .map((span) => ({ start: Math.max(0, span.start - 1), end: Math.min(line.length, Math.max(span.start, span.end - 1)) }))
      .sort((a, b) => a.start - b.start);
    if (!ranges.length) continue;
    const row = document.createElement("span");
    row.className = "source-highlight-line error-line";
    row.dataset.lineIndex = String(index);
    const text = document.createElement("span");
    text.className = "source-highlight-text";
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      text.append(document.createTextNode(line.slice(cursor, range.start)));
      const underline = document.createElement("span");
      underline.className = "source-error-span";
      underline.textContent = line.slice(range.start, range.end) || " ";
      text.append(underline);
      cursor = range.end;
    }
    text.append(document.createTextNode(line.slice(cursor)));
    row.append(text);
    sourceHighlights.append(row);
  }
  syncSourceHighlights();
}

function clearSourceDiagnostics() {
  sourceHighlights.replaceChildren();
}

function measureSourceLineHeight() {
  const sampleLineCount = 65;
  sourceLineHeightProbe.value = Array.from({ length: sampleLineCount }, () => "x").join("\n");
  const manyLinesHeight = sourceLineHeightProbe.scrollHeight;
  sourceLineHeightProbe.value = "x";
  const oneLineHeight = sourceLineHeightProbe.scrollHeight;
  const measured = (manyLinesHeight - oneLineHeight) / (sampleLineCount - 1);
  return measured > 0 ? measured : Number.parseFloat(getComputedStyle(source).lineHeight);
}

function resetSourceLineHeight() {
  measuredSourceLineHeight = undefined;
  syncSourceHighlights();
}

function syncSourceHighlights() {
  lineNumberContent.style.transform = `translateY(${-source.scrollTop}px)`;
  const style = getComputedStyle(source);
  const lineHeight = measuredSourceLineHeight ??= measureSourceLineHeight();
  const paddingTop = Number.parseFloat(style.paddingTop);
  const paddingLeft = Number.parseFloat(style.paddingLeft);
  for (const row of sourceHighlights.children) {
    const lineIndex = Number(row.dataset.lineIndex);
    row.style.top = `${paddingTop + lineIndex * lineHeight - source.scrollTop}px`;
    row.style.height = `${lineHeight}px`;
    row.style.lineHeight = `${lineHeight}px`;
    row.firstElementChild.style.left = `${paddingLeft - source.scrollLeft}px`;
  }
}

function setPending(pending) {
  runButton.disabled = pending;
  runButton.textContent = pending ? "Running…" : "Run program";
  if (pending) {
    outcome.textContent = "Running";
    outcome.className = "outcome pending";
  }
}

function showServiceError(message) {
  outcome.textContent = "Service unavailable";
  outcome.className = "outcome service_error";
  terminal.textContent = message;
  duration.textContent = "";
  revision.textContent = "";
  diagnostics.hidden = true;
  diagnostics.replaceChildren();
  clearSourceDiagnostics();
  clearTopology();
}
