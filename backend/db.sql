CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS notifications, malpractice_flags, bookings, interviewer_slots,
 student_skills, badges, skills, track_skills, tracks, interviewers, students CASCADE;

CREATE TABLE students (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 miles INTEGER NOT NULL DEFAULT 0 CHECK (miles >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE interviewers (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL
);
CREATE TABLE tracks (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE skills (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE
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
 id SERIAL PRIMARY KEY, student_id INT NOT NULL REFERENCES students(id),
 track_id INT NOT NULL REFERENCES tracks(id), status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
 awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ,
 UNIQUE(student_id, track_id)
);
CREATE TABLE interviewer_slots (
 id SERIAL PRIMARY KEY, interviewer_id INT NOT NULL REFERENCES interviewers(id),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WITHDRAWN')),
 withdrawal_reason TEXT,
 CHECK(ends_at > starts_at),
 EXCLUDE USING gist (interviewer_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);
CREATE TABLE bookings (
 id SERIAL PRIMARY KEY, student_id INT NOT NULL REFERENCES students(id),
 track_id INT NOT NULL REFERENCES tracks(id), slot_id INT NOT NULL REFERENCES interviewer_slots(id),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','CANCELLED','COMPLETED')),
 outcome TEXT CHECK(outcome IN ('PASS','FAIL','RETAKE_LATER','NO_SHOW')),
 feedback TEXT, retake_after DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_booking_per_slot ON bookings(slot_id) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX one_scheduled_booking_per_student_track ON bookings(student_id,track_id) WHERE status='SCHEDULED';
CREATE INDEX bookings_student_idx ON bookings(student_id, starts_at DESC);
CREATE INDEX bookings_schedule_idx ON bookings(slot_id, starts_at);
CREATE TABLE notifications (
 id SERIAL PRIMARY KEY, student_id INT NOT NULL REFERENCES students(id),
 title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'INFO',
 read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE malpractice_flags (
 id SERIAL PRIMARY KEY, student_id INT NOT NULL REFERENCES students(id),
 track_id INT REFERENCES tracks(id), reason TEXT NOT NULL,
 flagged_by INT REFERENCES interviewers(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 resolved_at TIMESTAMPTZ
);

INSERT INTO students(name,email,miles) VALUES
 ('Aarav Sharma','aarav@grit.demo',1250),('Diya Reddy','diya@grit.demo',1800),
 ('Kabir Mehta','kabir@grit.demo',900),('Ananya Rao','ananya@grit.demo',2100),
 ('Ishaan Patel','ishaan@grit.demo',650),('Meera Nair','meera@grit.demo',1500);
INSERT INTO interviewers(name,email) VALUES
 ('Priya Menon','priya@grit.demo'),('Rahul Verma','rahul@grit.demo'),('Sneha Iyer','sneha@grit.demo');
INSERT INTO tracks(name,description) VALUES
 ('Full Stack Engineering','Build and ship production-ready web applications.'),
 ('AI Engineering','Design reliable AI-powered products.'),
 ('Cloud & DevOps','Deploy, monitor and scale modern systems.');
INSERT INTO skills(name) VALUES
 ('HTML & CSS'),('JavaScript'),('React'),('Python'),('LLM Fundamentals'),('FastAPI'),('Linux'),('Docker'),('Cloud Basics');
INSERT INTO track_skills SELECT t.id,s.id FROM tracks t CROSS JOIN skills s
 WHERE (t.name='Full Stack Engineering' AND s.name IN ('HTML & CSS','JavaScript','React'))
 OR (t.name='AI Engineering' AND s.name IN ('Python','LLM Fundamentals','FastAPI'))
 OR (t.name='Cloud & DevOps' AND s.name IN ('Linux','Docker','Cloud Basics'));
-- Each student has a different completion profile.
INSERT INTO student_skills(student_id,skill_id,cleared_at)
SELECT st.id, sk.id, now()-interval '5 days'
FROM students st JOIN skills sk ON
 (st.id=1 AND sk.name IN ('HTML & CSS','JavaScript','React','Python'))
 OR (st.id=2 AND sk.name IN ('HTML & CSS','JavaScript','React','Python','LLM Fundamentals','FastAPI'))
 OR (st.id=3 AND sk.name IN ('HTML & CSS','JavaScript'))
 OR (st.id=4 AND sk.name IN ('Python','LLM Fundamentals','FastAPI','Linux','Docker','Cloud Basics'))
 OR (st.id=5 AND sk.name IN ('Linux'))
 OR (st.id=6 AND sk.name IN ('HTML & CSS','JavaScript','React','Python','LLM Fundamentals','FastAPI','Linux','Docker','Cloud Basics'));
-- Availability: future 30-minute slots across the next several days.
INSERT INTO interviewer_slots(interviewer_id,starts_at,ends_at)
SELECT ((n-1)%3)+1, date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
 + interval '1 day' + ((n-1)/3)*interval '1 hour' + interval '10 hours',
 date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
 + interval '1 day' + ((n-1)/3)*interval '1 hour' + interval '10 hours 30 minutes'
FROM generate_series(1,18) n;
-- Demo journeys (future booking, completed outcomes).
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,completed_at,retake_after)
SELECT 1,1, (SELECT id FROM interviewer_slots ORDER BY starts_at LIMIT 1),
 (SELECT starts_at FROM interviewer_slots ORDER BY starts_at LIMIT 1),
 (SELECT ends_at FROM interviewer_slots ORDER BY starts_at LIMIT 1),'SCHEDULED',NULL,NULL,NULL,NULL;
INSERT INTO notifications(student_id,title,body,kind) VALUES
 (1,'Track progress updated','You are close to unlocking your Full Stack Engineering interview.','INFO'),
 (2,'Badge earned','Your AI Engineering badge is active. Great work!','SUCCESS');
INSERT INTO badges(student_id,track_id,status) VALUES (2,2,'ACTIVE');
UPDATE students SET miles=miles+500 WHERE id=2;
INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at,status,outcome,feedback,completed_at)
SELECT 2,2,id,starts_at,ends_at,'COMPLETED','PASS','Strong fundamentals and clear problem-solving.',now()
FROM interviewer_slots WHERE id=(SELECT max(id) FROM interviewer_slots);
INSERT INTO badges(student_id,track_id,status) VALUES (4,3,'REVOKED');
INSERT INTO malpractice_flags(student_id,track_id,reason) VALUES (4,3,'Post-interview integrity review flagged this attempt.');
INSERT INTO notifications(student_id,title,body,kind) VALUES
 (4,'Badge review update','Your Cloud & DevOps badge was revoked following an integrity review.','WARNING');
