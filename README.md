# Custom YouTube Hotkeys

Control YouTube from a game on Windows using a Chrome extension and a small local helper. The helper listens for assigned keys only and sends action names to Chrome. It does not save keystrokes or use a network connection.

## Install

1. Keep this folder in a permanent location. The helper registration points to a manifest in `host/publish`, which selects the current helper build.
2. In PowerShell, run `powershell -ExecutionPolicy Bypass -File .\install.ps1` from this folder. It uses the installed .NET 8 SDK to build the helper and registers it for your Windows account.
3. Open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
4. Open the extension's **Settings**. Click **Record** and watch the highlighted row while you press a key or combination. Release a modifier to bind it alone; click **Cancel** to stop recording. Click **Save settings**. Assign **Toggle listening mode** before using single-key actions.
5. Leave Chrome open with a YouTube video. The toolbar popup shows whether the helper is connected and whether listening mode is on.

The packaged extension has a fixed ID. Reinstalling it from this same folder preserves the native helper connection. To remove the helper registration, run `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`.

## Behavior

- Combinations work whether listening mode is on or off. Single-key actions work only while it is on. Assigned keys are withheld from the game when they trigger; unrelated keys pass through.
- New bindings use physical key scan codes, so Shift + Numpad 1 remains distinct from Shift + End even when Windows reports the same virtual key. Existing saved bindings continue to work.
- Seeking moves one second immediately, then repeats after the delay and at the interval configured in Settings (defaults: 300 ms and 125 ms). Volume uses the same hold-to-repeat timing.
- Volume changes the YouTube video's volume by 5%, not Windows or game volume.
- Listening mode plays a short rising sound when enabled and a falling sound when disabled. The sound uses the Windows output device and system volume.
- The most recently used YouTube video is selected, including after it is paused by a mouse click or exits Picture in Picture. When the extension restarts, it checks open video tabs.
- Preferred quality chooses the highest available resolution at or below your selected value. Quality up/down recognizes frame-rate labels such as 720p60 and 1080p60. The preference applies once per video so it does not undo a quality hotkey. It uses the English YouTube settings menu and is best effort.
- Picture in Picture can be closed with the hotkey. Chrome requires a recent interaction with the YouTube tab before opening it again, so reopening from a minimized Chrome window may be blocked. The popup shows this error when it happens.

## Performance and limits

The helper sleeps waiting for key events or messages. The extension observes playback events and YouTube navigation; it does not continuously inspect the page. An exclusive fullscreen game or its input handling can still prevent Windows from delivering a hotkey. Borderless fullscreen is the best mode to try if a key does not respond.

The recorder accepts keys delivered to the Windows keyboard hook, including modifiers and Escape. Windows-reserved shortcuts such as Ctrl+Alt+Delete cannot be intercepted by a normal app.

No extension can guarantee YouTube's default quality: YouTube can change the stream based on its conditions. The menu-based preference is reapplied at the start of a new video, not continuously.

## Development

`extension/` is a Manifest V3 unpacked extension. `host/` is a .NET 8 Windows native messaging host. The public extension key in `manifest.json` gives the unpacked extension a stable ID. The helper uses the standard Chrome native messaging protocol over stdin/stdout, registered under the current user's Chrome NativeMessagingHosts registry key.
