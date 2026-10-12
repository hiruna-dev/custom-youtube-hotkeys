using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;

internal static class HotkeyTests
{
    private static readonly Type Host = typeof(Program);
    private static T Get<T>(string name) => (T)Host.GetField(name, BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
    private static void Set(string name, object? value) => Host.GetField(name, BindingFlags.NonPublic | BindingFlags.Static)!.SetValue(null, value);
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static List<JsonElement> Drain()
    {
        var messages = new List<JsonElement>();
        var queue = Get<ConcurrentQueue<object>>("Outbox");
        while (queue.TryDequeue(out var item)) messages.Add(JsonSerializer.SerializeToElement(item));
        return messages;
    }
    private static int Commands(string action) => Drain().Count(x =>
        x.GetProperty("type").GetString() == "command" && x.GetProperty("action").GetString() == action);

    public static void Main()
    {
        // The release order of AltGr's synthetic Ctrl must not change what was recorded.
        Set("capturing", true);
        Program.HandleKey(0xA2, 0x1D, false, true, false);
        Program.HandleKey(0xA5, 0x38, true, true, false);
        Program.HandleKey(0xA2, 0x1D, false, false, true);
        Program.HandleKey(0xA5, 0x38, true, false, true);
        var capture = Drain().Single(x => x.GetProperty("type").GetString() == "captureDone");
        Check(capture.GetProperty("scan").GetInt32() == 0x38 && capture.GetProperty("extended").GetBoolean(), "Right Alt physical key was not recorded");
        Check(capture.GetProperty("ctrl").GetBoolean(), "Modifier snapshot was lost before Right Alt release");

        Get<Dictionary<int, int>>("Down").Clear();
        Set("bindings", new[] { new Binding("toggleMode", 0xA5, 0x38, true, false, false, false, false) });
        Set("listening", false);
        Program.HandleKey(0xA2, 0x1D, false, true, false);
        Check(Program.HandleKey(0xA5, 0x38, true, true, false), "Right Alt toggle was not consumed with synthetic Ctrl");
        Check(Get<bool>("listening"), "Right Alt did not turn listening on");
        Program.HandleKey(0xA5, 0x38, true, false, true);
        Program.HandleKey(0xA2, 0x1D, false, false, true);
        Program.HandleKey(0xA5, 0x38, true, true, false);
        Check(!Get<bool>("listening"), "Right Alt did not turn listening off");
        Program.HandleKey(0xA5, 0x38, true, false, true);
        Drain();

        Set("bindings", new[] { new Binding("volumeDown", 0x77, 0x42, false, false, false, false, false) });
        Set("listening", true);
        Set("repeatDelay", 100);
        Set("repeatInterval", 50);
        Check(Program.HandleKey(0x77, 0x42, false, true, false), "Volume key was not consumed");
        Check(Commands("volumeDown") == 1, "Volume did not change immediately");
        Thread.Sleep(230);
        Check(Commands("volumeDown") >= 2, "Volume did not repeat while held");
        Program.HandleKey(0x77, 0x42, false, false, true);
        Thread.Sleep(110);
        Check(Commands("volumeDown") == 0, "Volume continued after key release");
        Console.WriteLine("Right Alt toggle and held volume passed.");
    }
}
