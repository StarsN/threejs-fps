// Screenshot helper over Chrome DevTools Protocol (the Hatch Chromium
// build's --screenshot flag writes nothing, but its remote-debugging endpoint
// works).
// Usage: node tools/shot.mjs <url> <out.jpg> [width] [height]
// Assumes a Chrome is already running with --remote-debugging-port=$CDP_PORT
// (default 9223). This machine's Hatch Chromium build cannot create a WebGL
// context, so screenshots use a stock chrome-headless-shell on that port.
// Waits for window.__shotReady (the game's frozen capture frame), then saves
// a JPEG. Console errors are printed so a broken game is visible, not silent.
import fs from 'node:fs';

const CDP_PORT = process.env.CDP_PORT ?? '9223';

const [, , url, out, wArg, hArg] = process.argv;
if (!url || !out) {
  process.stderr.write('usage: node tools/shot.mjs <url> <out.jpg> [width] [height]\n');
  process.exit(2);
}
const width = Number(wArg ?? 1280);
const height = Number(hArg ?? 800);

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
let page = list.find((t) => t.type === 'page');
if (!page) {
  // chrome-headless-shell starts with no targets; create one.
  page = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
}
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);

let id = 0;
const pending = new Map();
let loadResolve;
const loaded = new Promise((r) => { loadResolve = r; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(`${m.error.message}`));
    else resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text ?? 'exception';
    process.stderr.write(`page exception: ${e}\n`);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    process.stderr.write(`console error: ${text}\n`);
  } else if (m.method === 'Page.loadEventFired') {
    loadResolve();
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'about:blank' });
await new Promise((r) => setTimeout(r, 400));
await send('Page.navigate', { url });
await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
// Poll for the game's frozen capture frame.
let ready = false;
for (let i = 0; i < 60; i += 1) {
  const { result } = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
  if (result?.value) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  const { result } = await send('Runtime.evaluate', { expression: 'document.title + " | " + (window.__shotError ?? "no __shotReady")', returnByValue: true });
  process.stderr.write(`shot not ready after 30s: ${result?.value}\n`);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 300));
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
process.stdout.write(`wrote ${out} (${fs.statSync(out).size} bytes)\n`);
process.exit(0);
