// seed.js - reset and load a realistic teacher/student demonstration dataset.
const bcrypt = require('bcryptjs');
const db = require('./db');

function daysFromNow(days) {
  const d = new Date(); d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}

function seedDemoData() {
const clear = db.transaction(() => {
  db.exec(`
    DELETE FROM notifications;
    DELETE FROM special_considerations;
    DELETE FROM assignment_reminders;
    DELETE FROM assignment_students;
    DELETE FROM assignments;
    DELETE FROM group_members;
    DELETE FROM student_groups;
    DELETE FROM enrolments;
    DELETE FROM units;
    DELETE FROM users;
  `);
});
clear();

const passwordHash = bcrypt.hashSync('password123', 10);
const insertUser = db.prepare(`INSERT INTO users (name,email,password_hash,role,reminder_days_before,reminder_start_hour,reminder_end_hour,reminder_repeat_hours) VALUES (?,?,?,?,?,?,?,?)`);
const teacher = insertUser.run('Dr. Sarah Teacher','teacher@example.edu',passwordHash,'teacher',3,12,21,3).lastInsertRowid;
const teacher2 = insertUser.run('Mr. Daniel Teacher','teacher2@example.edu',passwordHash,'teacher',3,12,21,3).lastInsertRowid;

const students=[];
for(let i=1;i<=10;i++) {
  const id=insertUser.run(`Student ${i}`,i===1 ? 'ray@edu.au' : `student${i}@example.edu`,passwordHash,'student', i===1 ? 5 : 3, 12, 21, i===1 ? 3 : 3).lastInsertRowid;
  students.push(id);
}

// Generic demo login: student@example.edu is an additional Student 1 login.
// It uses the same password and receives the same demo assignments as Student 1.
const demoStudent = insertUser.run('Student 1 Demo','student@example.edu',passwordHash,'student',5,12,21,3).lastInsertRowid;

const unitId=db.prepare('INSERT INTO units (user_id,code,name) VALUES (?,?,?)').run(teacher,'HS3052','Capstone Project').lastInsertRowid;
const hs3051Id=db.prepare('INSERT INTO units (user_id,code,name) VALUES (?,?,?)').run(teacher,'HS3051','IT for Business').lastInsertRowid;
const hs3053Id=db.prepare('INSERT INTO units (user_id,code,name) VALUES (?,?,?)').run(teacher,'HS3053','Programming').lastInsertRowid;

const insertEnrol=db.prepare('INSERT INTO enrolments (unit_id,student_id) VALUES (?,?)');
for(const id of students) insertEnrol.run(unitId,id);
insertEnrol.run(unitId,demoStudent);

// Random-looking demo enrolments for the two additional units.
const hs3051Students=[students[1],students[3],students[5],students[7],students[9]];
const hs3053Students=[students[0],students[2],students[4],students[6],students[8]];
for(const id of hs3051Students) insertEnrol.run(hs3051Id,id);
for(const id of hs3053Students) insertEnrol.run(hs3053Id,id);

// One subject-based group per unit. Each group contains every student enrolled in that subject,
// so teachers can select the subject group directly when creating an assignment.
const addMember=db.prepare('INSERT INTO group_members (group_id,student_id) VALUES (?,?)');
const capstoneGroup=db.prepare('INSERT INTO student_groups (unit_id,name) VALUES (?,?)').run(unitId,'Capstone Project').lastInsertRowid;
for(const id of [...students,demoStudent]) addMember.run(capstoneGroup,id);

const hs3051Group=db.prepare('INSERT INTO student_groups (unit_id,name) VALUES (?,?)').run(hs3051Id,'IT for Business').lastInsertRowid;
const hs3053Group=db.prepare('INSERT INTO student_groups (unit_id,name) VALUES (?,?)').run(hs3053Id,'Programming').lastInsertRowid;
for(const id of hs3051Students) addMember.run(hs3051Group,id);
for(const id of hs3053Students) addMember.run(hs3053Group,id);

const insertAssignment=db.prepare('INSERT INTO assignments (unit_id,title,due_date,weighting,priority,status,notes,created_by) VALUES (?,?,?,?,?,?,?,?)');
const insertAS=db.prepare('INSERT INTO assignment_students (assignment_id,student_id) VALUES (?,?)');
const insertReminder=db.prepare('INSERT INTO assignment_reminders (assignment_id,student_id) VALUES (?,?)');
const insertNotif=db.prepare('INSERT INTO notifications (user_id,message,type) VALUES (?,?,?)');

// Assignment 1 -> Capstone Project subject group (demo assignment).
const a1=insertAssignment.run(unitId,'Capstone Progress Report',daysFromNow(5),20,'High','Not started','Teacher-created assignment for the Capstone Project subject group.',teacher).lastInsertRowid;
for(const id of students.slice(0,5)) { insertAS.run(a1,id); insertReminder.run(a1,id); insertNotif.run(id,`New assignment: "Capstone Progress Report" for HS3052. Due ${daysFromNow(5)}.`,'assignment_created'); }
insertAS.run(a1,demoStudent); insertReminder.run(a1,demoStudent); insertNotif.run(demoStudent,`New assignment: "Capstone Progress Report" for HS3052. Due ${daysFromNow(5)}.`,'assignment_created');

// Assignment 2 -> Capstone Project subject group (all enrolled students).
const a2=insertAssignment.run(unitId,'Final Capstone Presentation',daysFromNow(10),30,'Medium','Not started','Teacher-created assignment for the Capstone Project subject group.',teacher).lastInsertRowid;
for(const id of students) { insertAS.run(a2,id); insertReminder.run(a2,id); insertNotif.run(id,`New assignment: "Final Capstone Presentation" for HS3052. Due ${daysFromNow(10)}.`,'assignment_created'); }
insertAS.run(a2,demoStudent); insertReminder.run(a2,demoStudent); insertNotif.run(demoStudent,`New assignment: "Final Capstone Presentation" for HS3052. Due ${daysFromNow(10)}.`,'assignment_created');

// Teacher deadline reminder state for the assignments created by the teacher.
const teacherReminder=db.prepare('INSERT INTO teacher_assignment_reminders (assignment_id,teacher_id) VALUES (?,?)');
teacherReminder.run(a1,teacher);
teacherReminder.run(a2,teacher);

// Demo special consideration request from Student 1 to the teacher.
const sc=db.prepare(`INSERT INTO special_considerations (assignment_id,student_id,assigned_teacher_id,reason,requested_due_date) VALUES (?,?,?,?,?)`)
  .run(a1,students[0],teacher,'Requesting extra time for the progress report demonstration.',daysFromNow(11)).lastInsertRowid;
insertNotif.run(teacher,`Student 1 submitted special consideration for "Capstone Progress Report".`,'special_consideration');

console.log('Demo data loaded.');
console.log('Teacher: teacher@example.edu / password123');
console.log('Teacher 2: teacher2@example.edu / password123');
for(let i=1;i<=10;i++) console.log(`Student ${i}: ${i===1?'ray@edu.au':`student${i}@example.edu`} / password123`);
console.log('Generic student demo login: student@example.edu / password123 (same demo assignments as Student 1).');
console.log('Subject groups: Capstone Project = all HS3052-enrolled students; IT for Business = its enrolled students; Programming = its enrolled students.');
console.log('Student 1 reminder preference: 5 days before, 12:00-21:00, every 3 hours.');
console.log('Students 2-10 reminder preference: 3 days before, 12:00-21:00, every 3 hours.');
}

module.exports = { seedDemoData };
if (require.main === module) seedDemoData();
