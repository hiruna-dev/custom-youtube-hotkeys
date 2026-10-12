import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

let menu = 'closed';
let selected = 480;
let preferenceTimers = 0;
let preferenceCallback;
let storedPreference = '480p';
const listeners = [];
const storageListeners = [];
const events = new Map();
const levels = [1440, 1080, 720, 480, 360, 240, 144];
const item = level => ({
  textContent: `${level}p${level >= 720 ? '60 HD' : ''}`,
  getClientRects: () => [1],
  hasAttribute: name => name === 'aria-checked',
  getAttribute: name => name === 'aria-checked' ? String(selected === level) : null,
  classList: { contains: () => false },
  click: () => { selected = level; menu = 'closed'; }
});
const qualityRow = {
  textContent: 'Quality480p', getClientRects: () => [1], hasAttribute: () => false,
  querySelector: () => ({ textContent: 'Quality' }), click: () => { menu = 'quality'; }
};
const video = {
  paused: false, ended: false, videoHeight: 480, volume: 0.5,
  addEventListener(name, fn) { events.set(name, fn); },
  async requestPictureInPicture() { document.pictureInPictureElement = video; },
  async play() { this.paused = false; }, pause() { this.paused = true; }
};
const document = {
  pictureInPictureElement: null,
  querySelector: selector => selector.startsWith('video') ? video : selector === '.ytp-settings-button' ? {
    click: () => { menu = menu === 'closed' ? 'main' : 'closed'; }
  } : null,
  querySelectorAll: () => menu === 'main' ? [qualityRow] : menu === 'quality' ? levels.map(item) : [],
  addEventListener() {},
  async exitPictureInPicture() { this.pictureInPictureElement = null; }
};
const chrome = {
  runtime: { onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async () => {} },
  storage: { local: {
    get: async () => ({ preferredQuality: storedPreference }),
    set: async ({ preferredQuality }) => {
      const oldValue = storedPreference;
      storedPreference = preferredQuality;
      if (oldValue !== preferredQuality)
        for (const listener of storageListeners)
          listener({ preferredQuality: { oldValue, newValue: preferredQuality } }, 'local');
    }
  }, onChanged: { addListener: fn => storageListeners.push(fn) } }
};
const code = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const context = {
  chrome, document, location: { href: 'https://www.youtube.com/watch?v=test' }, URL, Date,
  setTimeout: (fn, ms) => { if (ms === 100) queueMicrotask(fn); if (ms === 1400) { preferenceTimers++; preferenceCallback = fn; } return 1; },
  clearTimeout() {}
};
context.globalThis = context;
runInNewContext(code, context);
const command = message => new Promise(resolve => listeners[0]({ type: 'control', action: message }, {}, resolve));
await preferenceCallback();
assert.equal(selected, 480);

assert.equal((await command('qualityUp')).ok, true);
assert.equal(selected, 720, 'quality up must recognize 720p60');
assert.equal(storedPreference, '720p', 'quality up must save the new default');
assert.equal((await command('qualityUp')).ok, true);
assert.equal(selected, 1080, 'quality up must recognize 1080p60');
assert.equal(storedPreference, '1080p');
assert.equal((await command('qualityDown')).ok, true);
assert.equal(selected, 720, 'quality down must select the previous quality');
assert.equal(storedPreference, '720p', 'quality down must save the new default');
const beforeMetadata = preferenceTimers;
events.get('loadedmetadata')();
assert.equal(preferenceTimers, beforeMetadata, 'a quality change must not reapply the saved preference');

// A fresh page context must read the quality saved by the hotkey.
selected = 480;
menu = 'closed';
const reloadedContext = { ...context };
delete reloadedContext.__customYouTubeHotkeysLoaded;
reloadedContext.globalThis = reloadedContext;
runInNewContext(code, reloadedContext);
await preferenceCallback();
assert.equal(selected, 720, 'reload must apply the quality saved by the hotkey');

assert.equal((await command('pip')).ok, true);
assert.equal(document.pictureInPictureElement, video);
assert.equal((await command('pip')).ok, true);
assert.equal(document.pictureInPictureElement, null);
assert.equal((await command('pip')).ok, true);
assert.equal(document.pictureInPictureElement, video, 'Picture in Picture should reopen after closing');
console.log('Quality persistence and Picture in Picture toggle passed.');
