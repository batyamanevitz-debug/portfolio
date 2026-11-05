// מושך את התוכן המפורסם מ-Supabase ל-content.json, ואז בונה את index.html.
// רץ מקומית או ב-GitHub Actions פעם ביום (גם שומר על Supabase ער).
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, document: { currentScript: null }, fetch, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'site.js'), 'utf8'), ctx);
const live = await ctx.window.Site.fetchLive();
if (!live.docs.home || !live.entries.length) { console.error('Supabase returned empty content – keeping the old backup'); process.exit(1); }
const file = path.join(root, 'content.json');
const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).stamp : '';
fs.writeFileSync(file, JSON.stringify(live, null, 1));
console.log(before === live.stamp ? 'no changes' : 'content updated');
execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], { stdio: 'inherit' });
