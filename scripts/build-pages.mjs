import fs from 'node:fs/promises';
import path from 'node:path';
const output = 'dashboard/dist';
await fs.mkdir(output, { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css']) await fs.copyFile(`dashboard/${file}`, `${output}/${file}`);
await fs.cp('data', `${output}/data`, { recursive: true });
const entries = [];
for (const file of await fs.readdir('data/history', { recursive: true })) {
  if (!file.endsWith('.json') || file === 'index.json') continue;
  const snapshot = JSON.parse(await fs.readFile(path.join('data/history', file), 'utf8'));
  entries.push({ timestamp: snapshot.metadata.lastSuccessfulSync, path: `/data/history/${file.split(path.sep).join('/')}` });
}
entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
await fs.writeFile(`${output}/data/history/index.json`, JSON.stringify(entries));
await fs.writeFile(`${output}/_routes.json`, JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }));
console.log(`Pages assets built with ${entries.length} history entries`);
