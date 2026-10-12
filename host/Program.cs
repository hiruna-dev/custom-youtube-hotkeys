using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.Json;

internal sealed record Binding(string Action, int Key, int? Scan, bool Extended, bool Ctrl, bool Alt, bool Shift, bool Win);

internal static class Program
{
    private const int WhKeyboardLl = 13, WmKeyDown = 0x100, WmKeyUp = 0x101,
        WmSysKeyDown = 0x104, WmSysKeyUp = 0x105, WmQuit = 0x12;
    private static readonly Dictionary<int, int> Down = new();
    private static readonly HashSet<int> Suppressed = new();
    private static readonly ConcurrentQueue<object> Outbox = new();
    private static readonly AutoResetEvent OutboxSignal = new(false);
    private static readonly object Gate = new();
    private static Binding[] bindings = Array.Empty<Binding>();
    private static bool listening;
    private static string? heldAction;
    private static bool capturing;
    private static int? captureModifier;
    private static (bool ctrl, bool alt, bool shift, bool win)? captureModifierFlags;
    private static int repeatDelay = 300, repeatInterval = 125;
    private static Timer? repeat;
    private static HookProc? hookProc;
    private static uint threadId;

    private static void Main()
    {
        // Chrome speaks 4-byte length-prefixed UTF-8 JSON through binary stdin/stdout.
        Console.InputEncoding = System.Text.Encoding.UTF8;
        threadId = GetCurrentThreadId();
        hookProc = OnKeyboard;
        var hook = SetWindowsHookEx(WhKeyboardLl, hookProc, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero) return;
        Task.Run(WriteMessages);
        Task.Run(ReadMessages);
        Enqueue(new { type = "ready" });
        try { while (GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { } }
        finally { UnhookWindowsHookEx(hook); repeat?.Dispose(); }
    }

    private static async Task ReadMessages()
    {
        using var input = Console.OpenStandardInput();
        var length = new byte[4];
        try
        {
            while (await ReadExactlyOrEof(input, length))
            {
                int size = BitConverter.ToInt32(length);
                if (size < 0 || size > 1024 * 1024) break;
                var bytes = new byte[size];
                if (!await ReadExactlyOrEof(input, bytes)) break;
                using var json = JsonDocument.Parse(bytes);
                var root = json.RootElement;
                string? type = root.GetProperty("type").GetString();
                if (type == "config")
                {
                    var next = new List<Binding>();
                    if (root.TryGetProperty("bindings", out var items) && items.ValueKind == JsonValueKind.Object)
                        foreach (var item in items.EnumerateObject())
                        {
                            var v = item.Value;
                            if (v.ValueKind != JsonValueKind.Object) continue;
                            int? scan = v.TryGetProperty("scan", out var s) && s.TryGetInt32(out int n) ? n : null;
                            int vk = v.TryGetProperty("vk", out var k) && k.TryGetInt32(out int value) ? value :
                                v.TryGetProperty("key", out var key) ? KeyCode(key.GetString()) : 0;
                            if (scan is null && vk == 0) continue;
                            next.Add(new Binding(item.Name, vk, scan, Flag(v, "extended"), Flag(v, "ctrl"), Flag(v, "alt"), Flag(v, "shift"), Flag(v, "win")));
                        }
                    lock (Gate)
                    {
                        bindings = next.ToArray();
                        repeatDelay = Clamp(root, "repeatDelay", 300, 100, 1000);
                        repeatInterval = Clamp(root, "repeatInterval", 125, 50, 500);
                        listening = false;
                        Down.Clear();
                        Suppressed.Clear();
                        StopRepeat();
                    }
                    Enqueue(new { type = "mode", listening = false });
                }
                else if (type == "toggleMode") ToggleMode();
                else if (type == "beginCapture")
                {
                    lock (Gate) { capturing = true; captureModifier = null; captureModifierFlags = null; StopRepeat(); }
                    Enqueue(new { type = "captureReady" });
                }
                else if (type == "cancelCapture")
                {
                    lock (Gate) { capturing = false; captureModifier = null; captureModifierFlags = null; }
                }
            }
        }
        catch { /* Chrome closed the pipe. */ }
        PostThreadMessage(threadId, WmQuit, IntPtr.Zero, IntPtr.Zero);
    }

    private static bool Flag(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
    private static int Clamp(JsonElement item, string name, int fallback, int min, int max) =>
        item.TryGetProperty(name, out var value) && value.TryGetInt32(out int number) ? Math.Clamp(number, min, max) : fallback;

    private static async Task<bool> ReadExactlyOrEof(Stream stream, byte[] buffer)
    {
        int read = 0;
        while (read < buffer.Length)
        {
            int count = await stream.ReadAsync(buffer.AsMemory(read));
            if (count == 0) return false;
            read += count;
        }
        return true;
    }

    private static void WriteMessages()
    {
        using var output = Console.OpenStandardOutput();
        while (true)
        {
            OutboxSignal.WaitOne();
            while (Outbox.TryDequeue(out var message))
            {
                try
                {
                    var data = JsonSerializer.SerializeToUtf8Bytes(message);
                    output.Write(BitConverter.GetBytes(data.Length));
                    output.Write(data);
                    output.Flush();
                }
                catch { return; }
            }
        }
    }

    private static void Enqueue(object message) { Outbox.Enqueue(message); OutboxSignal.Set(); }
    private static void ToggleMode()
    {
        lock (Gate)
        {
            listening = !listening;
            StopRepeat();
            Enqueue(new { type = "mode", listening });
        }
    }

    private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(IntPtr.Zero, code, message, data);
        var info = Marshal.PtrToStructure<KbdLlHookStruct>(data);
        int vk = (int)info.VkCode;
        int scan = (int)info.ScanCode;
        bool extended = (info.Flags & 1) != 0;
        bool keyDown = message == (IntPtr)WmKeyDown || message == (IntPtr)WmSysKeyDown;
        bool keyUp = message == (IntPtr)WmKeyUp || message == (IntPtr)WmSysKeyUp;
        bool block = HandleKey(vk, scan, extended, keyDown, keyUp);
        return block ? (IntPtr)1 : CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    internal static bool HandleKey(int vk, int scan, bool extended, bool keyDown, bool keyUp)
    {
        int identity = scan != 0 ? scan | (extended ? 0x10000 : 0) : 0x20000 | vk;
        bool block = false;
        lock (Gate)
        {
            if (capturing)
            {
                if (keyDown && !Down.ContainsKey(identity))
                {
                    Down[identity] = vk;
                    var flags = ModifierFlags(identity);
                    string label = KeyLabel(scan, extended, vk);
                    Enqueue(new { type = "capturePreview", key = label, ctrl = flags.ctrl, alt = flags.alt, shift = flags.shift, win = flags.win });
                    if (IsModifier(vk)) { captureModifier = identity; captureModifierFlags = flags; }
                    else CompleteCapture(scan, extended, vk, label, flags);
                }
                else if (keyUp)
                {
                    if (capturing && captureModifier == identity)
                    {
                        var flags = captureModifierFlags ?? ModifierFlags(identity);
                        CompleteCapture(scan, extended, vk, KeyLabel(scan, extended, vk), flags);
                    }
                    Down.Remove(identity);
                }
                return true;
            }
            if (keyDown)
            {
                bool first = !Down.ContainsKey(identity);
                Down[identity] = vk;
                if (first)
                {
                    var (ctrl, alt, shift, win) = ModifierFlags(identity);
                    var binding = bindings.FirstOrDefault(b => (b.Scan is int saved ? saved == scan && b.Extended == extended && (saved != 0 || b.Key == vk) : b.Key == vk) &&
                        // AltGr layouts can synthesize a Ctrl event around Right Alt. Its
                        // timing differs across keyboards, so it cannot distinguish a
                        // Right Alt binding from a deliberate Ctrl + Right Alt binding.
                        (b.Ctrl == ctrl || (scan == 0x38 && extended)) && b.Alt == alt && b.Shift == shift && b.Win == win &&
                        (b.Action == "toggleMode" || b.Ctrl || b.Alt || b.Shift || b.Win || listening));
                    if (binding != null)
                    {
                        Suppressed.Add(identity);
                        block = true;
                        if (binding.Action == "toggleMode") ToggleMode();
                        else
                        {
                            Enqueue(new { type = "command", action = binding.Action });
                            if (binding.Action is "seekForward" or "seekBackward" or "volumeUp" or "volumeDown")
                            {
                                heldAction = binding.Action;
                                repeat?.Dispose();
                                repeat = new Timer(_ => { lock (Gate) { if (heldAction != null) Enqueue(new { type = "command", action = heldAction }); } }, null, repeatDelay, repeatInterval);
                            }
                        }
                    }
                }
                else block = Suppressed.Contains(identity);
            }
            else if (keyUp)
            {
                Down.Remove(identity);
                block = Suppressed.Remove(identity);
                if (heldAction != null && (block || IsModifier(vk))) StopRepeat();
            }
        }
        return block;
    }

    private static void CompleteCapture(int scan, bool extended, int vk, string label, (bool ctrl, bool alt, bool shift, bool win) flags)
    {
        capturing = false; captureModifier = null; captureModifierFlags = null;
        Enqueue(new { type = "captureDone", key = label, scan, extended, vk, ctrl = flags.ctrl, alt = flags.alt, shift = flags.shift, win = flags.win });
    }
    private static (bool ctrl, bool alt, bool shift, bool win) ModifierFlags(int terminal)
    {
        var keys = Down.Where(pair => pair.Key != terminal).Select(pair => pair.Value).ToArray();
        return (keys.Any(v => v is 0x11 or 0xA2 or 0xA3), keys.Any(v => v is 0x12 or 0xA4 or 0xA5),
            keys.Any(v => v is 0x10 or 0xA0 or 0xA1), keys.Any(v => v is 0x5B or 0x5C));
    }
    private static string KeyLabel(int scan, bool extended, int vk)
    {
        var name = new System.Text.StringBuilder(64);
        int lParam = (scan << 16) | (extended ? 1 << 24 : 0);
        if (GetKeyNameText(lParam, name, name.Capacity) > 0) return name.ToString();
        return $"VK {vk:X2}";
    }
    private static void StopRepeat() { heldAction = null; repeat?.Dispose(); repeat = null; }
    private static bool IsModifier(int vk) => vk is 0x11 or 0xA2 or 0xA3 or 0x12 or 0xA4 or 0xA5 or 0x10 or 0xA0 or 0xA1 or 0x5B or 0x5C;
    private static int KeyCode(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return 0;
        if (key.Length == 1)
        {
            char c = char.ToUpperInvariant(key[0]);
            if (c is >= 'A' and <= 'Z' or >= '0' and <= '9') return c;
        }
        if (key.StartsWith('F') && int.TryParse(key[1..], out int n) && n is >= 1 and <= 24) return 0x6F + n;
        if (key.StartsWith("Numpad") && int.TryParse(key[6..], out n) && n is >= 0 and <= 9) return 0x60 + n;
        return key switch
        {
            "Space" => 0x20, "ArrowLeft" => 0x25, "ArrowUp" => 0x26, "ArrowRight" => 0x27, "ArrowDown" => 0x28,
            "Comma" => 0xBC, "Period" => 0xBE, "Slash" => 0xBF, "Semicolon" => 0xBA, "Quote" => 0xDE,
            "BracketLeft" => 0xDB, "BracketRight" => 0xDD, "Backslash" => 0xDC, "Minus" => 0xBD, "Equal" => 0xBB,
            "Insert" => 0x2D, "Delete" => 0x2E, "Home" => 0x24, "End" => 0x23, "PageUp" => 0x21, "PageDown" => 0x22,
            _ => 0
        };
    }

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct KbdLlHookStruct
    {
        public uint VkCode, ScanCode, Flags, Time;
        public IntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] private struct WinMessage
    {
        public IntPtr Hwnd;
        public uint Message;
        public IntPtr WParam, LParam;
        public uint Time;
        public int PointX, PointY;
        public uint Private;
    }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out WinMessage msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, int msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetKeyNameText(int lParam, System.Text.StringBuilder name, int size);
}
