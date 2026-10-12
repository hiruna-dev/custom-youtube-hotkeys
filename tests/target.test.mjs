import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const nativeListeners = [];
const runtimeListeners = [];
const selected = [];
const states = new Map([
  [1, { hasVideo: true, playing: false, activityAt: 200, pip: false }],
  [2, { hasVideo: true, playing: true, activityAt: 100, pip: false }]
]);
const chrome = {
  runtime: {
    connectNative: () => ({ onMessage: { addListener: fn => nativeListeners.push(fn) }, onDisconnect: { addListener() {} }, postMessage() {} }),
    onMessage: { addListener: fn => runtimeListeners.push(fn) },
    onStartup: { addListener() {} }, onInstalled: { addListener() {} }, sendMessage: async () => {}
  },
  tabs: {
    query: async () => [{ id: 1, active: false }, { id: 2, active: true }],
    sendMessage: async (id, message) => {
      if (message.type === 'state') return states.get(id);
      selected.push(id); return { ok: true };
    },
    onRemoved: { addListener() {} }
  },
  scripting: { executeScript: async () => {} },
  storage: { local: { get: async () => ({ bindings: {} }) }, onChanged: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};
const code = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
runInNewContext(code, { chrome, Date, Map, Set, setTimeout, clearTimeout });
await nativeListeners[0]({ type: 'ready' });
await nativeListeners[0]({ type: 'command', action: 'playPause' });
assert.deepEqual(selected, [1], 'recently paused video should beat an older playing tab');

states.get(2).pip = true;
runtimeListeners[0]({ type: 'playback', activity: true }, { tab: { id: 2 } }, () => {});
await nativeListeners[0]({ type: 'command', action: 'pip' });
assert.deepEqual(selected, [1, 2], 'active Picture in Picture video should be targeted');

states.get(2).pip = false;
states.get(2).activityAt = 300;
runtimeListeners[0]({ type: 'playback', activity: true }, { tab: { id: 2 } }, () => {});
await nativeListeners[0]({ type: 'command', action: 'pip' });
assert.deepEqual(selected, [1, 2, 2], 'video should remain targeted after Picture in Picture closes');
console.log('Paused-video and Picture in Picture target selection passed.');
