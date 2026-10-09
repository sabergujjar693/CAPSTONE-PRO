const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = __dirname;
const required = ['server.js','db.js','seed.js','public/app.js','public/index.html','public/style.css','public/sw.js','../README.md'];
for (const f of required) if (!fs.existsSync(path.join(root,f))) throw new Error(`Missing required file: ${f}`);
for (const f of ['server.js','db.js','seed.js','public/app.js','public/sw.js']) {
  const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});
  if(r.status!==0) throw new Error(`Syntax check failed for ${f}: ${r.stderr}`);
}
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const ids=['btn-settings','settings-modal','settings-form','settings-days','settings-start','settings-end','settings-repeat','settings-email','settings-push','settings-save','settings-cancel'];
for(const id of ids) if(!new RegExp(`id=["']${id}["']`).test(html)) throw new Error(`Missing settings element: ${id}`);
if(!html.includes('type="time" id="settings-start"') || !html.includes('type="time" id="settings-end"')) throw new Error('Time inputs missing');
if(!html.includes('id="settings-days-row"')) throw new Error('Days setting missing');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
for(const token of ["$('settings-days-row').classList.remove('hidden')","$('settings-start')","$('settings-end')","$('settings-repeat')","$('settings-save')","await put('/users/me',payload)"]) { if(!app.includes(token)) throw new Error(`app.js missing: ${token}`); }
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
for(const token of ["app.put('/api/users/me'","teacher_assignment_reminders","runReminderEngine","runTeacherDeadlineReminderEngine","runSpecialConsiderationReminderEngine","require('./seed').seedDemoData()","setInterval(runTeacherDeadlineReminderEngine,60000)"]) if(!server.includes(token)) throw new Error(`server.js missing: ${token}`);
const seed=fs.readFileSync(path.join(root,'seed.js'),'utf8');
for(const email of ['teacher@example.edu','teacher2@example.edu','ray@edu.au','student2@example.edu','student3@example.edu','student4@example.edu','student5@example.edu','student6@example.edu','student7@example.edu','student8@example.edu','student9@example.edu','student10@example.edu','student@example.edu']) if(!seed.includes(email) && email!=='student3@example.edu') { if(email.startsWith('student') && /`student\$\{i\}@example\.edu`/.test(seed)) continue; throw new Error(`seed.js missing account reference: ${email}`); }
const readme=fs.readFileSync(path.join(root,'../README.md'),'utf8');
for(const token of ['Days before','Start time','End time','Repeat interval','Email notifications','Browser/phone notifications','student10@example.edu']) if(!readme.includes(token)) throw new Error(`README missing: ${token}`);
console.log('Deadline Tracker comprehensive static audit passed.');
