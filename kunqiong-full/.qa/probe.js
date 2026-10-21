// 用法: node probe.js <hash> <width> <height> [js表达式]
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const root = path.resolve(__dirname, "..");
const hash = process.argv[2] || "collect-create";
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 900);
const expr = process.argv[5] || "JSON.stringify({h:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight})";

const url = "file:///" + root.replace(/\\/g, "/") + "/prototype.html#/" + hash;

const child = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(__dirname, "prof"),
  "--window-size=" + W + "," + H,
  "about:blank",
], { stdio: "ignore" });

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { return await getJson("/json/version"); } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("chrome not ready");
}

(async () => {
  await waitReady();
  const list = await getJson("/json/list");
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 1600));
  const out = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(typeof out.result.result.value === "string" ? out.result.result.value : JSON.stringify(out.result.result.value || out.result, null, 2));
  ws.close();
  child.kill();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); child.kill(); process.exit(1); });
