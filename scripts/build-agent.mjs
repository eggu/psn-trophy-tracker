import fs from 'node:fs/promises';
import { renderManifest, renderStatus } from '../agent/render.ts';

const output = process.argv[2] || 'agent';
const assets = 'dashboard/dist/agent';
const metadata = JSON.parse(await fs.readFile(`${assets}/metadata.json`, 'utf8'));
const files = { 'README.md': renderManifest(metadata), 'STATUS.md': renderStatus(metadata) };
for (const name of ['profile', 'changes', 'recent', 'games']) files[`${name.toUpperCase()}.md`] = await fs.readFile(`${assets}/${name}.md`, 'utf8');
for (const file of await fs.readdir(`${assets}/game`)) if (/^NPWR\d+_\d+\.md$/.test(file)) files[`games/${file}`] = await fs.readFile(`${assets}/game/${file}`, 'utf8');
await fs.mkdir(`${output}/games`, { recursive: true });
for (const [file, markdown] of Object.entries(files)) {
  const linked = markdown.replace(/\]\(\/agent\/game\/(NPWR\d+_\d+)\)/g, '](games/$1.md)')
    .replaceAll('/agent/game/{id}', 'games/{id}.md')
    .replace(/\/agent\/(status|profile|changes|recent|games)\b/g, (_, name) => `${name.toUpperCase()}.md`);
  await fs.writeFile(`${output}/${file}`, linked);
}
console.log(`Repository Agent Markdown written: ${Object.keys(files).length} files in ${output}/`);
