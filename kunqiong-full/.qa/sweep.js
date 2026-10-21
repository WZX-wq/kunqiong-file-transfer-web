// 全站自检: node sweep.js <width> <height>
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const root = path.resolve(__dirname, "..");
const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);

const child = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(__dirname, "prof-sweep-" + W),
  "--window-size=" + W + "," + H,
  "about:blank",
], { stdio: "ignore" });

const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on("error", rej);
});

const MEASURE = `(function(){
  var vw = document.documentElement.clientWidth;
  var offs = [];
  var nodes = document.querySelectorAll('#app *');
  for (var i=0;i<nodes.length;i++){var el=nodes[i];
    if(el.closest('.dock-panel')||el.closest('.dock')) continue;
    var r=el.getBoundingClientRect();
    if(r.width===0) continue;
    var sc=el.parentElement,scrollable=false;
    while(sc&&sc!==document.body){var ov=getComputedStyle(sc).overflowX;if(ov==='auto'||ov==='scroll'){scrollable=true;break}sc=sc.parentElement}
    if(scrollable) continue;
    if(r.right>vw+1.5||r.left<-1.5){offs.push((el.className&&typeof el.className==='string'?el.className.split(' ')[0]:el.tagName)+'@'+Math.round(r.left)+','+Math.round(r.right))}
  }
  return JSON.stringify({h:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight,sw:document.documentElement.scrollWidth,vw:vw,offs:offs.slice(0,4)});
})()`;

(async () => {
  for (let i = 0; i < 60; i++) { try { await getJson("/json/version"); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); } }
  const list = await getJson("/json/list");
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const errors = [];
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");
  await send("Page.navigate", { url: "file:///" + root.replace(/\\/g, "/") + "/prototype.html#/send-home" });
  let ids = null;
  for (let attempt = 0; attempt < 6 && !ids; attempt++) {
    for (let i = 0; i < 30; i++) {
      const r = await send("Runtime.evaluate", { expression: "typeof KQ", returnByValue: true });
      if (r.result && r.result.result && r.result.result.value === "object") break;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    const res = await send("Runtime.evaluate", { expression: "JSON.stringify(KQ.PAGES.map(p=>p.id))", returnByValue: true });
    const val = res.result && res.result.result ? res.result.result.value : undefined;
    if (typeof val === "string") ids = JSON.parse(val);
    else await send("Page.reload", {});
  }
  if (!ids) throw new Error("cannot read KQ.PAGES");
  const rows = [];
  for (const pid of ids) {
    errors.length = 0;
    await send("Runtime.evaluate", { expression: "location.hash='#/" + pid + "'" });
    await new Promise((r) => setTimeout(r, 280));
    const raw = (await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true })).result.result.value;
    const m = JSON.parse(raw);
    const live = (await send("Runtime.evaluate", { expression: "document.querySelector('.page').getAttribute('data-pid')||''", returnByValue: true })).result.result.value;
    rows.push(Object.assign({ id: pid, err: errors[0] || "none" }, m));
  }

  const bad = rows.filter((r) => r.err !== "none" || r.h < 0 || r.offs.length > 0 || r.sw > r.vw + 1);
  console.log("pages=" + rows.length + " bad=" + bad.length);
  bad.forEach((r) => console.log("  BAD " + r.id + " err=" + r.err + " sw=" + r.sw + "/" + r.vw + " offs=" + r.offs.join("|")));
  const scroll = rows.filter((r) => r.h > r.ch + 2).sort((a, b) => b.h - a.h);
  console.log("scrolling=" + scroll.length);
  scroll.forEach((r) => console.log("  " + r.id + " h=" + r.h + " over=" + (r.h - r.ch)));
  console.log("total=" + rows.reduce((s, r) => s + r.h, 0));
  ws.close(); child.kill(); process.exit(0);
})().catch((e) => { console.error("ERR", e.message); child.kill(); process.exit(1); });
