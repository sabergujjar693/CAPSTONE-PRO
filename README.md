# Deadline Tracker — Version 3
### HS3052 Capstone Project — Group 02

A web application where **teachers create assignments and deadlines and assign them to enrolled students**. Students see only the assignments assigned to them, receive in-app notifications, configure reminder preferences, and can submit special consideration requests to a teacher.

## Workflow

1. A teacher creates a unit/course such as HS3052.
2. The teacher enrols students into that unit.
3. The teacher creates an assignment with its description, weighting, priority and due date.
4. The teacher selects the enrolled students who should receive that assignment.
5. The system immediately creates an in-app notification for every selected student.
6. Each student has their own reminder preferences: how many days before the deadline, a notification time window, and repeat interval.
7. During that window, the server generates repeated in-app deadline reminders until the assignment is due.
8. A student can update their assignment status and submit a special consideration request.
9. The teacher can approve or reject that request. If a requested new due date is approved, the assignment deadline is updated and the student is notified.

## Database / ER-style relationships

- **users** — stores student and teacher accounts.
- **units** — a teacher-created course/unit.
- **enrolments** — connects students to units (many-to-many).
- **assignments** — teacher-created work belonging to a unit.
- **assignment_students** — connects assignments to the students who must complete them (many-to-many).
- **assignment_reminders** — stores reminder delivery state for each student/assignment pair.
- **special_considerations** — connects a student, assignment and teacher request.
- **notifications** — stores in-app notifications for users.

Conceptually:

```text
Teacher ──< Units ──< Assignments
              │           │
              │           └──< Assignment_Students >── Student
              └──< Enrolments >── Student

Student ──< Special_Considerations >── Teacher
Student ──< Notifications
Student ──< Assignment_Reminders >── Assignment
```

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js + Express REST API
- Authentication: bcryptjs + express-session
- Database: SQLite via better-sqlite3

## Run locally

Requires Node.js LTS.

```bash
cd backend
npm install
npm run seed
npm run check
npm start
```

Then open **http://localhost:3000**.

`npm run seed` resets the local demo database and loads the demonstration data. `npm run check` performs a static integrity/syntax audit of the project files.

## Demonstration accounts

All seeded accounts use password **`password123`**.

### Teachers
- `teacher@example.edu` — Dr. Sarah Teacher
- `teacher2@example.edu` — Mr. Daniel Teacher

### Students
- `ray@edu.au` — Student 1
- `student2@example.edu` — Student 2
- `student3@example.edu` — Student 3
- `student4@example.edu` — Student 4
- `student5@example.edu` — Student 5
- `student6@example.edu` — Student 6
- `student7@example.edu` — Student 7
- `student8@example.edu` — Student 8
- `student9@example.edu` — Student 9
- `student10@example.edu` — Student 10
- `student@example.edu` — additional Student 1 demo login

Students 1–5 receive **Capstone Progress Report**. Students 1–10 plus the additional demo login receive **Final Capstone Presentation**. Student 1 and the additional demo login use a 5-day, 12:00–21:00, 3-hour reminder preference. Students 2–10 use 3 days, 12:00–21:00, every 3 hours.

## Main API groups

- `/api/auth/*` — registration and login
- `/api/units` — teacher-created units
- `/api/teacher/students` — student/enrolment data
- `/api/teacher/enrolments` — enrolment management
- `/api/teacher/assignments` — teacher assignment creation/editing
- `/api/assignments` — assignments visible to the signed-in student
- `/api/special-considerations` — student requests and teacher decisions
- `/api/notifications` — in-app notifications
- `/api/users/me` — student and teacher notification/reminder preferences (days, start/end, repeat, email, push)

## Student groups and automatic enrolment

Each subject/unit has a subject-based group named after the unit, for example:

- **Capstone Project** — HS3052
- **IT for Business** — HS3051
- **Programming** — HS3053

When a teacher enrols a student in a unit from **Students & Enrolments**, the system automatically adds that student to the matching subject group. If the subject group does not yet exist, it is created automatically. This makes it easy for teachers to assign an assignment to everyone enrolled in a subject.

Teachers can also create additional named groups within a unit. Group members must be enrolled in that unit. When an assignment is assigned to a group, the system resolves the group to individual enrolled students, creates their assignment/reminder records, and creates an in-app notification for each student.

## Teacher reminder settings

Teachers have the same complete notification settings as students:

- **Days before** — how early to receive reminders for assignments created by that teacher.
- **Start time** — beginning of the daily reminder window.
- **End time** — end of the daily reminder window.
- **Repeat interval** — how often reminders may repeat.
- **Email notifications** — on/off.
- **Browser/phone notifications** — on/off when Web Push is configured.

The teacher's start/end/repeat window also controls repeated reminders for pending Special Consideration requests. A new Special Consideration request creates an immediate in-app notification for the assigned teacher.

## Notifications and external delivery

The notification bell always provides in-app notifications. Optional email and Web Push delivery are supported when the required configuration is supplied. If external delivery is not configured, in-app notifications continue to work normally.

### Email
Set these environment variables before `npm start`:
- `SMTP_HOST`
- `SMTP_PORT` (usually 587)
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (optional)

When configured, assignment notifications, special-consideration notifications and deadline reminders can also be emailed.

### Phone / browser push
The app supports Web Push notifications when VAPID credentials are configured:
- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Phone/browser notifications also require browser permission. On iPhone/iPad, Web Push requires the web app to be added to the Home Screen.

External delivery is optional; the core in-app notification system does not require SMTP or VAPID configuration.

## Notification settings behaviour

The Settings window always shows all six configurable notification controls for both students and teachers:

1. Days before
2. Start time
3. End time
4. Repeat interval
5. Email notifications
6. Browser/phone notifications

For students, these values control deadline reminders for assignments assigned to them. For teachers, the days-before value controls deadline reminders for assignments they created, while the same start/end/repeat window also controls pending Special Consideration reminders.

Settings are saved through `PUT /api/users/me` and returned by `GET /api/auth/me`. The save button shows a saving state and the modal closes only after the server confirms the update. Reopening Settings reads the saved values back into the form.

A fresh database automatically loads the full demonstration dataset when `npm start` is run. An existing database is never reset by `npm start`. Use `npm run seed` only when you intentionally want to reset demo data.

## Limitations

This is a local academic prototype. External email/push delivery requires provider configuration, the notification scheduler runs while the Node.js server is running, and teacher accounts are still self-registered rather than connected to a university identity system.

## Demo dataset

`npm run seed` resets the local SQLite database and creates:
- 2 teacher accounts
- 10 main student accounts
- A separate `student@example.edu` demo login mirroring Student 1's Capstone assignments
- HS3052 — Capstone Project with all main students plus the demo login enrolled
- HS3051 — IT for Business with 5 demo students
- HS3053 — Programming with 5 demo students
- Subject-based groups named **Capstone Project**, **IT for Business**, and **Programming**
- Two Capstone demonstration assignments
- A demonstration pending Special Consideration request
- Immediate in-app notifications for assigned students and the teacher
- Student 1 reminder preference: 5 days before, 12:00–21:00, every 3 hours

Demo password for all seeded accounts: `password123`.
