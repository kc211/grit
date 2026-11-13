-- GRIT demo database reset + comprehensive seed data.
-- WARNING: This script DROPS and recreates all application tables and demo data.
-- Run only against your local/demo database, never production.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS notifications, malpractice_flags, bookings, interviewer_slots,
  student_skills, badges, skills, track_skills, tracks, interviewers, students CASCADE;

CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  miles INTEGER NOT NULL DEFAULT 0 CHECK (miles >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE interviewers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL
);
CREATE TABLE tracks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE skills (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE track_skills (
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY(track_id, skill_id)
);
CREATE TABLE student_skills (
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  cleared_at TIMESTAMPTZ,
  PRIMARY KEY(student_id, skill_id)
);
CREATE TABLE badges (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  track_id INT NOT NULL REFERENCES tracks(id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(student_id, track_id)
);
CREATE TABLE interviewer_slots (
  id SERIAL PRIMARY KEY,
  interviewer_id INT NOT NULL REFERENCES interviewers(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WITHDRAWN')),
  withdrawal_reason TEXT,
  CHECK(ends_at > starts_at),
  EXCLUDE USING gist (interviewer_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  track_id INT NOT NULL REFERENCES tracks(id),
  slot_id INT NOT NULL REFERENCES interviewer_slots(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','CANCELLED','COMPLETED')),
  outcome TEXT CHECK(outcome IN ('PASS','FAIL','RETAKE_LATER','NO_SHOW')),
  feedback TEXT,
  retake_after DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_booking_per_slot ON bookings(slot_id) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX one_scheduled_booking_per_student_track ON bookings(student_id,track_id) WHERE status='SCHEDULED';
CREATE INDEX bookings_student_idx ON bookings(student_id, starts_at DESC);
CREATE INDEX bookings_schedule_idx ON bookings(slot_id, starts_at);
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'INFO',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE malpractice_flags (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  track_id INT REFERENCES tracks(id),
  reason TEXT NOT NULL,
  flagged_by INT REFERENCES interviewers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Six demo students. Five have at least one READY_TO_BOOK track after reset.
INSERT INTO students(name,email,miles) VALUES
 ('Aarav Sharma','aarav@grit.demo',1250),
 ('Diya Reddy','diya@grit.demo',1800),
 ('Kabir Mehta','kabir@grit.demo',900),
 ('Ananya Rao','ananya@grit.demo',2100),
 ('Ishaan Patel','ishaan@grit.demo',650),
 ('Meera Nair','meera@grit.demo',1500);

INSERT INTO interviewers(name,email) VALUES
 ('Priya Menon','priya@grit.demo'),
 ('Rahul Verma','rahul@grit.demo'),
 ('Sneha Iyer','sneha@grit.demo');

INSERT INTO tracks(name,description) VALUES
 ('Full Stack Engineering','Build and ship production-ready web applications.'),
 ('AI Engineering','Design reliable AI-powered products.'),
 ('Cloud & DevOps','Deploy, monitor and scale modern systems.');

INSERT INTO skills(name) VALUES
 ('HTML & CSS'),('JavaScript'),('React'),
 ('Python'),('LLM Fundamentals'),('FastAPI'),
 ('Linux'),('Docker'),('Cloud Basics');

INSERT INTO track_skills(track_id,skill_id)
SELECT t.id,s.id FROM tracks t CROSS JOIN skills s
WHERE (t.name='Full Stack Engineering' AND s.name IN ('HTML & CSS','JavaScript','React'))
   OR (t.name='AI Engineering' AND s.name IN ('Python','LLM Fundamentals','FastAPI'))
   OR (t.name='Cloud & DevOps' AND s.name IN ('Linux','Docker','Cloud Basics'));

-- Student 1: all three tracks cleared; Full Stack scheduled; AI and Cloud ready.
-- Student 2: AI passed (badge); Full Stack and Cloud ready.
-- Student 3: Full Stack failed and in 14-day cooldown; AI and Cloud ready.
-- Student 4: Cloud badge revoked/on hold; Full Stack and AI ready; also has an interview awaiting result.
-- Student 5: incomplete skills and an active integrity hold on Full Stack; no READY_TO_BOOK track.
-- Student 6: Cloud no-show cooldown; AI retake-later cooldown; Full Stack ready.
WITH completed(student_id, skill_name) AS (
  VALUES
  (1,'HTML & CSS'),(1,'JavaScript'),(1,'React'),(1,'Python'),(1,'LLM Fundamentals'),(1,'FastAPI'),(1,'Linux'),(1,'Docker'),(1,'Cloud Basics'),
  (2,'Python'),(2,'LLM Fundamentals'),(2,'FastAPI'),(2,'Linux'),(2,'Docker'),(2,'Cloud Basics'),
  (3,'HTML & CSS'),(3,'JavaScript'),(3,'React'),(3,'Python'),(3,'LLM Fundamentals'),(3,'FastAPI'),(3,'Linux'),(3,'Docker'),(3,'Cloud Basics'),
  (4,'HTML & CSS'),(4,'JavaScript'),(4,'React'),(4,'Python'),(4,'LLM Fundamentals'),(4,'FastAPI'),(4,'Linux'),(4,'Docker'),(4,'Cloud Basics'),
  (5,'HTML & CSS'),(5,'JavaScript'),
  (6,'HTML & CSS'),(6,'JavaScript'),(6,'React'),(6,'Python'),(6,'LLM Fundamentals'),(6,'FastAPI'),(6,'Linux'),(6,'Docker'),(6,'Cloud Basics')
)
INSERT INTO student_skills(student_id,skill_id,cleared_at)
SELECT c.student_id,s.id,now()-interval '5 days'
FROM completed c JOIN skills s ON s.name=c.skill_name;

-- Create 3 interviewers' availability across the next 7 days.
-- Each interviewer gets non-overlapping 30-minute slots; the same start time
-- is shared by different interviewers so the UI can show interviewer choices.
INSERT INTO interviewer_slots(interviewer_id,starts_at,ends_at)
SELECT interviewer_id,
       day_start + interval '10 hours' + slot_no * interval '30 minutes',
       day_start + interval '10 hours' + (slot_no + 1) * interval '30 minutes'
FROM (
  SELECT i AS interviewer_id,
         (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') + d * interval '1 day' AS day_start,
         n AS slot_no
  FROM generate_series(1,3) i
  CROSS JOIN generate_series(1,7) d
  CROSS JOIN generate_series(0,7) n
) slots;

-- One historic slot is used to represent an interview that has started but
-- whose result is still pending (AWAITING_RESULT).
INSERT INTO interviewer_slots(interviewer_id,starts_at,ends_at)
VALUES (1,
  (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - interval '1 day' + interval '10 hours',
  (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - interval '1 day' + interval '10 hours 30 minutes');

-- Aarav: upcoming Full Stack interview -> SCHEDULED.
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status)
SELECT 1,1,id,starts_at,ends_at,'SCHEDULED'
FROM interviewer_slots
WHERE starts_at >= now()+interval '1 hour'
ORDER BY starts_at, interviewer_id LIMIT 1;

-- Diya: successful AI interview -> PASSED + active badge + 500 bonus Miles.
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,completed_at)
SELECT 2,2,id,starts_at,ends_at,'COMPLETED','PASS',
       'Strong AI fundamentals, clear explanation of LLM concepts and practical FastAPI knowledge.',now()-interval '3 days'
FROM interviewer_slots WHERE interviewer_id=2 ORDER BY starts_at LIMIT 1;
INSERT INTO badges(student_id,track_id,status,awarded_at) VALUES (2,2,'ACTIVE',now()-interval '3 days');
UPDATE students SET miles=miles+500 WHERE id=2;

-- Kabir: failed Full Stack interview; retake unavailable for 14 days.
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,retake_after,completed_at)
SELECT 3,1,id,starts_at,ends_at,'COMPLETED','FAIL',
       'Revise React state management, API integration and JavaScript fundamentals.',current_date+14,now()-interval '2 days'
FROM interviewer_slots WHERE interviewer_id=3 ORDER BY starts_at LIMIT 1;

-- Ananya: Cloud badge was earned and later revoked due to malpractice.
INSERT INTO badges(student_id,track_id,status,awarded_at,revoked_at)
VALUES (4,3,'REVOKED',now()-interval '20 days',now()-interval '1 day');
INSERT INTO malpractice_flags(student_id,track_id,reason,flagged_by,created_at)
VALUES (4,3,'Post-interview integrity review flagged this attempt.',1,now()-interval '1 day');
-- Ananya also has an already-started Full Stack interview awaiting result.
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status)
SELECT 4,1,id,starts_at,ends_at,'SCHEDULED'
FROM interviewer_slots WHERE interviewer_id=1 AND starts_at < now()
ORDER BY starts_at DESC LIMIT 1;

-- Ishaan: intentionally ineligible. Required skills are incomplete and
-- Full Stack also has an unresolved pre-pass malpractice hold.
INSERT INTO malpractice_flags(student_id,track_id,reason,flagged_by)
VALUES (5,1,'Demo case: unresolved integrity review before interview.',2);

-- Meera: Cloud NO_SHOW (7-day cooldown), AI RETAKE_LATER (future date),
-- while Full Stack remains READY_TO_BOOK.
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,retake_after,completed_at)
SELECT 6,3,id,starts_at,ends_at,'COMPLETED','NO_SHOW',
       'Student did not attend the scheduled interview.',current_date+7,now()-interval '1 day'
FROM interviewer_slots WHERE interviewer_id=2 ORDER BY starts_at DESC LIMIT 1;
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,retake_after,completed_at)
SELECT 6,2,id,starts_at,ends_at,'COMPLETED','RETAKE_LATER',
       'Please revisit the core LLM concepts and return for another discussion.',current_date+10,now()-interval '4 days'
FROM interviewer_slots WHERE interviewer_id=3 ORDER BY starts_at DESC LIMIT 1;

-- A cancelled booking demonstrates that a released slot can be booked again.
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status)
SELECT 2,1,id,starts_at,ends_at,'CANCELLED'
FROM interviewer_slots
WHERE starts_at >= now()+interval '1 hour'
  AND id NOT IN (SELECT slot_id FROM bookings WHERE status<>'CANCELLED')
ORDER BY starts_at DESC LIMIT 1;

-- Cooldown-expired example: Aarav failed Cloud & DevOps more than 14 days ago.
-- The cooldown has elapsed, so that track is bookable again (READY_TO_BOOK).
INSERT INTO interviewer_slots(interviewer_id,starts_at,ends_at)
VALUES (3,
  (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - interval '20 days' + interval '10 hours',
  (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - interval '20 days' + interval '10 hours 30 minutes');
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,retake_after,completed_at)
SELECT 1,3,id,starts_at,ends_at,'COMPLETED','FAIL',
       'Previous attempt was unsuccessful; the 14-day cooldown has now expired.',current_date-1,now()-interval '20 days'
FROM interviewer_slots WHERE interviewer_id=3 ORDER BY starts_at LIMIT 1;

-- One future slot is withdrawn to demonstrate interviewer availability management.
UPDATE interviewer_slots SET status='WITHDRAWN',withdrawal_reason='Interviewer unavailable (demo case)'
WHERE id=(
  SELECT s.id FROM interviewer_slots s
  WHERE s.status='OPEN' AND s.starts_at>now()+interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status<>'CANCELLED')
  ORDER BY s.starts_at DESC,s.id DESC LIMIT 1
);

-- Notifications make the seeded journeys visible in student dashboards.
INSERT INTO notifications(student_id,title,body,kind) VALUES
 (1,'Interview booked','Your Full Stack Engineering interview is scheduled. Join from My Interviews.','SUCCESS'),
 (2,'Badge earned','Congratulations! You passed your AI Engineering interview. Your badge is active and 500 bonus Miles have been added.','SUCCESS'),
 (3,'Interview result','You did not clear this interview. You can book another attempt after the cooldown. Review the feedback in My Interviews.','WARNING'),
 (4,'Interview started','Your Full Stack Engineering interview has started. The result will appear here once recorded.','INFO'),
 (4,'Badge revoked','Your Cloud & DevOps badge was revoked following an integrity review.','WARNING'),
 (5,'Interview journey on hold','An integrity review has placed your Full Stack Engineering track on hold. Contact the GRIT team.','WARNING'),
 (6,'Interview marked no-show','You can book another Cloud & DevOps attempt after the 7-day cooldown.','WARNING'),
 (6,'Retake requested','The interviewer has asked you to return for another AI Engineering attempt after the retake date.','INFO');

-- Sanity-check query (run separately after the script):
-- SELECT s.name,t.name, ... journey_state is calculated by the API.
-- Expected: Aarav, Diya, Kabir, Ananya and Meera each have >=1 READY_TO_BOOK track.
-- Ishaan is the only seeded student with no READY_TO_BOOK track.
