const API='/api'; let currentUser=null, unitsCache=[], teacherData=null;
async function api(url,opts={}){const r=await fetch(API+url,{credentials:'include',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}}); if(r.status===401){showAuth();throw Error('Not signed in')} let d=null;try{d=await r.json()}catch{} if(!r.ok)throw Error(d?.error||'Request failed');return d}
const get=u=>api(u); const post=(u,b)=>api(u,{method:'POST',body:JSON.stringify(b)}); const put=(u,b)=>api(u,{method:'PUT',body:JSON.stringify(b)}); const del=(u,b)=>api(u,{method:'DELETE',body:b?JSON.stringify(b):undefined});
const $=id=>document.getElementById(id); const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function fmt(d){return d?new Date(d+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'Not assigned'}
function showAuth(){$('auth-screen').classList.remove('hidden');$('app').classList.add('hidden')} function showApp(){$('auth-screen').classList.add('hidden');$('app').classList.remove('hidden')}
$('tab-signin').onclick=()=>{ $('tab-signin').classList.add('active');$('tab-signup').classList.remove('active');$('signin-form').classList.remove('hidden');$('signup-form').classList.add('hidden')};
$('tab-signup').onclick=()=>{ $('tab-signup').classList.add('active');$('tab-signin').classList.remove('active');$('signup-form').classList.remove('hidden');$('signin-form').classList.add('hidden')};
document.querySelectorAll('.password-toggle').forEach(btn=>btn.onclick=()=>{const input=$(btn.dataset.target);const showing=input.type==='text';input.type=showing?'password':'text';btn.textContent=showing?'👁':'🙈';btn.setAttribute('aria-label',showing?'Show password':'Hide password')});
$('signin-form').onsubmit=async e=>{
  e.preventDefault();
  const email=$('signin-email').value.trim();
  const password=$('signin-password').value;
  $('auth-error').classList.add('hidden');
  if(!email||!password){$('auth-error').textContent='Please enter your email and password.';$('auth-error').classList.remove('hidden');return;}
  const button=e.submitter||e.target.querySelector('button[type=submit]');
  try{
    if(button){button.disabled=true;button.textContent='Signing in...';}
    currentUser=await post('/auth/login',{email,password});
    await afterLogin();
  }catch(x){
    console.error('Sign in failed:',x);
    $('auth-error').textContent=x.message||'Sign in failed. Please check your email and password.';
    $('auth-error').classList.remove('hidden');
  }finally{
    if(button){button.disabled=false;button.textContent='Sign in';}
  }
};
$('signup-form').onsubmit=async e=>{e.preventDefault();try{currentUser=await post('/auth/signup',{name:$('signup-name').value,email:$('signup-email').value,password:$('signup-password').value,role:$('signup-role').value});afterLogin()}catch(x){$('auth-error').textContent=x.message;$('auth-error').classList.remove('hidden')}};
$('btn-logout').onclick=async()=>{await post('/auth/logout');location.reload()};
function switchTab(id){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));$('tab-'+id).classList.add('active');if(id==='dashboard')loadDashboard();if(id==='units')loadStudentUnits();if(id==='calendar')renderCalendar();if(id==='requests')loadMyRequests();if(id==='teacher-assignments')loadTeacherAssignments();if(id==='teacher-groups')loadTeacherStudents();if(id==='teacher-students')loadTeacherStudents();if(id==='review')loadReview()}
// replace switch button identity cleanly
function rebuildTabs(){const teacher=currentUser.role==='teacher';const list=teacher?[['teacher-assignments','Assignments'],['teacher-groups','Student Groups'],['teacher-students','Students & Enrolments'],['review','Special Consideration']]:[['dashboard','My Assignments'],['units','My Units'],['calendar','Calendar'],['requests','Special Consideration']];$('tabs').innerHTML='';document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));list.forEach((t,i)=>{const b=document.createElement('button');b.className='tab-btn'+(i===0?' active':'');b.dataset.tab=t[0];b.textContent=t[1];b.onclick=()=>switchTab(t[0]);$('tabs').appendChild(b)});$('tab-'+list[0][0]).classList.add('active')}
async function afterLogin(){showApp();rebuildTabs();$('current-user-name').textContent=`${currentUser.name} (${currentUser.role})`;await refresh()}
// notifications
$('bell-btn').onclick=async()=>{$('bell-dropdown').classList.toggle('hidden');if(!$('bell-dropdown').classList.contains('hidden'))loadNotifications()};document.addEventListener('click',e=>{if(!e.target.closest('.bell-wrap'))$('bell-dropdown').classList.add('hidden')});$('mark-all-read').onclick=async()=>{await post('/notifications/read-all');loadNotifications()};
async function loadNotifications(){const d=await get('/notifications');$('bell-badge').textContent=d.unread_count;$('bell-badge').classList.toggle('hidden',!d.unread_count);$('notification-list').innerHTML=d.notifications.length?d.notifications.map(n=>`<div class="notification-item ${n.is_read?'':'unread'}" data-n="${n.id}">${esc(n.message)}<span class="n-time">${new Date(n.created_at.replace(' ','T')+'Z').toLocaleString()}</span></div>`).join(''):'<div class="notification-empty">No notifications yet.</div>';document.querySelectorAll('[data-n]').forEach(x=>x.onclick=async()=>{await post('/notifications/'+x.dataset.n+'/read');loadNotifications()})}
async function badge(){const d=await get('/notifications');$('bell-badge').textContent=d.unread_count;$('bell-badge').classList.toggle('hidden',!d.unread_count)}
// student dashboard
async function loadDashboard(){const a=await get('/assignments');const open=a.filter(x=>x.status!=='Done');$('stat-total').textContent=open.length;$('stat-urgent').textContent=open.filter(x=>x.days_left>=0&&x.days_left<=currentUser.reminder_days_before).length;$('stat-overdue').textContent=open.filter(x=>x.days_left<0).length;const tb=$('assignment-rows');tb.innerHTML=a.length?a.map(x=>`<tr><td><span class="badge ${esc(x.priority)}">${esc(x.priority)}</span></td><td><strong>${esc(x.title)}</strong><br><small>${esc(x.notes||'')}</small></td><td>${esc(x.unit_code)}</td><td>${fmt(x.due_date)}</td><td class="days-left ${x.days_left<0?'overdue':x.days_left<=currentUser.reminder_days_before?'urgent':'ok'}">${x.days_left<0?Math.abs(x.days_left)+'d overdue':x.days_left===0?'Due today':x.days_left+'d left'}</td><td>${x.weighting||0}%</td><td><select data-status="${x.id}"><option ${x.status==='Not started'?'selected':''}>Not started</option><option ${x.status==='In progress'?'selected':''}>In progress</option><option ${x.status==='Done'?'selected':''}>Done</option></select></td><td><button class="icon-btn" title="Request Special Consideration" data-sc="${x.id}" data-title="${esc(x.title)}">🎓</button></td></tr>`).join(''):'<tr><td colspan="8">No assignments have been assigned to you yet.</td></tr>';document.querySelectorAll('[data-status]').forEach(s=>s.onchange=async()=>{const a=await get('/assignments');const x=a.find(y=>y.id==s.dataset.status);await put('/assignments/'+s.dataset.status,{status:s.value,notes:x.notes||''});loadDashboard()});document.querySelectorAll('[data-sc]').forEach(b=>b.onclick=()=>openSC(b.dataset.sc,b.dataset.title))}
async function loadStudentUnits(){const u=await get('/units');unitsCache=u;$('unit-cards').innerHTML=u.length?u.map(x=>`<div class="unit-card"><h3>${esc(x.code)}</h3><p>${esc(x.name)}</p></div>`).join(''):'<p>You are not enrolled in any units yet.</p>'}
async function renderCalendar(){const a=await get('/assignments');const c=$('calendar-weeks');c.innerHTML='';const groups={};a.forEach(x=>{const d=new Date(x.due_date+'T00:00:00'),w=new Date(d);w.setDate(d.getDate()-d.getDay());const k=w.toISOString().slice(0,10);(groups[k]??=[]).push(x)});Object.keys(groups).sort().forEach(k=>{const div=document.createElement('div');div.className='calendar-week';div.innerHTML='<h4>Week of '+fmt(k)+'</h4>'+groups[k].sort((a,b)=>a.due_date.localeCompare(b.due_date)).map(x=>`<span class="calendar-item">${esc(x.unit_code)}: ${esc(x.title)} — ${fmt(x.due_date)}</span>`).join('');c.appendChild(div)});if(!c.innerHTML)c.innerHTML='<p>No assignments yet.</p>'}
// student settings
async function enablePhonePush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw Error('This browser does not support web push notifications.');
  const cfg=await get('/push/public-key');
  if(!cfg.configured) throw Error('Phone push needs VAPID keys configured on the server.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted') throw Error('Notification permission was not granted.');
  const reg=await navigator.serviceWorker.register('/sw.js');
  let sub=await reg.pushManager.getSubscription();
  if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.publicKey)});
  await post('/push/subscribe',sub.toJSON());
}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
function hourToTime(hour){
  const h=Number(hour);
  return Number.isFinite(h) ? String(Math.max(0,Math.min(23,h))).padStart(2,'0')+':00' : '12:00';
}
function timeToHour(value){
  const match=/^(\d{1,2})(?::\d{2})?$/.exec(String(value||''));
  if(!match) return NaN;
  const h=Number(match[1]);
  return Number.isFinite(h) ? Math.max(0,Math.min(23,h)) : NaN;
}
function openSettings(){
  const teacher=currentUser.role==='teacher';
  $('settings-title').textContent=teacher?'Teacher Reminder Settings':'My Reminder Settings';
  $('settings-desc').textContent=teacher?'Choose when assignment and pending Special Consideration reminders appear and where you want to receive them.':'Choose when deadline reminders appear and where you want to receive them.';
  $('settings-days-row').classList.remove('hidden');
  $('settings-days-row').querySelector('span').textContent=teacher?'Start assignment reminders this many days before':'Start reminding this many days before';
  $('settings-start-label').querySelector('span').textContent=teacher?'Reminder window start':'Start time';
  $('settings-end-label').querySelector('span').textContent=teacher?'Reminder window end':'End time';
  $('settings-repeat-label').querySelector('span').textContent='Repeat reminder every';
  $('settings-days').value=currentUser.reminder_days_before ?? 5;
  $('settings-start').value=hourToTime(teacher?currentUser.sc_reminder_start_hour:currentUser.reminder_start_hour);
  $('settings-end').value=hourToTime(teacher?currentUser.sc_reminder_end_hour:currentUser.reminder_end_hour);
  $('settings-repeat').value=String(teacher?(currentUser.sc_reminder_repeat_hours ?? 3):(currentUser.reminder_repeat_hours ?? 3));
  $('settings-email').checked=currentUser.email_notifications!==false;
  $('settings-push').checked=!!currentUser.push_notifications;
  $('settings-modal').classList.remove('hidden');
}
$('btn-settings').onclick=openSettings;
$('settings-cancel').onclick=()=>$('settings-modal').classList.add('hidden');
$('settings-form').onsubmit=async e=>{
  e.preventDefault();
  const start=timeToHour($('settings-start').value);
  const end=timeToHour($('settings-end').value);
  const days=Number($('settings-days').value);
  const repeat=Number($('settings-repeat').value);
  if(!Number.isInteger(days)||days<1||days>30){alert('Please enter a reminder period between 1 and 30 days.');return;}
  if(!Number.isInteger(start)||!Number.isInteger(end)){alert('Please select both a start time and an end time.');return;}
  if(start>end){alert('The reminder window end time must be the same as or later than the start time.');return;}
  if(![1,2,3,4,6,8,12,24].includes(repeat)){alert('Please select a valid repeat interval.');return;}
  let push=$('settings-push').checked;
  if(push){try{await enablePhonePush()}catch(err){$('settings-push').checked=false;push=false;alert(err.message)}}
  const payload={
    reminder_days_before:days,
    reminder_start_hour:start,
    reminder_end_hour:end,
    reminder_repeat_hours:repeat,
    sc_reminder_start_hour:start,
    sc_reminder_end_hour:end,
    sc_reminder_repeat_hours:repeat,
    email_notifications:$('settings-email').checked,
    push_notifications:push
  };
  const saveButton=$('settings-save') || $('settings-form')?.querySelector('button[type="submit"]') || null;
  try{
    if(saveButton){saveButton.disabled=true;saveButton.textContent='Saving...';}
    currentUser=await put('/users/me',payload);
    $('settings-modal').classList.add('hidden');
    await refresh();
    alert('Notification settings saved successfully.');
  }catch(err){
    console.error('Save notification settings failed:',err);
    alert('Could not save notification settings: '+err.message);
  }finally{
    if(saveButton){saveButton.disabled=false;saveButton.textContent='Save settings';}
  }
};
// teacher data / enrolments
async function loadTeacherStudents(){teacherData=await get('/teacher/students');$('teacher-unit-list').innerHTML=teacherData.units.length?teacherData.units.map(u=>`<div class="list-row"><span><strong>${esc(u.code)}</strong> — ${esc(u.name)}</span></div>`).join(''):'<p>No units yet.</p>';$('enrol-unit').innerHTML=teacherData.units.map(u=>`<option value="${u.id}">${esc(u.code)} — ${esc(u.name)}</option>`).join('');$('enrol-student').innerHTML=teacherData.students.map(s=>`<option value="${s.id}">${esc(s.name)} — ${esc(s.email)}</option>`).join('');const map={};teacherData.enrolments.forEach(e=>(map[e.unit_id]??=[]).push(e.student_id));$('enrolment-list').innerHTML=teacherData.units.map(u=>{const ids=map[u.id]||[];return `<div class="enrol-row"><strong>${esc(u.code)}</strong>: ${ids.length?ids.map(id=>{const st=teacherData.students.find(x=>x.id===id);return `<span class="pill">${esc(st?.name||'Student')}</span>`}).join(' '):'No students enrolled'}</div>`}).join('')||'<p>No enrolments.</p>';renderGroups()}
function renderGroups(){const groups=teacherData.groups||[];const members=teacherData.groupMembers||[];$('teacher-group-list').innerHTML=groups.length?groups.map(g=>{const ids=members.filter(x=>x.group_id===g.id).map(x=>x.student_id);return `<div class="card"><h3>${esc(g.name)}</h3><p class="muted">${esc(g.unit_code)} · ${ids.length} student(s)</p><div>${ids.map(id=>{const st=teacherData.students.find(x=>x.id===id);return `<span class="pill">${esc(st?.name||'Student')}</span>`}).join(' ')||'No members'}</div><button class="icon-btn" data-del-group="${g.id}">🗑</button></div>`}).join(''):'<div class="card"><p>No subject groups yet. Enrol students in a subject to add them automatically to that subject group.</p></div>';document.querySelectorAll('[data-del-group]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this group?')){await del('/teacher/groups/'+b.dataset.delGroup);loadTeacherStudents()}})}
$('enrol-form').onsubmit=async e=>{e.preventDefault();await post('/teacher/enrolments',{unit_id:+$('enrol-unit').value,student_id:+$('enrol-student').value});loadTeacherStudents()};$('btn-teacher-add-unit').onclick=()=>$('unit-modal').classList.remove('hidden');$('unit-cancel').onclick=()=>$('unit-modal').classList.add('hidden');$('unit-form').onsubmit=async e=>{e.preventDefault();await post('/units',{code:$('u-code').value,name:$('u-name').value});e.target.reset();$('unit-modal').classList.add('hidden');loadTeacherStudents()};
$('btn-teacher-add-group').onclick=()=>{if(!teacherData.units.length)return alert('Create a unit first.');$('g-unit').innerHTML=teacherData.units.map(u=>`<option value="${u.id}">${esc(u.code)} — ${esc(u.name)}</option>`).join('');$('g-name').value=teacherData.units[0].name;renderGroupStudentChoices();$('group-modal').classList.remove('hidden')};$('g-unit').onchange=()=>{const u=teacherData.units.find(x=>x.id===+$('g-unit').value);if(u)$('g-name').value=u.name;renderGroupStudentChoices()};$('group-cancel').onclick=()=>$('group-modal').classList.add('hidden');function renderGroupStudentChoices(){const unit=+$('g-unit').value;const ids=teacherData.enrolments.filter(x=>x.unit_id===unit).map(x=>x.student_id);$('g-students').innerHTML=ids.length?ids.map(id=>{const st=teacherData.students.find(x=>x.id===id);return `<label class="check-row"><input type="checkbox" value="${id}"> ${esc(st.name)} <small>${esc(st.email)}</small></label>`}).join(''):'<p>No students are enrolled in this unit.</p>'}$('group-form').onsubmit=async e=>{e.preventDefault();const ids=[...document.querySelectorAll('#g-students input:checked')].map(x=>+x.value);if(!ids.length)return alert('Select at least one student.');await post('/teacher/groups',{unit_id:+$('g-unit').value,name:$('g-name').value,student_ids:ids});e.target.reset();$('group-modal').classList.add('hidden');loadTeacherStudents()};
// teacher assignment create/list
async function loadTeacherAssignments(){const rows=await get('/teacher/assignments');$('teacher-assignment-list').innerHTML=rows.length?rows.map(a=>`<tr><td><strong>${esc(a.title)}</strong><br><small>${esc(a.notes||'')}</small></td><td>${esc(a.unit_code)}</td><td>${fmt(a.due_date)}</td><td>${a.student_count} student(s)</td><td><button class="icon-btn" data-del-ta="${a.id}">🗑</button></td></tr>`).join(''):'<tr><td colspan="5">No assignments created yet.</td></tr>';document.querySelectorAll('[data-del-ta]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this teacher-created assignment?')){await del('/teacher/assignments/'+b.dataset.delTa);loadTeacherAssignments()}})}
async function openTeacherAssignment(){teacherData=await get('/teacher/students');if(!teacherData.units.length)return alert('Create a unit first.');$('ta-unit').innerHTML=teacherData.units.map(u=>`<option value="${u.id}">${esc(u.code)} — ${esc(u.name)}</option>`).join('');renderTeacherStudents();$('teacher-assignment-modal').classList.remove('hidden')}
function renderTeacherStudents(){const unit=+$('ta-unit').value;const ids=teacherData.enrolments.filter(x=>x.unit_id===unit).map(x=>x.student_id);const groups=teacherData.groups||[];$('ta-groups').innerHTML=groups.length?groups.map(g=>{const sameUnit=g.unit_id===unit;return `<label class="check-row"><input type="checkbox" value="${g.id}" data-group ${sameUnit?'':'disabled'}> ${esc(g.name)} <small>${esc(g.unit_code)}${sameUnit?'':' — select this subject above to use this group'}</small></label>`}).join(''):'<p>No subject groups yet.</p>';$('ta-students').innerHTML=teacherData.students.length?teacherData.students.map(s=>{const enrolled=ids.includes(s.id);return `<label class="check-row"><input type="checkbox" value="${s.id}" ${enrolled?'':'disabled'}> ${esc(s.name)} <small>${esc(s.email)}${enrolled?'':' — not enrolled in selected subject'}</small></label>`}).join(''):'<p>No students found.</p>'}
$('ta-unit').onchange=renderTeacherStudents;
$('btn-teacher-add-assignment').onclick=openTeacherAssignment;
$('ta-cancel').onclick=()=>$('teacher-assignment-modal').classList.add('hidden');

$('teacher-assignment-form').onsubmit=async e=>{
  e.preventDefault();
  const btn=e.submitter || e.target.querySelector('button[type="submit"]');
  const ids=[...document.querySelectorAll('#ta-students input:checked')].map(x=>+x.value);
  const groupIds=[...document.querySelectorAll('#ta-groups input:checked')].map(x=>+x.value);
  const title=$('ta-title').value.trim();
  const dueDate=$('ta-due').value;

  if(!title){alert('Please enter an assignment title.');return;}
  if(!dueDate){alert('Please select a due date.');return;}
  if(!ids.length&&!groupIds.length){alert('Select at least one group or student.');return;}

  try{
    if(btn){btn.disabled=true;btn.textContent='Creating...';}
    const result=await post('/teacher/assignments',{
      unit_id:+$('ta-unit').value,
      title,
      due_date:dueDate,
      weighting:+$('ta-weight').value,
      priority:$('ta-priority').value,
      notes:$('ta-notes').value,
      student_ids:ids,
      group_ids:groupIds
    });

    alert(`Assignment created successfully. ${result.student_count} student(s) were assigned and ${result.notification_count} in-app notification(s) were created.`);
    e.target.reset();
    $('teacher-assignment-modal').classList.add('hidden');
    await loadTeacherAssignments();
    await badge();
  }catch(err){
    console.error('Create assignment failed:',err);
    alert('Could not create the assignment: '+err.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Create & Notify Students';}
  }
};
// special consideration
let scAssignments=[];
async function openSC(id=null,title=''){
  scAssignments=await get('/assignments');
  if(!scAssignments.length){alert('You do not have any assigned assignments yet.');return;}
  const units=[...new Map(scAssignments.map(a=>[a.unit_id,{id:a.unit_id,code:a.unit_code,name:a.unit_name}])).values()];
  $('sc-unit').innerHTML=units.map(u=>`<option value="${u.id}">${esc(u.code)} — ${esc(u.name)}</option>`).join('');
  if(id){const selected=scAssignments.find(a=>a.id==id);if(selected)$('sc-unit').value=selected.unit_id;}
  renderSCAssignments(id);
  $('sc-reason').value=''; $('sc-new-date').value=''; $('sc-modal').classList.remove('hidden');
}
function renderSCAssignments(preselect=null){
  const unitId=+$('sc-unit').value;
  const rows=scAssignments.filter(a=>a.unit_id===unitId);
  $('sc-assignment').innerHTML=rows.map(a=>`<option value="${a.id}">${esc(a.title)} — due ${fmt(a.due_date)}</option>`).join('');
  if(preselect && rows.some(a=>a.id==preselect)) $('sc-assignment').value=preselect;
  updateSCTeacher();
}
function updateSCTeacher(){
  const a=scAssignments.find(x=>x.id==+$('sc-assignment').value);
  $('sc-teacher-name').textContent=a?`Teacher: ${a.teacher_name} (automatically selected from the assignment)`:'';
}
$('sc-unit').onchange=()=>renderSCAssignments();
$('sc-assignment').onchange=updateSCTeacher;
$('btn-create-sc').onclick=()=>openSC();
$('sc-cancel').onclick=()=>$('sc-modal').classList.add('hidden');
$('sc-form').onsubmit=async e=>{
  e.preventDefault();
  try{
    await post('/special-considerations',{assignment_id:+$('sc-assignment').value,reason:$('sc-reason').value,requested_due_date:$('sc-new-date').value||null});
    alert('Request submitted to the teacher who created this assignment.');
    $('sc-modal').classList.add('hidden');$('sc-form').reset();loadMyRequests();badge();
  }catch(err){alert(err.message);}
};
async function loadMyRequests(){const rows=await get('/special-considerations');$('my-requests-list').innerHTML=rows.length?rows.map(r=>`<div class="request-card"><div class="request-card-top"><h4>${esc(r.assignment_title)} (${esc(r.unit_code)})</h4><span class="status-pill ${r.status}">${r.status}</span></div><div class="request-meta">Teacher: ${esc(r.teacher_name)} · Due: ${fmt(r.assignment_due_date)}${r.requested_due_date?' · Requested: '+fmt(r.requested_due_date):''}</div><div>${esc(r.reason)}</div>${r.teacher_comment?`<div class="request-comment"><strong>Teacher:</strong> ${esc(r.teacher_comment)}</div>`:''}</div>`).join(''):'<p>No special consideration requests.</p>'}
async function loadReview(){const rows=await get('/special-considerations');$('review-requests-list').innerHTML=rows.length?rows.map(r=>`<div class="request-card"><div class="request-card-top"><h4>${esc(r.assignment_title)} — ${esc(r.student_name)}</h4><span class="status-pill ${r.status}">${r.status}</span></div><div class="request-meta">Due: ${fmt(r.assignment_due_date)}${r.requested_due_date?' · Requested: '+fmt(r.requested_due_date):''}</div><p>${esc(r.reason)}</p>${r.status==='Pending'?`<div class="request-actions"><button class="btn-primary" data-approve="${r.id}">Approve</button><button class="btn-secondary" data-reject="${r.id}">Reject</button></div>`:''}</div>`).join(''):'<p>No requests yet.</p>';document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>resolveSC(b.dataset.approve,'Approved'));document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>resolveSC(b.dataset.reject,'Rejected'))}
async function resolveSC(id,status){const c=prompt('Optional teacher comment','');await put('/special-considerations/'+id,{status,teacher_comment:c||''});loadReview();badge()}
async function refresh(){if(currentUser.role==='teacher'){loadTeacherAssignments();loadTeacherStudents();loadReview()}else{loadDashboard();loadStudentUnits();badge();const s=await get('/dashboard-summary');const b=$('reminder-banner');if(s.overdue_count||s.due_soon_count){b.textContent=s.overdue_count?`⚠ ${s.overdue_count} overdue assignment(s). ${s.due_soon_count} due within your ${s.reminder_days_before}-day reminder window.`:`⏰ ${s.due_soon_count} assignment(s) are due within your ${s.reminder_days_before}-day reminder window.`;b.classList.remove('hidden')}else b.classList.add('hidden')}}
setInterval(()=>{if(currentUser){badge();if(currentUser.role==='student')loadDashboard()}},60000);
(async()=>{try{currentUser=await get('/auth/me');afterLogin()}catch{showAuth()}})();
