import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../extension/', import.meta.url);
const contentListeners = [];
const video = {
  paused: false, ended: false, muted: false, volume: 0.5, currentTime: 10, duration: 100,
  addEventListener() {}, pause() { this.paused = true; },
  async play() { this.paused = false; }
};
const contentContext = {
  document: { querySelector: selector => selector.startsWith('video') ? video : null, addEventListener() {} },
  location: { href: 'https://www.youtube.com/watch?v=test' },
  chrome: {
    runtime: { sendMessage: async () => {}, onMessage: { addListener: listener => contentListeners.push(listener) } },
    storage: { local: { get: async () => ({ preferredQuality: 'auto' }) } }
  },
  setTimeout: () => 0, clearTimeout() {}
};
contentContext.globalThis = contentContext;
const contentCode = readFileSync(new URL('content.js', root), 'utf8');
const inject = () => runInNewContext(contentCode, contentContext, { filename: 'content.js' });
inject();
inject();
assert.equal(contentListeners.length, 1, 'reinjection must not add duplicate listeners');
const contentMessage = message => new Promise(resolve => contentListeners[0](message, {}, resolve));

const nativeListeners = [];
let injected = false;
let injections = 0;
const backgroundContext = {
  chrome: {
    runtime: {
      connectNative: () => ({
        onMessage: { addListener: listener => nativeListeners.push(listener) },
        onDisconnect: { addListener() {} }, postMessage() {}
      }),
      onMessage: { addListener() {} }, onStartup: { addListener() {} }, onInstalled: { addListener() {} },
      sendMessage: async () => {}
    },
    tabs: {
      query: async () => [{ id: 1, active: true }],
      sendMessage: async (_, message) => {
        if (!injected) throw Error('Could not establish connection. Receiving end does not exist.');
        return contentMessage(message);
      },
      onRemoved: { addListener() {} }
    },
    scripting: { executeScript: async () => { injected = true; injections++; inject(); } },
    storage: { local: { get: async () => ({ bindings: {}, repeatDelay: 300, repeatInterval: 125 }) }, onChanged: { addListener() {} } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
  },
  setTimeout: () => 0, clearTimeout() {}, Date, Map, Set
};
runInNewContext(readFileSync(new URL('background.js', root), 'utf8'), backgroundContext, { filename: 'background.js' });
await nativeListeners[0]({ type: 'ready' });
await nativeListeners[0]({ type: 'command', action: 'playPause' });
assert.equal(video.paused, true, 'command must reach an already open YouTube tab');
assert.equal(injections, 1, 'missing content script should be injected once');
await nativeListeners[0]({ type: 'command', action: 'volumeDown' });
assert.equal(video.volume, 0.45, 'volume command should change the video');
assert.equal(injections, 1, 'later commands should reuse the existing script');
console.log('Existing-tab recovery and playback controls passed.');
