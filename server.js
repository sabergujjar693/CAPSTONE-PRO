// server.js - Deadline Tracker backend
const fs = require('fs');
const path = require('path');
// Load simple KEY=VALUE settings from a local .env file without an extra package.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const db = require('./db');

// First-run safety: if this is a brand-new database with no accounts, load the
// demo dataset automatically so the login page is usable immediately. This
// never runs when an existing database already contains users.
try {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    console.log('No users found. Loading demo data for first run...');
    require('./seed').seedDemoData();
  }
} catch (err) {
  console.error('Automatic demo-data setup failed:', err.message);
}

// Optional external notification delivery. In-app notifications always work.
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = smtpConfigured ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;
const pushConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
if (pushConfigured) webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

async function deliverExternalNotification(userId, message, type) {
  const user = db.prepare('SELECT id,name,email,email_notifications,push_notifications FROM users WHERE id=?').get(userId);
  if (!user) return;
  if (mailer && user.email_notifications) {
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: user.email,
        subject: `Deadline Tracker: ${type === 'deadline_reminder' ? 'Assignment reminder' : 'New notification'}`,
        text: message
      });
    } catch (err) { console.error('Email notification failed:', err.message); }
  }
  if (pushConfigured && user.push_notifications) {
    const subs = db.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').all(user.id);
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: 'Deadline Tracker', body: message }));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(sub.id);
        else console.error('Push notification failed:', err.message);
      }
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: 'hs3052-deadline-tracker-demo-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function daysUntil(dueDateStr) {
  if (!dueDateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}
function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    reminder_days_before: u.reminder_days_before,
    reminder_start_hour: u.reminder_start_hour,
    reminder_end_hour: u.reminder_end_hour,
    reminder_repeat_hours: u.reminder_repeat_hours,
    sc_reminder_start_hour: u.sc_reminder_start_hour,
    sc_reminder_end_hour: u.sc_reminder_end_hour,
    sc_reminder_repeat_hours: u.sc_reminder_repeat_hours,
    email_notifications: !!u.email_notifications,
    push_notifications: !!u.push_notifications,
    email_configured: !!mailer,
    push_configured: pushConfigured
  };
}
function addNotification(userId, message, type = 'general') {
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(userId, message, type);
  // External delivery is intentionally asynchronous so a temporary email/push
  // failure never prevents the in-app notification from being created.
  deliverExternalNotification(userId, message, type).catch(err => console.error('External notification error:', err.message));
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== role) return res.status(403).json({ error: 'Not allowed for this account type' });
    req.currentUser = user;
    next();
  };
}
function currentUser(req) { return db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId); }

// AUTH
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  const cleanRole = role === 'teacher' ? 'teacher' : 'student';
  const cleanEmail = email.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) return res.status(409).json({ error: 'An account with that email already exists' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name.trim(), cleanEmail, hash, cleanRole);
  req.session.userId = result.lastInsertRowid;
  res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)));
});
app.post('/api/auth/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((req.body.email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password' });
  req.session.userId = user.id; res.json(publicUser(user));
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.status(204).send()));
app.get('/api/auth/me', requireAuth, (req, res) => { const u=currentUser(req); res.json({...publicUser(u), email_notifications:!!u.email_notifications, push_notifications:!!u.push_notifications, push_configured:pushConfigured, email_configured:!!mailer}); });

// STUDENT REMINDER SETTINGS
app.put('/api/users/me', requireAuth, (req, res) => {
  const numberOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const days = Math.max(1, Math.min(30, Math.trunc(numberOr(req.body.reminder_days_before, 5))));
  const startHour = Math.max(0, Math.min(23, Math.trunc(numberOr(req.body.reminder_start_hour, 12))));
  const endHour = Math.max(0, Math.min(23, Math.trunc(numberOr(req.body.reminder_end_hour, 21))));
  const repeatValue = numberOr(req.body.reminder_repeat_hours, 3);
  const repeat = [1,2,3,4,6,8,12,24].includes(repeatValue) ? repeatValue : 3;
  const scStart = Math.max(0, Math.min(23, Math.trunc(numberOr(req.body.sc_reminder_start_hour, 12))));
  const scEnd = Math.max(0, Math.min(23, Math.trunc(numberOr(req.body.sc_reminder_end_hour, 21))));
  const scRepeatValue = numberOr(req.body.sc_reminder_repeat_hours, 3);
  const scRepeat = [1,2,3,4,6,8,12,24].includes(scRepeatValue) ? scRepeatValue : 3;
  const email = req.body.email_notifications === undefined ? 1 : (req.body.email_notifications ? 1 : 0);
  const push = req.body.push_notifications ? 1 : 0;
  db.prepare(`UPDATE users SET reminder_days_before=?, reminder_start_hour=?, reminder_end_hour=?, reminder_repeat_hours=?, sc_reminder_start_hour=?, sc_reminder_end_hour=?, sc_reminder_repeat_hours=?, email_notifications=?, push_notifications=? WHERE id=?`)
    .run(days, startHour, endHour, repeat, scStart, scEnd, scRepeat, email, push, req.session.userId);
  const u=currentUser(req);
  res.json({...publicUser(u), email_notifications:!!u.email_notifications, push_notifications:!!u.push_notifications, push_configured:pushConfigured, email_configured:!!mailer});
});

// TEACHER UNITS / COURSES
app.get('/api/units', requireAuth, (req, res) => {
  const user = currentUser(req);
  if (user.role === 'teacher') {
    return res.json(db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM enrolments e WHERE e.unit_id=u.id) student_count FROM units u WHERE u.user_id=? ORDER BY u.code`).all(user.id));
  }
  res.json(db.prepare(`SELECT u.*, e.student_id FROM units u JOIN enrolments e ON e.unit_id=u.id WHERE e.student_id=? ORDER BY u.code`).all(user.id));
});
app.post('/api/units', requireRole('teacher'), (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  const result = db.prepare('INSERT INTO units (user_id,code,name) VALUES (?,?,?)').run(req.currentUser.id, code.trim(), name.trim());
  res.status(201).json(db.prepare('SELECT * FROM units WHERE id=?').get(result.lastInsertRowid));
});
app.delete('/api/units/:id', requireRole('teacher'), (req, res) => {
  db.prepare('DELETE FROM units WHERE id=? AND user_id=?').run(req.params.id, req.currentUser.id); res.status(204).send();
});

// STUDENT LIST / ENROLMENT
app.get('/api/teacher/students', requireRole('teacher'), (req, res) => {
  const students = db.prepare("SELECT id,name,email FROM users WHERE role='student' ORDER BY name").all();
  const units = db.prepare('SELECT id,code,name FROM units WHERE user_id=? ORDER BY code').all(req.currentUser.id);
  const enrolments = db.prepare(`SELECT e.student_id,e.unit_id FROM enrolments e JOIN units u ON u.id=e.unit_id WHERE u.user_id=?`).all(req.currentUser.id);
  const groups = db.prepare(`SELECT g.id,g.unit_id,g.name,u.code unit_code FROM student_groups g JOIN units u ON u.id=g.unit_id WHERE u.user_id=? ORDER BY u.code,g.name`).all(req.currentUser.id);
  const groupMembers = db.prepare(`SELECT gm.group_id,gm.student_id FROM group_members gm JOIN student_groups g ON g.id=gm.group_id JOIN units u ON u.id=g.unit_id WHERE u.user_id=?`).all(req.currentUser.id);
  res.json({ students, units, enrolments, groups, groupMembers });
});
app.post('/api/teacher/enrolments', requireRole('teacher'), (req, res) => {
  const unit = db.prepare('SELECT id FROM units WHERE id=? AND user_id=?').get(req.body.unit_id, req.currentUser.id);
  const student = db.prepare("SELECT id FROM users WHERE id=? AND role='student'").get(req.body.student_id);
  if (!unit || !student) return res.status(400).json({ error: 'Valid unit and student are required' });
  const addEnrollment = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO enrolments (unit_id,student_id) VALUES (?,?)').run(unit.id, student.id);

    // Keep the subject group automatically in sync with enrolments.
    // Each subject has one default group named after the subject.
    const unitInfo = db.prepare('SELECT name FROM units WHERE id=?').get(unit.id);
    let group = db.prepare('SELECT id FROM student_groups WHERE unit_id=? AND name=?').get(unit.id, unitInfo.name);
    if (!group) {
      const created = db.prepare('INSERT INTO student_groups (unit_id,name) VALUES (?,?)').run(unit.id, unitInfo.name);
      group = { id: created.lastInsertRowid };
    }
    db.prepare('INSERT OR IGNORE INTO group_members (group_id,student_id) VALUES (?,?)').run(group.id, student.id);
    return group.id;
  });

  const groupId = addEnrollment();
  res.status(201).json({ ok: true, group_id: groupId });
});
app.delete('/api/teacher/enrolments', requireRole('teacher'), (req, res) => {
  const removeEnrollment = db.transaction(() => {
    db.prepare(`DELETE FROM enrolments WHERE unit_id=? AND student_id=? AND unit_id IN (SELECT id FROM units WHERE user_id=?)`).run(req.body.unit_id, req.body.student_id, req.currentUser.id);
    // Keep the subject group aligned with the students actually enrolled in the unit.
    db.prepare(`DELETE FROM group_members WHERE student_id=? AND group_id IN (SELECT g.id FROM student_groups g JOIN units u ON u.id=g.unit_id WHERE g.unit_id=? AND u.user_id=?)`).run(req.body.student_id, req.body.unit_id, req.currentUser.id);
  });
  removeEnrollment();
  res.status(204).send();
});

// TEACHER STUDENT GROUPS
app.get('/api/teacher/groups', requireRole('teacher'), (req, res) => {
  const groups = db.prepare(`
    SELECT g.id,g.unit_id,g.name,u.code unit_code,
           COUNT(DISTINCT gm.student_id) student_count
    FROM student_groups g JOIN units u ON u.id=g.unit_id
    LEFT JOIN group_members gm ON gm.group_id=g.id
    WHERE u.user_id=? GROUP BY g.id ORDER BY u.code,g.name
  `).all(req.currentUser.id);
  const members = db.prepare(`
    SELECT gm.group_id,s.id,s.name,s.email
    FROM group_members gm JOIN users s ON s.id=gm.student_id
    JOIN student_groups g ON g.id=gm.group_id JOIN units u ON u.id=g.unit_id
    WHERE u.user_id=? ORDER BY s.name
  `).all(req.currentUser.id);
  res.json({groups,members});
});
app.post('/api/teacher/groups', requireRole('teacher'), (req,res) => {
  const {unit_id,name,student_ids=[]}=req.body;
  if(!unit_id || !name || !Array.isArray(student_ids)) return res.status(400).json({error:'Unit and group name are required'});
  const unit=db.prepare('SELECT id FROM units WHERE id=? AND user_id=?').get(unit_id,req.currentUser.id);
  if(!unit) return res.status(403).json({error:'That unit does not belong to this teacher'});
  const ids=[...new Set(student_ids.map(Number).filter(Boolean))];
  const enrolled=ids.length ? db.prepare(`SELECT student_id FROM enrolments WHERE unit_id=? AND student_id IN (${ids.map(()=>'?').join(',')})`).all(unit_id,...ids).map(x=>x.student_id) : [];
  if(enrolled.length!==ids.length) return res.status(400).json({error:'Every group member must be enrolled in the selected unit'});
  try {
    const create=db.transaction(()=>{ const r=db.prepare('INSERT INTO student_groups (unit_id,name) VALUES (?,?)').run(unit_id,name.trim()); const add=db.prepare('INSERT INTO group_members (group_id,student_id) VALUES (?,?)'); ids.forEach(id=>add.run(r.lastInsertRowid,id)); return r.lastInsertRowid; });
    res.status(201).json({id:create()});
  } catch(e){ if(String(e.message).includes('UNIQUE')) return res.status(409).json({error:'A group with that name already exists in this unit'}); throw e; }
});
app.put('/api/teacher/groups/:id', requireRole('teacher'), (req,res) => {
  const {name,student_ids=[]}=req.body;
  const group=db.prepare(`SELECT g.* FROM student_groups g JOIN units u ON u.id=g.unit_id WHERE g.id=? AND u.user_id=?`).get(req.params.id,req.currentUser.id);
  if(!group) return res.status(404).json({error:'Group not found'});
  const ids=[...new Set(student_ids.map(Number).filter(Boolean))];
  const enrolled=ids.length ? db.prepare(`SELECT student_id FROM enrolments WHERE unit_id=? AND student_id IN (${ids.map(()=>'?').join(',')})`).all(group.unit_id,...ids).map(x=>x.student_id) : [];
  if(enrolled.length!==ids.length) return res.status(400).json({error:'Every group member must be enrolled in the group unit'});
  db.transaction(()=>{if(name) db.prepare('UPDATE student_groups SET name=? WHERE id=?').run(name.trim(),group.id); db.prepare('DELETE FROM group_members WHERE group_id=?').run(group.id); const add=db.prepare('INSERT INTO group_members (group_id,student_id) VALUES (?,?)'); ids.forEach(id=>add.run(group.id,id));})();
  res.json({ok:true});
});
app.delete('/api/teacher/groups/:id', requireRole('teacher'), (req,res) => { db.prepare(`DELETE FROM student_groups WHERE id IN (SELECT g.id FROM student_groups g JOIN units u ON u.id=g.unit_id WHERE g.id=? AND u.user_id=?)`).run(req.params.id,req.currentUser.id); res.status(204).send(); });

// TEACHER CREATES ASSIGNMENTS FOR SELECTED ENROLLED STUDENTS
app.get('/api/teacher/assignments', requireRole('teacher'), (req, res) => {
  const rows = db.prepare(`
    SELECT a.id,a.title,a.due_date,a.weighting,a.priority,a.notes,u.id unit_id,u.code unit_code,u.name unit_name,
           COUNT(DISTINCT ass.student_id) student_count
    FROM assignments a JOIN units u ON u.id=a.unit_id
    LEFT JOIN assignment_students ass ON ass.assignment_id=a.id
    WHERE u.user_id=? GROUP BY a.id ORDER BY a.due_date,a.title
  `).all(req.currentUser.id);
  res.json(rows);
});
app.get('/api/teacher/assignments/:id/students', requireRole('teacher'), (req, res) => {
  const owns = db.prepare(`SELECT a.id FROM assignments a JOIN units u ON u.id=a.unit_id WHERE a.id=? AND u.user_id=?`).get(req.params.id, req.currentUser.id);
  if (!owns) return res.status(404).json({ error: 'Assignment not found' });
  res.json(db.prepare(`SELECT s.id,s.name,s.email FROM assignment_students x JOIN users s ON s.id=x.student_id WHERE x.assignment_id=? ORDER BY s.name`).all(req.params.id));
});
app.post('/api/teacher/assignments', requireRole('teacher'), (req, res) => {
  const { unit_id, title, due_date, weighting, priority, notes, student_ids = [], group_ids = [] } = req.body;
  if (!unit_id || !title || !due_date || !Array.isArray(student_ids) || !Array.isArray(group_ids) || (student_ids.length === 0 && group_ids.length === 0)) return res.status(400).json({ error: 'Unit, title, due date and at least one student or group are required' });
  const unit = db.prepare('SELECT * FROM units WHERE id=? AND user_id=?').get(unit_id, req.currentUser.id);
  if (!unit) return res.status(403).json({ error: 'That unit does not belong to this teacher' });
  const directIds=[...new Set(student_ids.map(Number).filter(Boolean))];
  const groupIds=[...new Set(group_ids.map(Number).filter(Boolean))];
  const validGroups=groupIds.length ? db.prepare(`SELECT id FROM student_groups WHERE unit_id=? AND id IN (${groupIds.map(()=>'?').join(',')})`).all(unit_id,...groupIds).map(x=>x.id) : [];
  if(validGroups.length!==groupIds.length) return res.status(400).json({error:'Every selected group must belong to this unit'});
  const groupStudentIds=validGroups.length ? db.prepare(`SELECT DISTINCT gm.student_id FROM group_members gm JOIN student_groups g ON g.id=gm.group_id WHERE g.unit_id=? AND gm.group_id IN (${validGroups.map(()=>'?').join(',')})`).all(unit_id,...validGroups).map(x=>x.student_id) : [];
  const allStudentIds=[...new Set([...directIds,...groupStudentIds])];
  if(!allStudentIds.length) return res.status(400).json({error:'No students were found in the selected group(s)'});
  const students = db.prepare(`SELECT id FROM users WHERE role='student' AND id IN (${allStudentIds.map(()=>'?').join(',')})`).all(...allStudentIds);
  const enrolled = db.prepare(`SELECT student_id FROM enrolments WHERE unit_id=? AND student_id IN (${allStudentIds.map(()=>'?').join(',')})`).all(unit_id, ...allStudentIds).map(x=>x.student_id);
  if (students.length !== allStudentIds.length || enrolled.length !== allStudentIds.length) return res.status(400).json({ error: 'Every selected student must be enrolled in the unit' });

  const create = db.transaction(() => {
    const result = db.prepare(`INSERT INTO assignments (unit_id,title,due_date,weighting,priority,status,notes,created_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(unit_id, title.trim(), due_date, Number(weighting)||0, priority||'Medium', 'Not started', notes||'', req.currentUser.id);
    const id = result.lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO teacher_assignment_reminders (assignment_id,teacher_id) VALUES (?,?)').run(id, req.currentUser.id);
    const add = db.prepare('INSERT OR IGNORE INTO assignment_students (assignment_id,student_id) VALUES (?,?)');
    const reminder = db.prepare('INSERT OR IGNORE INTO assignment_reminders (assignment_id,student_id) VALUES (?,?)');
    for (const studentId of allStudentIds) {
      add.run(id, studentId);
      reminder.run(id, studentId);
      addNotification(studentId, `New assignment: "${title.trim()}" for ${unit.code}. Due ${due_date}.`, 'assignment_created');
    }
    return id;
  });

  const createdId = create();
  const created = db.prepare('SELECT * FROM assignments WHERE id=?').get(createdId);
  res.status(201).json({
    ...created,
    student_count: allStudentIds.length,
    notification_count: allStudentIds.length
  });
});
app.put('/api/teacher/assignments/:id', requireRole('teacher'), (req,res) => {
  const a = db.prepare(`SELECT a.* FROM assignments a JOIN units u ON u.id=a.unit_id WHERE a.id=? AND u.user_id=?`).get(req.params.id, req.currentUser.id);
  if (!a) return res.status(404).json({error:'Assignment not found'});
  db.prepare('UPDATE assignments SET title=?,due_date=?,weighting=?,priority=?,notes=? WHERE id=?').run(req.body.title||a.title,req.body.due_date||a.due_date,Number(req.body.weighting??a.weighting)||0,req.body.priority||a.priority,req.body.notes??a.notes,a.id);
  if (req.body.due_date && req.body.due_date !== a.due_date) {
    const recipients = db.prepare('SELECT student_id FROM assignment_students WHERE assignment_id=?').all(a.id);
    for (const r of recipients) addNotification(r.student_id, `Deadline changed for "${a.title}" to ${req.body.due_date}.`, 'deadline_change');
  }
  res.json(db.prepare('SELECT * FROM assignments WHERE id=?').get(a.id));
});
app.delete('/api/teacher/assignments/:id', requireRole('teacher'), (req,res) => {
  db.prepare(`DELETE FROM assignments WHERE id=? AND unit_id IN (SELECT id FROM units WHERE user_id=?)`).run(req.params.id,req.currentUser.id); res.status(204).send();
});

// STUDENT ASSIGNMENTS
app.get('/api/assignments', requireRole('student'), (req,res) => {
  const user = req.currentUser;
  const rows = db.prepare(`SELECT a.*,COALESCE(x.due_date_override,a.due_date) due_date,u.code unit_code,u.name unit_name, t.name teacher_name FROM assignments a
    JOIN assignment_students x ON x.assignment_id=a.id
    JOIN units u ON u.id=a.unit_id
    JOIN users t ON t.id=a.created_by
    WHERE x.student_id=? ORDER BY a.due_date,a.title`).all(user.id);
  res.json(rows.map(r=>({...r,days_left:daysUntil(r.due_date)})));
});
app.put('/api/assignments/:id', requireRole('student'), (req,res) => {
  const a = db.prepare(`SELECT a.* FROM assignments a JOIN assignment_students x ON x.assignment_id=a.id WHERE a.id=? AND x.student_id=?`).get(req.params.id,req.currentUser.id);
  if (!a) return res.status(404).json({error:'Assignment not found'});
  db.prepare('UPDATE assignments SET status=?,notes=? WHERE id=?').run(req.body.status??a.status,req.body.notes??a.notes,a.id);
  res.json(db.prepare('SELECT * FROM assignments WHERE id=?').get(a.id));
});

// DASHBOARD
app.get('/api/dashboard-summary', requireRole('student'), (req,res)=>{
  const rows=db.prepare(`SELECT a.*,u.code unit_code FROM assignments a JOIN assignment_students x ON x.assignment_id=a.id JOIN units u ON u.id=a.unit_id WHERE x.student_id=? AND a.status!='Done' ORDER BY a.due_date`).all(req.currentUser.id).map(a=>({...a,days_left:daysUntil(a.due_date)}));
  const overdue=rows.filter(a=>a.days_left<0), dueSoon=rows.filter(a=>a.days_left>=0&&a.days_left<=req.currentUser.reminder_days_before);
  res.json({total_open:rows.length,overdue_count:overdue.length,due_soon_count:dueSoon.length,reminder_days_before:req.currentUser.reminder_days_before,overdue,due_soon:dueSoon});
});

// SPECIAL CONSIDERATION
app.get('/api/teachers', requireAuth, (req,res)=>res.json({teachers:db.prepare("SELECT id,name,email FROM users WHERE role='teacher' ORDER BY name").all()}));
app.post('/api/special-considerations', requireRole('student'), (req,res)=>{
  const {assignment_id,reason,requested_due_date}=req.body;
  const assignment=db.prepare(`SELECT a.* FROM assignments a JOIN assignment_students x ON x.assignment_id=a.id WHERE a.id=? AND x.student_id=?`).get(assignment_id,req.currentUser.id);
  if(!assignment||!reason)return res.status(400).json({error:'Valid assignment and reason are required'});
  const assigned_teacher_id=assignment.created_by;
  const result=db.prepare(`INSERT INTO special_considerations (assignment_id,student_id,assigned_teacher_id,reason,requested_due_date) VALUES (?,?,?,?,?)`).run(assignment_id,req.currentUser.id,assigned_teacher_id,reason.trim(),requested_due_date||null);
  db.prepare('INSERT OR IGNORE INTO special_consideration_reminders (special_consideration_id) VALUES (?)').run(result.lastInsertRowid);
  addNotification(assigned_teacher_id, `${req.currentUser.name} submitted special consideration for "${assignment.title}".`, 'special_consideration');
  res.status(201).json(db.prepare('SELECT * FROM special_considerations WHERE id=?').get(result.lastInsertRowid));
});
app.get('/api/special-considerations', requireAuth,(req,res)=>{
  const u=currentUser(req); let rows;
  if(u.role==='teacher') rows=db.prepare(`SELECT sc.*,a.title assignment_title,a.due_date assignment_due_date,u.code unit_code,s.name student_name FROM special_considerations sc JOIN assignments a ON a.id=sc.assignment_id JOIN units u ON u.id=a.unit_id JOIN users s ON s.id=sc.student_id WHERE sc.assigned_teacher_id=? ORDER BY sc.created_at DESC`).all(u.id);
  else rows=db.prepare(`SELECT sc.*,a.title assignment_title,a.due_date assignment_due_date,u.code unit_code,t.name teacher_name FROM special_considerations sc JOIN assignments a ON a.id=sc.assignment_id JOIN units u ON u.id=a.unit_id JOIN users t ON t.id=sc.assigned_teacher_id WHERE sc.student_id=? ORDER BY sc.created_at DESC`).all(u.id);
  res.json(rows);
});
app.put('/api/special-considerations/:id',requireRole('teacher'),(req,res)=>{
  const {status,teacher_comment}=req.body;
  if(!['Approved','Rejected'].includes(status))return res.status(400).json({error:'status must be Approved or Rejected'});
  const r=db.prepare('SELECT * FROM special_considerations WHERE id=?').get(req.params.id);
  if(!r||r.assigned_teacher_id!==req.currentUser.id)return res.status(403).json({error:'This request is not assigned to you'});
  db.prepare("UPDATE special_considerations SET status=?,teacher_comment=?,resolved_at=datetime('now') WHERE id=?").run(status,teacher_comment||null,r.id);
  const a=db.prepare('SELECT * FROM assignments WHERE id=?').get(r.assignment_id);
  if(status==='Approved'&&r.requested_due_date) db.prepare('UPDATE assignment_students SET due_date_override=? WHERE assignment_id=? AND student_id=?').run(r.requested_due_date,a.id,r.student_id);
  addNotification(r.student_id,`Your special consideration request for "${a.title}" was ${status.toLowerCase()}.`,'special_consideration');
  res.json(db.prepare('SELECT * FROM special_considerations WHERE id=?').get(r.id));
});

// NOTIFICATIONS
app.get('/api/push/public-key', requireAuth, (req,res)=>res.json({configured:pushConfigured, publicKey:pushConfigured?process.env.VAPID_PUBLIC_KEY:null}));
app.post('/api/push/subscribe', requireAuth, (req,res)=>{
  if(!pushConfigured) return res.status(503).json({error:'Phone push is not configured yet. Add VAPID keys to the server environment.'});
  const {endpoint, keys} = req.body || {};
  if(!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({error:'Invalid push subscription'});
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (user_id,endpoint,p256dh,auth) VALUES (?,?,?,?)').run(req.currentUser.id,endpoint,keys.p256dh,keys.auth);
  db.prepare('UPDATE users SET push_notifications=1 WHERE id=?').run(req.currentUser.id);
  res.json({ok:true});
});
app.delete('/api/push/subscribe', requireAuth, (req,res)=>{
  const {endpoint} = req.body || {};
  if(endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.currentUser.id,endpoint);
  db.prepare('UPDATE users SET push_notifications=0 WHERE id=?').run(req.currentUser.id);
  res.status(204).send();
});
app.get('/api/notifications',requireAuth,(req,res)=>{const rows=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.session.userId);res.json({notifications:rows,unread_count:rows.filter(r=>!r.is_read).length});});
app.post('/api/notifications/:id/read',requireAuth,(req,res)=>{db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id,req.session.userId);res.status(204).send();});
app.post('/api/notifications/read-all',requireAuth,(req,res)=>{db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.session.userId);res.status(204).send();});

// Teacher deadline reminder engine. The teacher's days-before, time-window and repeat settings
// are functional here, so every visible teacher setting has a real effect.
function runTeacherDeadlineReminderEngine() {
  const now = new Date();
  const hour = now.getHours();
  const rows = db.prepare(`SELECT a.id,a.title,a.due_date,a.created_by,r.last_sent_at,
    u.reminder_days_before,u.reminder_start_hour,u.reminder_end_hour,u.reminder_repeat_hours
    FROM assignments a
    JOIN users u ON u.id=a.created_by
    JOIN teacher_assignment_reminders r ON r.assignment_id=a.id
    WHERE a.status!='Done' AND u.role='teacher'`).all();
  for (const a of rows) {
    const days=daysUntil(a.due_date);
    if(days===null||days<0||days>a.reminder_days_before) continue;
    if(hour<a.reminder_start_hour||hour>a.reminder_end_hour) continue;
    let due=true;
    if(a.last_sent_at){ const last=new Date(a.last_sent_at.replace(' ','T')+'Z'); due=(now-last)>=a.reminder_repeat_hours*3600000; }
    if(!due) continue;
    addNotification(a.created_by, `Reminder: your assignment "${a.title}" is due in ${days} day${days===1?'':'s'} (${a.due_date}).`, 'teacher_deadline_reminder');
    db.prepare("UPDATE teacher_assignment_reminders SET last_sent_at=datetime('now') WHERE assignment_id=?").run(a.id);
  }
}

// Teacher reminder engine for pending special consideration requests.
function runSpecialConsiderationReminderEngine() {
  const now = new Date();
  const hour = now.getHours();
  const rows = db.prepare(`SELECT sc.id,sc.assigned_teacher_id,sc.created_at,sc.assignment_id,a.title assignment_title,
    r.last_sent_at,u.name student_name,us.sc_reminder_start_hour,us.sc_reminder_end_hour,us.sc_reminder_repeat_hours
    FROM special_considerations sc
    JOIN assignments a ON a.id=sc.assignment_id
    JOIN users u ON u.id=sc.student_id
    JOIN users us ON us.id=sc.assigned_teacher_id
    JOIN special_consideration_reminders r ON r.special_consideration_id=sc.id
    WHERE sc.status='Pending'`).all();
  for (const r of rows) {
    if(hour<r.sc_reminder_start_hour || hour>r.sc_reminder_end_hour) continue;
    let due=true;
    if(r.last_sent_at){ const last=new Date(r.last_sent_at.replace(' ','T')+'Z'); due=(now-last)>=r.sc_reminder_repeat_hours*3600000; }
    if(!due) continue;
    addNotification(r.assigned_teacher_id, `Reminder: ${r.student_name} has a pending special consideration request for "${r.assignment_title}".`, 'special_consideration_reminder');
    db.prepare("UPDATE special_consideration_reminders SET last_sent_at=datetime('now') WHERE special_consideration_id=?").run(r.id);
  }
}

// Reminder engine. It checks once per minute. Notifications are generated only
// during each student's preferred window and repeat interval.
function runReminderEngine() {
  const now = new Date();
  const hour = now.getHours();
  const assignments = db.prepare(`SELECT a.id,a.title,COALESCE(x.due_date_override,a.due_date) due_date,u.code unit_code,x.student_id,r.last_sent_at,us.reminder_days_before,us.reminder_start_hour,us.reminder_end_hour,us.reminder_repeat_hours
    FROM assignments a JOIN units u ON u.id=a.unit_id JOIN assignment_students x ON x.assignment_id=a.id JOIN users us ON us.id=x.student_id
    JOIN assignment_reminders r ON r.assignment_id=a.id AND r.student_id=x.student_id
    WHERE a.status!='Done'`).all();
  for (const a of assignments) {
    const days=daysUntil(a.due_date);
    if(days===null||days<0||days>a.reminder_days_before) continue;
    if(hour<a.reminder_start_hour||hour>a.reminder_end_hour) continue;
    let due=true;
    if(a.last_sent_at){ const last=new Date(a.last_sent_at.replace(' ','T')+'Z'); due=(now-last)>=a.reminder_repeat_hours*3600000; }
    if(!due) continue;
    addNotification(a.student_id, `Reminder: "${a.title}" is due in ${days} day${days===1?'':'s'} (${a.due_date}).`, 'deadline_reminder');
    db.prepare("UPDATE assignment_reminders SET last_sent_at=datetime('now') WHERE assignment_id=? AND student_id=?").run(a.id,a.student_id);
  }
}
setInterval(runReminderEngine,60000);
setInterval(runTeacherDeadlineReminderEngine,60000);
setInterval(runSpecialConsiderationReminderEngine,60000);
runReminderEngine();
runTeacherDeadlineReminderEngine();
runSpecialConsiderationReminderEngine();

app.listen(PORT,()=>console.log(`Deadline Tracker server running at http://localhost:${PORT}`));
