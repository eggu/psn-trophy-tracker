import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.argv[2] || 'https://psn-trophy-tracker.pages.dev';
const reportPath = process.argv[3] || 'docs/views-acceptance.json';
const snapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8')).metadata.lastSuccessfulSync;
const expectedTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(snapshot)) + ' KST';
const report = { snapshot, checkedAt: new Date().toISOString(), base, responses: [] };
for (const route of ['/agent', '/agent/status', '/agent/profile', '/agent/changes', '/agent/recent', '/agent/games', '/agent/game/NPWR12310_00']) {
  const res = await fetch(`${base}${route}`, { headers: { 'User-Agent': 'AIAgentBot/1.0' } });
  const body = await res.text();
  assert.equal(res.status, 200, route);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(body, /^# /);
  assert.doesNotMatch(body, /avatarUrl|iconUrl|<!DOCTYPE|<script/);
  assert.match(body, /KST/);
  assert.ok(body.includes(expectedTime), `${route}: expected current sync ${expectedTime}`);
  if (route === '/agent/games') assert.equal(body.split('\n').filter(line => /^\| .+ \| NPWR\d+_\d+ \|/.test(line)).length, 168);
  if (route === '/agent/recent') assert.equal(body.split('\n').filter(line => line.startsWith('| ')).length, 52);
  if (route === '/agent/game/NPWR12310_00') {
    assert.match(body, /Progress: 9\/30 \(18%\)/);
    assert.equal(body.match(/- \[ \]/g).length, 21);
    assert.equal(body.match(/- \[x\]/g).length, 9);
    assert.ok(body.indexOf('Remaining Trophies') < body.indexOf('Earned Trophies'));
    assert.match(body, /Last trophy: 2026-09-30 00:09:01 KST/);
  }
  report.responses.push({ route, status: res.status, contentType: res.headers.get('content-type'), bytes: Buffer.byteLength(body) });
}
for (const [route, method, status] of [['/agent', 'OPTIONS', 204], ['/agent/games', 'HEAD', 200], ['/agent', 'POST', 405], ['/agent/no-such-document', 'GET', 404], ['/agent/game/NPWR999999_00', 'GET', 404]]) {
  const res = await fetch(`${base}${route}`, { method });
  assert.equal(res.status, status, `${method} ${route}`);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  report.responses.push({ route, method, status: res.status });
}
if (base.includes('pages.dev') || base.includes('localhost')) {
  for (const route of ['/', '/games', '/game/NPWR12310_00']) {
    const res = await fetch(`${base}${route}`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(html, /src="\/app.js"/);
    report.responses.push({ route, status: res.status, contentType: res.headers.get('content-type') });
  }
}
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Verified ${report.responses.length} responses at ${base}`);
