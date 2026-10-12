(() => {
if (globalThis.__customYouTubeHotkeysLoaded) return;
globalThis.__customYouTubeHotkeysLoaded = true;
const QUALITY_LABELS = ["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p", "4320p"];
let lastVideo = null;
let lastUrl = location.href;
let qualityTimer = null;

function video() { return document.querySelector("video.html5-main-video") || document.querySelector("video"); }
function report() {
  const v = video();
  chrome.runtime.sendMessage({ type: "playback", playing: !!v && !v.paused && !v.ended }).catch(() => {});
}
function attach() {
  const v = video();
  if (!v || v === lastVideo) return;
  lastVideo = v;
  for (const event of ["play", "pause", "ended"]) v.addEventListener(event, report);
  v.addEventListener("loadedmetadata", scheduleQuality);
  report();
  scheduleQuality();
}
function scheduleQuality() {
  clearTimeout(qualityTimer);
  qualityTimer = setTimeout(async () => {
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
function qualityNumber(label) { const m = /(?:^|\s)(\d{3,4})p\b/i.exec(label); return m ? Number(m[1]) : null; }

async function qualityMenu() {
  const button = document.querySelector(".ytp-settings-button");
  if (!button) throw Error("YouTube settings button unavailable");
  button.click();
  await delay(100);
  let item = menuItems().find(e => /quality/i.test(e.textContent || ""));
  if (!item) {
    button.click();
    await delay(100);
    item = menuItems().find(e => /quality/i.test(e.textContent || ""));
  }
  if (!item) throw Error("Quality menu unavailable (English YouTube UI required)");
  item.click();
  await delay(100);
  const choices = menuItems().filter(e => qualityNumber(e.textContent || "") !== null);
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
      const index = sorted.findIndex(x => x.element === current);
      choice = sorted[Math.max(0, Math.min(sorted.length - 1, (index < 0 ? 0 : index) + direction))];
    } else {
      const requested = Number(preferred.replace("p", ""));
      choice = [...sorted].reverse().find(x => x.level <= requested) || sorted[0];
    }
    choice.element.click();
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
  } catch (e) { return { ok: false, error: e.message }; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "state") respond({ playing: !!video() && !video().paused && !video().ended });
  if (message.type === "control") { control(message.action).then(respond); return true; }
});
document.addEventListener("yt-navigate-finish", () => {
  attach();
  if (location.href !== lastUrl) { lastUrl = location.href; scheduleQuality(); }
  setTimeout(attach, 800);
});
attach();
setTimeout(attach, 1000);
})();
