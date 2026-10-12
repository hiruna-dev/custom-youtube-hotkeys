const HOST = "com.custom.youtube_hotkeys";
const DEFAULTS = { bindings: {}, preferredQuality: "auto", repeatDelay: 300, repeatInterval: 125 };
let port = null;
let connected = false;
let listening = false;
let lastError = "";
let retry = null;
const playing = new Map();
let cachedTarget = null;
let cachedUntil = 0;
const ACTIONS = new Set(["playPause", "volumeUp", "volumeDown", "mute", "seekForward", "seekBackward", "pip", "qualityUp", "qualityDown"]);

async function sendToYouTubeTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch (error) {
    // Chrome does not inject a newly loaded or reloaded extension into tabs that
    // were already open. Install the content script there on the first command.
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(error))) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

async function sendConfig() {
  if (port) {
    const s = await settings();
    port.postMessage({ type: "config", bindings: s.bindings, repeatDelay: s.repeatDelay, repeatInterval: s.repeatInterval });
  }
}

function connect() {
  if (port || retry) return;
  try {
    const p = chrome.runtime.connectNative(HOST);
    port = p;
    p.onMessage.addListener(async message => {
      if (message.type === "ready") {
        connected = true;
        lastError = "";
        await sendConfig();
      } else if (message.type === "mode") {
        listening = !!message.listening;
        chrome.action.setBadgeText({ text: listening ? "ON" : "" });
        chrome.action.setBadgeBackgroundColor({ color: "#267b4b" });
      } else if (message.type === "command" && ACTIONS.has(message.action)) {
        await dispatch(message.action);
      } else if (["captureReady", "capturePreview", "captureDone", "captureCancelled"].includes(message.type)) {
        chrome.runtime.sendMessage(message).catch(() => {});
      }
    });
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      lastError = chrome.runtime.lastError?.message || "Helper disconnected";
      port = null;
      connected = false;
      listening = false;
      chrome.action.setBadgeText({ text: "" });
      chrome.runtime.sendMessage({ type: "captureCancelled" }).catch(() => {});
      retry = setTimeout(() => { retry = null; connect(); }, 30000);
    });
  } catch (e) { lastError = String(e); }
}

async function targetTab() {
  if (cachedTarget && Date.now() < cachedUntil) return cachedTarget;
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
  if (!tabs.length) return null;
  const ids = new Set(tabs.map(t => t.id));
  const known = [...playing.entries()].filter(([id, state]) => ids.has(id) && state.playing);
  known.sort((a, b) => b[1].time - a[1].time);
  if (known.length) {
    cachedTarget = tabs.find(t => t.id === known[0][0]);
    cachedUntil = Date.now() + 2000;
    return cachedTarget;
  }
  // After a worker restart, ask existing tabs which video is playing.
  const states = await Promise.all(tabs.map(async tab => {
    try { return { tab, state: await sendToYouTubeTab(tab.id, { type: "state" }) }; }
    catch { return { tab, state: null }; }
  }));
  const active = states.filter(x => x.state?.playing);
  cachedTarget = active.length === 1 ? active[0].tab :
    active.length > 1 ? (active.find(x => x.tab.active)?.tab || active[0].tab) :
    (tabs.find(t => t.active) || null);
  cachedUntil = Date.now() + 2000;
  return cachedTarget;
}

async function dispatch(action) {
  const tab = await targetTab();
  if (!tab) { lastError = "No playing YouTube tab found"; return; }
  try {
    const response = await sendToYouTubeTab(tab.id, { type: "control", action });
    if (!response?.ok) lastError = response?.error || "Command failed";
    else lastError = "";
  } catch (e) { cachedTarget = null; lastError = String(e); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "playback" && sender.tab?.id) {
    const old = playing.get(sender.tab.id);
    playing.set(sender.tab.id, { playing: !!message.playing, time: message.playing ? Date.now() : (old?.time || 0) });
    if (message.playing) cachedTarget = null;
  } else if (message.type === "qualityFailure") {
    lastError = message.error || "Could not apply preferred quality";
  } else if (message.type === "status") {
    respond({ connected, listening, error: lastError });
  } else if (message.type === "settingsChanged") {
    sendConfig().then(() => respond({ ok: true }));
    return true;
  } else if (message.type === "toggleMode") {
    port?.postMessage({ type: "toggleMode" });
    respond({ ok: !!port });
  } else if (message.type === "beginCapture" || message.type === "cancelCapture") {
    if (!connected || !port) { respond({ ok: false, error: lastError || "Windows helper is not connected. Run install.ps1 and reload the extension." }); return; }
    port.postMessage({ type: message.type });
    respond({ ok: true });
  }
});
chrome.tabs.onRemoved.addListener(id => { playing.delete(id); if (cachedTarget?.id === id) cachedTarget = null; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.bindings || changes.repeatDelay || changes.repeatInterval)) sendConfig();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
