# Ren's YouTube Hotkeys

Control YouTube from a game on Windows using a Chrome extension and a small local helper. The helper listens for assigned keys only and sends action names to Chrome. It does not save keystrokes or use a network connection.

## Install

1. Keep this folder in a permanent location. The helper registration points to its `host/publish` directory.
2. In PowerShell, run `powershell -ExecutionPolicy Bypass -File .\install.ps1` from this folder. It uses the installed .NET 8 SDK to build the helper and registers it for your Windows account.
3. Open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
4. Open the extension's **Settings**. Record your own keys and click **Save settings**. Assign **Toggle listening mode** before using single-key actions.
5. Leave Chrome open with a YouTube video. The toolbar popup shows whether the helper is connected and whether listening mode is on.

The packaged extension has a fixed ID. Reinstalling it from this same folder preserves the native helper connection. To remove the helper registration, run `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`.

## Behavior

- Combinations work whether listening mode is on or off. Single-key actions work only while it is on. Assigned keys are withheld from the game when they trigger; unrelated keys pass through.
- Seeking moves one second immediately, then repeats after the delay and at the interval configured in Settings (defaults: 300 ms and 125 ms).
- Volume changes the YouTube video's volume by 5%, not Windows or game volume.
- The most recently playing YouTube tab is selected. When the helper restarts, it checks open tabs for a playing video.
- Preferred quality chooses the highest available resolution at or below your selected value. It uses the English YouTube settings menu and is best effort. If YouTube changes its menu, quality actions may fail until the extension is updated.
- Picture in Picture depends on Chrome allowing the action from a background tab. Its failure is shown in the popup.

## Performance and limits

The helper sleeps waiting for key events or messages. The extension observes playback events and YouTube navigation; it does not continuously inspect the page. An exclusive fullscreen game or its input handling can still prevent Windows from delivering a hotkey. Borderless fullscreen is the best mode to try if a key does not respond.

No extension can guarantee YouTube's default quality: YouTube can change the stream based on its conditions. The menu-based preference is reapplied at the start of a new video, not continuously.

## Development

`extension/` is a Manifest V3 unpacked extension. `host/` is a .NET 8 Windows native messaging host. The public extension key in `manifest.json` gives the unpacked extension a stable ID. The helper uses the standard Chrome native messaging protocol over stdin/stdout, registered under the current user's Chrome NativeMessagingHosts registry key.
