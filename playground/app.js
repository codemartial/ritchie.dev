const examples = [
  {
    name: "Hello, Ritchie",
    source: `main() {
  log("Hello from Ritchie")
}
`,
  },
  {
    name: "Values and interpolation",
    source: `main() {
  Int answer = 6 * 7
  log(f"The answer is {answer}")
}
`,
  },
  {
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
const sourceLineHeightProbe = source.cloneNode(false);
sourceLineHeightProbe.removeAttribute("id");
sourceLineHeightProbe.removeAttribute("aria-label");
sourceLineHeightProbe.className = "source-line-height-probe";
sourceLineHeightProbe.setAttribute("aria-hidden", "true");
sourceLineHeightProbe.tabIndex = -1;
source.insertAdjacentElement("afterend", sourceLineHeightProbe);
let measuredSourceLineHeight;

for (const [index, example] of examples.entries()) {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = example.name;
  examplePicker.append(option);
}
source.value = examples[0].source;
updateLineNumbers();

examplePicker.addEventListener("change", () => {
  source.value = examples[Number(examplePicker.value)].source;
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
    typeof value.durationMs === "number" && typeof value.compilerRevision === "string";
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
}
