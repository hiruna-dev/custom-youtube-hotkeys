const ACTIONS = [
  ["toggleMode", "Toggle listening mode"], ["playPause", "Play / pause"],
  ["volumeUp", "Volume up (5%)"], ["volumeDown", "Volume down (5%)"],
  ["mute", "Mute / unmute"], ["seekForward", "Forward one second (hold to repeat)"],
  ["seekBackward", "Back one second (hold to repeat)"], ["pip", "Picture in Picture"],
  ["qualityUp", "Quality up"], ["qualityDown", "Quality down"]
];
const bindings = {};
const rows = document.getElementById("bindings");
const message = document.getElementById("message");
let recording = null;
const format = b => b ? [...(b.ctrl ? ["Ctrl"] : []), ...(b.alt ? ["Alt"] : []), ...(b.shift ? ["Shift"] : []), ...(b.win ? ["Win"] : []), b.key].join(" + ") : "Unassigned";
const id = b => `${b.ctrl}-${b.alt}-${b.shift}-${b.win}-${b.key}`;

for (const [action, label] of ACTIONS) {
  const row = document.createElement("div"); row.className = "row";
  const name = document.createElement("span"); name.textContent = label;
  const key = document.createElement("output"); key.id = `key-${action}`; key.textContent = "Unassigned";
  const record = document.createElement("button"); record.textContent = "Record";
  record.onclick = () => { recording = action; message.textContent = "Press a key or combination. Esc cancels."; record.focus(); };
  const clear = document.createElement("button"); clear.textContent = "Clear";
  clear.onclick = () => { delete bindings[action]; key.textContent = "Unassigned"; message.textContent = ""; };
  row.append(name, key, record, clear); rows.append(row);
}

document.addEventListener("keydown", event => {
  if (!recording) return;
  event.preventDefault(); event.stopPropagation();
  if (event.key === "Escape") { recording = null; message.textContent = "Recording cancelled"; return; }
  const code = event.code;
  if (/^(Control|Alt|Shift|Meta)/.test(code)) return;
  if (!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Numpad[0-9]|Space|Arrow(?:Left|Right|Up|Down)|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Insert|Delete|Home|End|PageUp|PageDown)$/.test(code)) {
    message.textContent = "That key isn't supported. Choose a letter, number, function, arrow, or common punctuation key."; return;
  }
  const key = code.startsWith("Key") || code.startsWith("Digit") ? code.slice(code.startsWith("Key") ? 3 : 5) : code;
  const value = { key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, win: event.metaKey };
  const duplicate = Object.entries(bindings).find(([action, b]) => action !== recording && id(b) === id(value));
  if (duplicate) { message.textContent = `Already assigned to ${ACTIONS.find(x => x[0] === duplicate[0])[1]}`; return; }
  bindings[recording] = value;
  document.getElementById(`key-${recording}`).textContent = format(value);
  recording = null;
  message.textContent = "Press Save settings to apply.";
}, true);

document.getElementById("save").onclick = async () => {
  if (!bindings.toggleMode && Object.values(bindings).some(b => !b.ctrl && !b.alt && !b.shift && !b.win)) {
    message.textContent = "Assign a listening-mode toggle before using single-key controls."; return;
  }
  const repeatDelay = Number(document.getElementById("repeatDelay").value);
  const repeatInterval = Number(document.getElementById("repeatInterval").value);
  if (!Number.isInteger(repeatDelay) || repeatDelay < 100 || repeatDelay > 1000 || !Number.isInteger(repeatInterval) || repeatInterval < 50 || repeatInterval > 500) {
    message.textContent = "Enter a hold delay from 100–1000 ms and repeat from 50–500 ms."; return;
  }
  await chrome.storage.local.set({ bindings, preferredQuality: document.getElementById("quality").value, repeatDelay, repeatInterval });
  message.textContent = "Saved. Listening mode starts off after each save.";
};

(async () => {
  const stored = await chrome.storage.local.get({ bindings: {}, preferredQuality: "auto", repeatDelay: 300, repeatInterval: 125 });
  Object.assign(bindings, stored.bindings);
  for (const [action] of ACTIONS) document.getElementById(`key-${action}`).textContent = format(bindings[action]);
  document.getElementById("quality").value = stored.preferredQuality;
  document.getElementById("repeatDelay").value = stored.repeatDelay;
  document.getElementById("repeatInterval").value = stored.repeatInterval;
})();
