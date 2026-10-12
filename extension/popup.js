async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "status" });
  document.getElementById("status").textContent = state.connected ? `Helper connected · Listening ${state.listening ? "ON" : "OFF"}` : "Helper unavailable — run install.ps1";
  document.getElementById("error").textContent = state.error || "";
}
document.getElementById("toggle").onclick = async () => { await chrome.runtime.sendMessage({ type: "toggleMode" }); setTimeout(refresh, 100); };
document.getElementById("settings").onclick = () => chrome.runtime.openOptionsPage();
refresh();
