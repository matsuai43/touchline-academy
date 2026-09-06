import fs from 'node:fs';
import path from 'node:path';
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
let out='THIRD PARTY SOFTWARE NOTICES\nGenerated from installed locked dependencies. Includes development tools as well as shipped client libraries.\n';
for(const dir of Object.keys(lock.packages).filter(Boolean)){const pp=path.join(dir,'package.json');if(!fs.existsSync(pp))continue;const p=JSON.parse(fs.readFileSync(pp,'utf8'));out+='\n\n====================================================\n'+p.name+' '+p.version+' | '+JSON.stringify(p.license||'See package license')+'\n';const files=fs.readdirSync(dir).filter(f=>/^(licen[sc]e|copying|notice)(\.|$)/i.test(f));for(const file of files){const loc=path.join(dir,file);if(fs.statSync(loc).isFile())out+=fs.readFileSync(loc,'utf8')+'\n';}}
fs.writeFileSync('public/THIRD_PARTY_NOTICES.txt',out);
console.log('Third-party notices written');
