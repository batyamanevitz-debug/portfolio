// מפיק SQL שמכניס את content.json ל-Supabase (פעם אחת, בהעברה)
import fs from 'fs';
const d = JSON.parse(fs.readFileSync(new URL('../content.json', import.meta.url), 'utf8'));
const j = (o) => `$J$${JSON.stringify(o)}$J$::jsonb`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let sql = '';
for (const [id, doc] of Object.entries(d.docs)) sql += `insert into public.pf_site_docs (id, doc) values (${q(id)}, ${j(doc)}) on conflict (id) do nothing;\n`;
for (const e of d.entries) sql += `insert into public.pf_entries (id, type, status, sort, data) values (${q(e.id)}, ${q(e.type)}, ${q(e.status)}, ${e.sort}, ${j(e.data)}) on conflict (id) do nothing;\n`;
for (const [k, v] of Object.entries(d.settings)) sql += `insert into public.pf_settings (key, value) values (${q(k)}, ${j(v)}) on conflict (key) do nothing;\n`;
fs.writeFileSync(new URL('../supabase/002_seed.sql', import.meta.url), sql);
console.log(sql.length);
