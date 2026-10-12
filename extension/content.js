(() => {
if (globalThis.__customYouTubeHotkeysLoaded) return;
globalThis.__customYouTubeHotkeysLoaded = true;
let lastVideo = null;
let qualityTimer = null;
let preferredQualityAppliedTo = null;
let lastActivityAt = 0;

function video() { return document.querySelector("video.html5-main-video") || document.querySelector("video"); }
function videoKey() {
  const url = new URL(location.href);
  return url.pathname === "/watch" ? `watch:${url.searchParams.get("v") || ""}` : `${url.pathname}:${url.searchParams.get("v") || ""}`;
}
function report(activity = false) {
  if (activity) lastActivityAt = Date.now();
  const v = video();
  chrome.runtime.sendMessage({ type: "playback", playing: !!v && !v.paused && !v.ended, activity }).catch(() => {});
}
function attach() {
  const v = video();
  if (!v || v === lastVideo) return;
  lastVideo = v;
  for (const event of ["play", "pause", "ended", "enterpictureinpicture", "leavepictureinpicture"])
    v.addEventListener(event, () => report(true));
  v.addEventListener("loadedmetadata", scheduleQuality);
  report();
  scheduleQuality();
}
function scheduleQuality() {
  clearTimeout(qualityTimer);
  const key = videoKey();
  if (preferredQualityAppliedTo === key) return;
  qualityTimer = setTimeout(async () => {
    if (key !== videoKey() || preferredQualityAppliedTo === key) return;
    preferredQualityAppliedTo = key;
    const { preferredQuality = "auto" } = await chrome.storage.local.get("preferredQuality");
    if (preferredQuality !== "auto") {
      const result = await setQuality(preferredQuality);
      if (!result.ok) chrome.runtime.sendMessage({ type: "qualityFailure", error: result.error }).catch(() => {});
    }
  }, 1400);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function visible(element) { return !!element && element.getClientRects().length > 0; }
function menuItems() { return [...document.querySelectorAll(".ytp-panel-menu .ytp-menuitem")].filter(visible); }
function qualityNumber(label) { const m = /(?:^|\s)(\d{3,4})p(?:\d+)?\b/i.exec(label); return m ? Number(m[1]) : null; }
function qualityChoices() {
  return menuItems().filter(e => e.hasAttribute("aria-checked") && qualityNumber(e.textContent || "") !== null);
}

async function qualityMenu() {
  let choices = qualityChoices();
  if (choices.length) return choices;
  const button = document.querySelector(".ytp-settings-button");
  if (!button) throw Error("YouTube settings button unavailable");
  const qualityItem = () => menuItems().find(e => /quality/i.test(e.querySelector(".ytp-menuitem-label")?.textContent || ""));
  let item = qualityItem();
  if (!item) {
    button.click();
    await delay(100);
    item = qualityItem();
  }
  if (!item) throw Error("Quality menu unavailable (English YouTube UI required)");
  item.click();
  await delay(100);
  choices = qualityChoices();
  if (!choices.length) throw Error("No quality choices found");
  return choices;
}
async function setQuality(preferred, direction = 0) {
  try {
    const choices = await qualityMenu();
    const sorted = choices.map(element => ({ element, level: qualityNumber(element.textContent || "") })).sort((a, b) => a.level - b.level);
    let choice;
    if (direction) {
      const current = choices.find(e => e.getAttribute("aria-checked") === "true" || e.classList.contains("ytp-menuitem-checked"));
      const currentLevel = current ? qualityNumber(current.textContent || "") : video()?.videoHeight;
      const index = sorted.findIndex(x => x.level >= currentLevel);
      choice = sorted[Math.max(0, Math.min(sorted.length - 1, (index < 0 ? sorted.length - 1 : index) + direction))];
    } else {
      const requested = Number(preferred.replace("p", ""));
      choice = [...sorted].reverse().find(x => x.level <= requested) || sorted[0];
    }
    choice.element.click();
    if (direction) { clearTimeout(qualityTimer); preferredQualityAppliedTo = videoKey(); }
    return { ok: true, quality: choice.level };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function control(action) {
  const v = video();
  if (!v) return { ok: false, error: "No YouTube video found" };
  try {
    switch (action) {
      case "playPause": if (v.paused) await v.play(); else v.pause(); break;
      case "volumeUp": v.volume = Math.min(1, Math.round(v.volume * 100 + 5) / 100); if (v.muted) v.muted = false; break;
      case "volumeDown": v.volume = Math.max(0, Math.round(v.volume * 100 - 5) / 100); break;
      case "mute": v.muted = !v.muted; break;
      case "seekForward": v.currentTime = Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, v.currentTime + 1); break;
      case "seekBackward": v.currentTime = Math.max(0, v.currentTime - 1); break;
      case "pip": if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); break;
      case "qualityUp": return await setQuality("auto", 1);
      case "qualityDown": return await setQuality("auto", -1);
      default: return { ok: false, error: "Unknown action" };
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.name === "NotAllowedError" && action === "pip" ? "Chrome blocked Picture in Picture. Reopening it may require a click in the YouTube tab; the hotkey cannot supply that while Chrome is minimized." : e.message }; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "state") respond({ playing: !!video() && !video().paused && !video().ended, hasVideo: !!video(), activityAt: lastActivityAt, pip: !!document.pictureInPictureElement });
  if (message.type === "control") { control(message.action).then(respond); return true; }
});
document.addEventListener("yt-navigate-finish", () => {
  attach();
  scheduleQuality();
  setTimeout(attach, 800);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.preferredQuality) { preferredQualityAppliedTo = null; scheduleQuality(); }
});
attach();
setTimeout(attach, 1000);
})();
