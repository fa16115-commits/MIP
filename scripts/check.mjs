import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
for(const dir of ['api','lib','scripts','public/assets'])for(const f of fs.readdirSync(dir))if(/\.(js|mjs)$/.test(f))execFileSync(process.execPath,['--check',`${dir}/${f}`],{stdio:'inherit'});
console.log('JavaScript syntax checks passed');
