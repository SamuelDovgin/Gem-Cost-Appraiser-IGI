async function activeAlibabaTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/https?:\/\/([^/]+\.)?alibaba\.com\//i.test(tab.url || "")) {
    throw new Error("Open an Alibaba tab first.");
  }
  return tab;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectIfNeeded(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["panel.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  await wait(120);
}

async function send(action) {
  const tab = await activeAlibabaTab();
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: action });
  } catch (error) {
    if (!String(error.message || "").includes("Receiving end")) throw error;
    await injectIfNeeded(tab.id);
    response = await chrome.tabs.sendMessage(tab.id, { type: action });
  }
  if (!response?.ok) throw new Error(response?.error || "No response from page.");
  return response.result;
}

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  setStatus("Working...");
  try {
    const result = await send(action);
    if (action === "capture") setStatus("Captured SKU snapshot.");
    else if (action === "watch") setStatus(result?.enabled ? "Watching SKU clicks." : "Auto-watch paused.");
    else if (action === "copy") setStatus("Copied JSON.");
    else if (action === "download") setStatus("Downloaded JSON.");
    else if (action === "clear") setStatus("Cleared saved captures.");
  } catch (error) {
    setStatus(error.message);
  }
});

send("count")
  .then((result) => setStatus(`${result?.count || 0} saved. ${result?.autoCaptureEnabled === false ? "Paused." : "Watching."}`))
  .catch((error) => setStatus(error.message));
