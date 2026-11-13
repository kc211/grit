# GRIT Interview Scheduling — Product & Technical Write-up

## 1. Student journey states

| Derived state | Entry condition | Next transition |
|---|---|---|
| NOT_ELIGIBLE | One or more required track skills remain uncleared | Clear all track skills → READY_TO_BOOK |
| READY_TO_BOOK | All required skills cleared; no active hold, badge or cooldown | Book a valid slot → SCHEDULED |
| SCHEDULED | Active booking exists and start time is in the future | Start time reached → AWAITING_RESULT; cancel/reschedule before T−4h |
| AWAITING_RESULT | Active booking has started; outcome not recorded | Interviewer records an outcome |
| PASSED | PASS outcome and active badge exists | Malpractice flag → BADGE_REVOKED |
| FAILED | FAIL outcome recorded | 14-day cooldown expires → READY_TO_BOOK |
| RETAKE_LATER | Interviewer requests a future attempt | Retake date reached → READY_TO_BOOK |
| NO_SHOW | Interviewer records absence | 7-day cooldown expires → READY_TO_BOOK |
| ON_HOLD | Unresolved malpractice flag before passing | Team review/resolution |
| BADGE_REVOKED | Malpractice flag after badge award; badge revoked and 500 bonus Miles removed | Team review/resolution |

The journey is calculated from track-skill completion, the latest booking, badge status and unresolved malpractice flags. It is not stored as a mutable status column.

## 2. Edge cases and assumptions

- Eligibility is checked again inside the booking transaction; frontend state is informational only.
- Booking requires at least one hour lead time. A 30-minute availability interval is the unit of booking.
- Cancellation and rescheduling are allowed only while at least four hours remain.
- Rescheduling cancels the original and creates the replacement in one transaction. A failed replacement rolls back the cancellation.
- A slot can have only one non-cancelled booking; a student can have only one scheduled booking per track.
- Interviewer availability cannot overlap. A booked slot cannot be withdrawn.
- Concurrent booking attempts lock candidate availability rows using `FOR UPDATE SKIP LOCKED`; database uniqueness/exclusion constraints are the final guard. Conflicts return HTTP 409 and “That time was just taken. Pick another slot.”
- FAIL uses a 14-day cooldown; NO_SHOW uses 7 days; RETAKE_LATER requires an explicit date and is not a failure.
- Interviewers may record outcomes before the start time in demo mode.
- A pre-pass malpractice flag places the track on hold. A post-pass flag revokes the badge and removes exactly 500 bonus Miles (without allowing a negative balance).
- The prototype uses a dashboard notification feed as the student-facing message channel; it does not send email/SMS.
- The assignment requests no authentication. Role/person switching is a demo control, not access control.

## 3. Data model

| Table | Key fields and purpose |
|---|---|
| students | id, name, email, miles |
| interviewers | id, name, email |
| tracks | id, name, description |
| skills | id, name |
| track_skills | track_id + skill_id; required skills per track |
| student_skills | student_id + skill_id, cleared_at |
| interviewer_slots | interviewer_id, starts_at, ends_at, status; 30-minute availability |
| bookings | student_id, track_id, slot_id, starts_at, ends_at, status, outcome, feedback, retake_after |
| badges | student_id, track_id, status, awarded_at, revoked_at |
| notifications | student_id, title, body, kind, created_at, read_at |
| malpractice_flags | student_id, track_id, reason, flagged_by, created_at, resolved_at |

Foreign keys preserve ownership and relationships. Dashboard, booking and schedule lookup indexes are included. `btree_gist` exclusion prevents intersecting availability ranges for the same interviewer. Partial unique indexes prevent duplicate active slot bookings and multiple scheduled bookings for the same student/track.

## 4. Concurrency and transaction strategy

Booking validates eligibility in the backend, selects a matching open slot using `SELECT ... FOR UPDATE SKIP LOCKED`, then inserts the booking and notification in one transaction. PostgreSQL partial unique indexes catch any remaining races. Reschedule locks the current booking, checks the T−4h rule, cancels it, locks and inserts the replacement, and writes a notification in the same transaction. Any exception rolls the entire transaction back. Outcome recording and badge/Miles/notification changes are also atomic.

## 5. Malpractice handling

The team records a flag with a reason. If no active badge exists, the track is ON_HOLD. If the student already holds an active badge, the badge becomes REVOKED and 500 bonus Miles are deducted in the same transaction. The student receives a dashboard notification. Resolution/review is intentionally left to an authorized future team workflow.
