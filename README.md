# Custom YouTube Hotkeys

Control YouTube from a game on Windows using a Chrome extension and a small local helper. The helper listens for assigned keys only and sends action names to Chrome. It stores only the hotkeys you assign, does not log typing, and does not use a network connection.

## What it uses

| Part | Technology | Purpose |
| --- | --- | --- |
| Chrome extension | JavaScript, Manifest V3 | Saves settings and controls YouTube videos |
| Windows helper | C# and .NET 8 | Detects assigned keys while another app is focused |
| Installer | PowerShell | Builds and registers the helper for your Windows account |

## Install

1. Install Google Chrome and the .NET 8 SDK on Windows. Download or clone this repository and keep its folder in a permanent location.
2. Open PowerShell in the repository folder and run `powershell -ExecutionPolicy Bypass -File .\install.ps1`. This builds the helper and registers it for your Windows account.
3. Open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
4. Open a YouTube video and leave Chrome running.

The packaged extension has a fixed ID. Reinstalling it from this same folder preserves the native helper connection. After updating the code, run the installer again for helper changes and click **Reload** on the extension at `chrome://extensions`. To remove the helper registration, run `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`.

## How to use

1. Open the extension's **Settings**. Click **Record** beside an action, press a key or combination, and then click **Save settings**. Release a modifier to assign it alone; click **Cancel** to stop recording.
2. Assign **Toggle listening mode** if you want to use single-key hotkeys. Press that key or use the toolbar popup to turn listening on. A rising sound means ON; a falling sound means OFF. The popup also shows the current state.
3. Use your assigned keys for play/pause, volume, mute, seeking, Picture in Picture, and quality. Hold a volume or seek key to repeat it.
4. Choose a preferred quality in Settings, or press a quality up/down hotkey. A successful quality hotkey saves the selected resolution as the new preference for future video loads and reloads.

## Behavior

- Combinations work whether listening mode is on or off. Single-key actions work only while it is on. Assigned keys are withheld from the game when they trigger; unrelated keys pass through.
- New bindings use physical key scan codes, so Shift + Numpad 1 remains distinct from Shift + End even when Windows reports the same virtual key. Existing saved bindings continue to work.
- Seeking moves one second immediately, then repeats after the delay and at the interval configured in Settings (defaults: 300 ms and 125 ms). Volume uses the same hold-to-repeat timing.
- Volume changes the YouTube video's volume by 5%, not Windows or game volume.
- Listening mode plays a short rising sound when enabled and a falling sound when disabled. The sound uses the Windows output device and system volume.
- The most recently used YouTube video is selected, including after it is paused by a mouse click or exits Picture in Picture. When the extension restarts, it checks open video tabs.
- Preferred quality chooses the highest available resolution at or below your selected value. Quality up/down recognizes frame-rate labels such as 720p60 and 1080p60, and saves the new choice as the preference. The preference applies once per video so it does not undo a quality hotkey. It uses the English YouTube settings menu and is best effort.
- Picture in Picture can be closed with the hotkey. Chrome requires a recent interaction with the YouTube tab before opening it again, so reopening from a minimized Chrome window may be blocked. The popup shows this error when it happens.

## Performance and limits

The helper sleeps waiting for key events or messages. The extension observes playback events and YouTube navigation; it does not continuously inspect the page. An exclusive fullscreen game or its input handling can still prevent Windows from delivering a hotkey. Borderless fullscreen is the best mode to try if a key does not respond.

The recorder accepts keys delivered to the Windows keyboard hook, including modifiers and Escape. Windows-reserved shortcuts such as Ctrl+Alt+Delete cannot be intercepted by a normal app.

No extension can guarantee YouTube's default quality: YouTube can change the stream based on its conditions. The menu-based preference is reapplied at the start of a new video, not continuously.

## To-do and progress

- [x] Remember quality changes made with hotkeys after a reload.
- [ ] Find a reliable way to reopen Picture in Picture while Chrome is minimized, if Chrome permits it.

## Development

`extension/` is a Manifest V3 unpacked extension. `host/` is a .NET 8 Windows native messaging host. The public extension key in `manifest.json` gives the unpacked extension a stable ID. The helper uses the standard Chrome native messaging protocol over stdin/stdout, registered under the current user's Chrome NativeMessagingHosts registry key.
