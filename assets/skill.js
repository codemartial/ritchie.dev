// The Skill page's "Copy prompt" button: it sits in .copy-prompt-actions,
// and the prompt is the code block right after it.
(() => {
  "use strict";

  const actions = document.querySelector(".copy-prompt-actions");
  const button = actions?.querySelector("button");
  const status = actions?.querySelector(".copy-prompt-status");
  const prompt = actions?.nextElementSibling?.querySelector("code");
  if (!button || !status || !prompt) return;

  // For browsers without the async clipboard, or that refuse it here.
  const copyBySelection = (text) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    const text = prompt.textContent;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {}
      }
      if (!copied) copied = copyBySelection(text);
      if (!copied) throw new Error("Copy unavailable");
      button.textContent = "Copied";
      status.textContent = "The prompt is ready to paste as plain text.";
    } catch {
      button.textContent = "Copy prompt";
      status.textContent = "Couldn’t copy automatically. Select and copy the prompt below.";
    } finally {
      button.disabled = false;
    }
  });
})();
