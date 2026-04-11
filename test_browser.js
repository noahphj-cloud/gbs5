const http = require('http');
const BASE = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const APP_BASE = process.env.APP_BASE || 'http://127.0.0.1:3000';

function getJson(path, method='GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + path, { method }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch (e) { reject(new Error('Bad JSON: ' + data)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
class CDPPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
      } else if (msg.method) {
        for (const fn of this.events.get(msg.method) || []) fn(msg.params || {});
      }
    });
  }
  on(m, fn) { if (!this.events.has(m)) this.events.set(m, []); this.events.get(m).push(fn); }
  send(method, params={}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async init() {
    await this.ready;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
  }
  async navigate(url) {
    const loaded = new Promise(r => this.on('Page.loadEventFired', r));
    await this.send('Page.navigate', { url });
    await loaded;
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result ? res.result.value : undefined;
  }
  close() { this.ws.close(); }
}

(async()=>{
try {
  const target = await getJson('/json/new?' + encodeURIComponent(APP_BASE + '/'), 'PUT');
  const page = new CDPPage(target.webSocketDebuggerUrl);
  const logs = [];
  await page.init();
  page.on('Runtime.consoleAPICalled', (params) => logs.push({ type: params.type, text: (params.args || []).map(a => a.value).join(' ') }));
  page.on('Log.entryAdded', (params) => logs.push({ type: params.entry.level || 'log', text: params.entry.text || '' }));
  await page.navigate(APP_BASE + '/');

  const first = await page.eval(`(async () => {
    window.__alerts = [];
    window.alert = (msg) => window.__alerts.push(String(msg || ''));
    window.prompt = () => '테스터이름열자다';
    openModeSelect('gomoku');
    startOnline();
    await new Promise(r => setTimeout(r, 500));
    return {
      profile: localStorage.getItem('boardgame_online_profile_v2'),
      label: document.getElementById('onlineNameLabel').innerText,
      waiting: !!(document.getElementById('waitingOverlay') && document.getElementById('waitingOverlay').classList.contains('show')),
      alerts: window.__alerts.slice()
    };
  })()`);
  if (!first || !/닉네임은 최대 8글자/.test((first.alerts || []).join(' '))) throw new Error('Long-name validation missing: ' + JSON.stringify(first));

  const second = await page.eval(`(async () => {
    window.__alerts = [];
    window.prompt = () => '테스트한글';
    startOnline();
    await new Promise(r => setTimeout(r, 700));
    return {
      profile: localStorage.getItem('boardgame_online_profile_v2'),
      label: document.getElementById('onlineNameLabel').innerText,
      btn: document.getElementById('onlineNameEditBtn').innerText,
      waiting: !!(document.getElementById('waitingOverlay') && document.getElementById('waitingOverlay').classList.contains('show')),
      alerts: window.__alerts.slice()
    };
  })()`);
  if (!second || !/테스트한글/.test(second.profile || '')) throw new Error('Name not persisted after valid online start: ' + JSON.stringify(second));
  if (!/테스트한글/.test(second.label || '') || !/테스트한글/.test(second.btn || '')) throw new Error('Stored name not reflected in UI: ' + JSON.stringify(second));
  if (!second.waiting) throw new Error('Waiting overlay did not show');

  await page.eval(`cancelCurrentOnlineMatch()`);
  const edited = await page.eval(`(async () => {
    window.prompt = () => '새닉네임';
    const changed = await editOnlineProfile();
    return {
      changed,
      profile: localStorage.getItem('boardgame_online_profile_v2'),
      btn: document.getElementById('onlineNameEditBtn').innerText,
      label: document.getElementById('onlineNameLabel').innerText
    };
  })()`);
  if (!edited.changed) throw new Error('editOnlineProfile should resolve true');
  if (!/새닉네임/.test(edited.profile || '') || !/새닉네임/.test(edited.btn || '') || !/새닉네임/.test(edited.label || '')) {
    throw new Error('Edited name not reflected: ' + JSON.stringify(edited));
  }

  await page.navigate(APP_BASE + '/');
  const reloaded = await page.eval(`(() => ({
    profile: localStorage.getItem('boardgame_online_profile_v2'),
    btn: document.getElementById('onlineNameEditBtn').innerText,
    label: document.getElementById('onlineNameLabel').innerText
  }))()`);
  if (!/새닉네임/.test(reloaded.profile || '') || !/새닉네임/.test(reloaded.btn || '') || !/새닉네임/.test(reloaded.label || '')) {
    throw new Error('Stored name did not survive reload: ' + JSON.stringify(reloaded));
  }

  const errors = logs.filter(x => /(error|exception)/i.test(x.type) || /Uncaught|TypeError|ReferenceError/i.test(x.text));
  if (errors.length) throw new Error('Console errors seen: ' + JSON.stringify(errors.slice(0, 5)));

  console.log('BROWSER TESTS PASSED');
  page.close();
} catch (err) {
  console.error('BROWSER TEST FAILED');
  console.error(err);
  process.exit(1);
}
})();
