// db.js - SQLite database and schema for the Deadline Tracker.
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'deadline_tracker.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  reminder_days_before INTEGER NOT NULL DEFAULT 3,
  reminder_start_hour INTEGER NOT NULL DEFAULT 12,
  reminder_end_hour INTEGER NOT NULL DEFAULT 21,
  reminder_repeat_hours INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrolments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(unit_id, student_id),
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(unit_id, name),
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_id, student_id),
  FOREIGN KEY (group_id) REFERENCES student_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  weighting INTEGER DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Not started',
  notes TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assignment_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_date_override TEXT,
  UNIQUE(assignment_id, student_id),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  last_sent_at TEXT,
  UNIQUE(assignment_id, student_id),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS special_considerations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  assigned_teacher_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  requested_due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  teacher_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_teacher_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS special_consideration_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  special_consideration_id INTEGER NOT NULL UNIQUE,
  last_sent_at TEXT,
  FOREIGN KEY (special_consideration_id) REFERENCES special_considerations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teacher_assignment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL UNIQUE,
  teacher_id INTEGER NOT NULL,
  last_sent_at TEXT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// Small migration for databases created by the previous prototype.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('reminder_start_hour')) db.exec("ALTER TABLE users ADD COLUMN reminder_start_hour INTEGER NOT NULL DEFAULT 12");
if (!userColumns.includes('reminder_end_hour')) db.exec("ALTER TABLE users ADD COLUMN reminder_end_hour INTEGER NOT NULL DEFAULT 21");
if (!userColumns.includes('reminder_repeat_hours')) db.exec("ALTER TABLE users ADD COLUMN reminder_repeat_hours INTEGER NOT NULL DEFAULT 3");
if (!userColumns.includes('email_notifications')) db.exec("ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1");
if (!userColumns.includes('push_notifications')) db.exec("ALTER TABLE users ADD COLUMN push_notifications INTEGER NOT NULL DEFAULT 0");
if (!userColumns.includes('sc_reminder_start_hour')) db.exec("ALTER TABLE users ADD COLUMN sc_reminder_start_hour INTEGER NOT NULL DEFAULT 12");
if (!userColumns.includes('sc_reminder_end_hour')) db.exec("ALTER TABLE users ADD COLUMN sc_reminder_end_hour INTEGER NOT NULL DEFAULT 21");
if (!userColumns.includes('sc_reminder_repeat_hours')) db.exec("ALTER TABLE users ADD COLUMN sc_reminder_repeat_hours INTEGER NOT NULL DEFAULT 3");

const assignmentStudentColumns = db.prepare('PRAGMA table_info(assignment_students)').all().map(c => c.name);
if (!assignmentStudentColumns.includes('due_date_override')) db.exec("ALTER TABLE assignment_students ADD COLUMN due_date_override TEXT");

const assignmentColumns = db.prepare('PRAGMA table_info(assignments)').all().map(c => c.name);
if (!assignmentColumns.includes('created_by')) {
  // Old assignments are retained only for compatibility; seed.js resets the demo database.
  db.exec("ALTER TABLE assignments ADD COLUMN created_by INTEGER");
  db.exec("UPDATE assignments SET created_by = (SELECT id FROM users WHERE role='teacher' ORDER BY id LIMIT 1) WHERE created_by IS NULL");
}

// Backfill teacher reminder state for assignments created before this table existed.
db.exec(`INSERT OR IGNORE INTO teacher_assignment_reminders (assignment_id,teacher_id)
  SELECT id,created_by FROM assignments WHERE created_by IS NOT NULL`);

module.exports = db;
