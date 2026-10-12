const ACTIONS = [
  ["toggleMode", "Toggle listening mode"], ["playPause", "Play / pause"],
  ["volumeUp", "Volume up (5%; hold to repeat)"], ["volumeDown", "Volume down (5%; hold to repeat)"],
  ["mute", "Mute / unmute"], ["seekForward", "Forward one second (hold to repeat)"],
  ["seekBackward", "Back one second (hold to repeat)"], ["pip", "Picture in Picture"],
  ["qualityUp", "Quality up"], ["qualityDown", "Quality down"]
];
const bindings = {};
const rows = document.getElementById("bindings");
const message = document.getElementById("message");
const controls = new Map();
let recording = null;
const format = b => b ? [...(b.ctrl ? ["Ctrl"] : []), ...(b.alt ? ["Alt"] : []), ...(b.shift ? ["Shift"] : []), ...(b.win ? ["Win"] : []), b.key].join(" + ") : "Unassigned";
const id = b => `${b.ctrl}-${b.alt}-${b.shift}-${b.win}-${b.scan ?? b.key}-${b.extended ?? false}-${b.scan === 0 ? b.vk : ""}`;

function showRecording(action) {
  recording = action;
  for (const [name, { row, record, key }] of controls) {
    const active = name === action;
    row.classList.toggle("recording", active);
    record.textContent = active ? "Cancel" : "Record";
    record.setAttribute("aria-pressed", String(active));
    key.textContent = active ? "Listening…" : format(bindings[name]);
  }
  message.textContent = action ? `Recording ${ACTIONS.find(x => x[0] === action)[1]}. Press a key or combination; release a modifier to bind it alone. Click Cancel to stop.` : "";
}

for (const [action, label] of ACTIONS) {
  const row = document.createElement("div"); row.className = "row";
  const name = document.createElement("span"); name.textContent = label;
  const key = document.createElement("output"); key.textContent = "Unassigned";
  const record = document.createElement("button"); record.type = "button"; record.textContent = "Record";
  record.setAttribute("aria-label", `Record ${label}`);
  record.onclick = async () => {
    if (recording === action) {
      await chrome.runtime.sendMessage({ type: "cancelCapture" });
      showRecording(null);
      message.textContent = "Recording cancelled.";
      return;
    }
    if (recording) await chrome.runtime.sendMessage({ type: "cancelCapture" });
    showRecording(action);
    let result;
    try { result = await chrome.runtime.sendMessage({ type: "beginCapture" }); }
    catch (error) { result = { ok: false, error: String(error) }; }
    if (!result?.ok) { showRecording(null); message.textContent = result?.error || "Could not start recording."; return; }
    record.focus();
  };
  const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "Clear";
  clear.onclick = async () => {
    if (recording === action) { await chrome.runtime.sendMessage({ type: "cancelCapture" }); showRecording(null); }
    delete bindings[action]; key.textContent = "Unassigned"; message.textContent = "Cleared. Press Save settings to apply.";
  };
  row.append(name, key, record, clear); rows.append(row);
  controls.set(action, { row, record, key });
}

chrome.runtime.onMessage.addListener(event => {
  if (!recording) return;
  if (event.type === "capturePreview") {
    controls.get(recording).key.textContent = format(event);
    message.textContent = `Recording ${ACTIONS.find(x => x[0] === recording)[1]}: ${format(event)}. Press another key or release a modifier to finish.`;
  } else if (event.type === "captureCancelled") {
    showRecording(null); message.textContent = "Recording cancelled.";
  } else if (event.type === "captureDone") {
    const action = recording;
    const value = { key: event.key, scan: event.scan, extended: event.extended, vk: event.vk,
      ctrl: event.ctrl, alt: event.alt, shift: event.shift, win: event.win };
    const duplicate = Object.entries(bindings).find(([other, b]) => other !== action && id(b) === id(value));
    showRecording(null);
    if (duplicate) {
      message.textContent = `${format(value)} is already assigned to ${ACTIONS.find(x => x[0] === duplicate[0])[1]}.`;
      return;
    }
    bindings[action] = value;
    controls.get(action).key.textContent = format(value);
    message.textContent = `${format(value)} recorded. Press Save settings to apply.`;
  }
});

document.addEventListener("keydown", event => {
  if (!recording) return;
  event.preventDefault(); event.stopPropagation();
}, true);
window.addEventListener("pagehide", () => {
  if (recording) chrome.runtime.sendMessage({ type: "cancelCapture" }).catch(() => {});
});

document.getElementById("save").onclick = async () => {
  if (recording) { message.textContent = "Finish or cancel recording before saving."; return; }
  if (!bindings.toggleMode && Object.values(bindings).some(b => !b.ctrl && !b.alt && !b.shift && !b.win)) {
    message.textContent = "Assign a listening-mode toggle before using single-key controls."; return;
  }
  const repeatDelay = Number(document.getElementById("repeatDelay").value);
  const repeatInterval = Number(document.getElementById("repeatInterval").value);
  if (!Number.isInteger(repeatDelay) || repeatDelay < 100 || repeatDelay > 1000 || !Number.isInteger(repeatInterval) || repeatInterval < 50 || repeatInterval > 500) {
    message.textContent = "Enter a hold delay from 100-1000 ms and repeat from 50-500 ms."; return;
  }
  await chrome.storage.local.set({ bindings, preferredQuality: document.getElementById("quality").value, repeatDelay, repeatInterval });
  message.textContent = "Saved. Open the toolbar popup and turn Listening on to use single-key hotkeys.";
};

(async () => {
  const stored = await chrome.storage.local.get({ bindings: {}, preferredQuality: "auto", repeatDelay: 300, repeatInterval: 125 });
  Object.assign(bindings, stored.bindings);
  for (const [action] of ACTIONS) controls.get(action).key.textContent = format(bindings[action]);
  document.getElementById("quality").value = stored.preferredQuality;
  document.getElementById("repeatDelay").value = stored.repeatDelay;
  document.getElementById("repeatInterval").value = stored.repeatInterval;
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.preferredQuality)
    document.getElementById("quality").value = changes.preferredQuality.newValue;
});
