from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

IST = ZoneInfo("Asia/Kolkata")
CONFLICT_MESSAGE = "That time was just taken. Pick another slot."

def today_ist():
    return datetime.now(IST).date()

def journey_state(conn, student_id, track_id):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""SELECT count(*) AS total,
          count(*) FILTER (WHERE ss.cleared_at IS NOT NULL) AS done
          FROM track_skills ts LEFT JOIN student_skills ss
          ON ss.skill_id=ts.skill_id AND ss.student_id=%s WHERE ts.track_id=%s""",
          (student_id, track_id))
        skills = cur.fetchone()
        cur.execute("""SELECT * FROM malpractice_flags WHERE student_id=%s
          AND (track_id=%s OR track_id IS NULL) AND resolved_at IS NULL ORDER BY id DESC LIMIT 1""",
          (student_id, track_id))
        flag = cur.fetchone()
        cur.execute("SELECT * FROM badges WHERE student_id=%s AND track_id=%s", (student_id,track_id))
        badge = cur.fetchone()
        if flag:
            return "BADGE_REVOKED" if badge and badge["status"] == "REVOKED" else "ON_HOLD"
        if badge and badge["status"] == "REVOKED":
            return "BADGE_REVOKED"
        if badge and badge["status"] == "ACTIVE":
            return "PASSED"
        if not skills["total"] or skills["done"] < skills["total"]:
            return "NOT_ELIGIBLE"
        cur.execute("""SELECT * FROM bookings WHERE student_id=%s AND track_id=%s
          ORDER BY created_at DESC,id DESC LIMIT 1""", (student_id,track_id))
        booking = cur.fetchone()
        if not booking:
            return "READY_TO_BOOK"
        if booking["status"] == "SCHEDULED":
            return "AWAITING_RESULT" if booking["starts_at"] <= datetime.now(IST) else "SCHEDULED"
        if booking["outcome"] == "FAIL" and booking["retake_after"] and booking["retake_after"] > today_ist(): return "FAILED"
        if booking["outcome"] == "RETAKE_LATER" and booking["retake_after"] and booking["retake_after"] > today_ist(): return "RETAKE_LATER"
        if booking["outcome"] == "NO_SHOW" and booking["completed_at"] and booking["completed_at"].date()+timedelta(days=7) > today_ist(): return "NO_SHOW"
        return "READY_TO_BOOK"

def add_notification(cur, student_id, title, body, kind="INFO"):
    cur.execute("INSERT INTO notifications(student_id,title,body,kind) VALUES(%s,%s,%s,%s)",
                (student_id,title,body,kind))

def ensure_eligible(cur, student_id, track_id):
    cur.execute("""SELECT count(*) total,
      count(*) FILTER(WHERE ss.cleared_at IS NOT NULL) done
      FROM track_skills ts LEFT JOIN student_skills ss
      ON ss.skill_id=ts.skill_id AND ss.student_id=%s WHERE ts.track_id=%s""",
      (student_id,track_id))
    row=cur.fetchone()
    if not row or row["total"] == 0 or row["done"] != row["total"]:
        raise ValueError("You must clear every required skill before booking.")
    cur.execute("""SELECT 1 FROM malpractice_flags WHERE student_id=%s
      AND (track_id=%s OR track_id IS NULL) AND resolved_at IS NULL""",(student_id,track_id))
    if cur.fetchone(): raise ValueError("Your interview journey is on hold. Contact the GRIT team.")
    cur.execute("SELECT status FROM badges WHERE student_id=%s AND track_id=%s",(student_id,track_id))
    b=cur.fetchone()
    if b and b["status"]=="ACTIVE": raise ValueError("You have already earned this track badge.")
    cur.execute("SELECT 1 FROM bookings WHERE student_id=%s AND track_id=%s AND status='SCHEDULED' LIMIT 1",
                (student_id,track_id))
    if cur.fetchone(): raise ValueError("You already have an interview scheduled for this track.")
    cur.execute("""SELECT outcome,retake_after,starts_at,completed_at FROM bookings WHERE student_id=%s AND track_id=%s
      AND status='COMPLETED' ORDER BY created_at DESC LIMIT 1""",(student_id,track_id))
    prev=cur.fetchone()
    if prev:
        if prev["outcome"]=="FAIL" and prev["retake_after"] and prev["retake_after"]>today_ist():
            raise ValueError(f"You can rebook after {prev['retake_after'].isoformat()}.")
        if prev["outcome"]=="NO_SHOW" and prev["completed_at"] and prev["completed_at"].date()+timedelta(days=7)>today_ist():
            raise ValueError("You can rebook 7 days after the missed interview.")
        if prev["outcome"]=="RETAKE_LATER" and prev["retake_after"] and prev["retake_after"]>today_ist():
            raise ValueError(f"You can rebook after {prev['retake_after'].isoformat()}.")

def assign_slot(cur, starts_at, student_id, track_id):
    cur.execute("""SELECT s.id,s.interviewer_id,s.starts_at,s.ends_at,i.name interviewer_name
      FROM interviewer_slots s JOIN interviewers i ON i.id=s.interviewer_id
      WHERE s.status='OPEN' AND s.starts_at=%s AND s.ends_at=%s + interval '30 minutes'
      AND s.starts_at >= now()+interval '1 hour'
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status<>'CANCELLED')
      ORDER BY s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED""",(starts_at,starts_at))
    slot=cur.fetchone()
    if not slot: raise LookupError(CONFLICT_MESSAGE)
    cur.execute("""INSERT INTO bookings(student_id,track_id,slot_id,starts_at,ends_at)
      VALUES(%s,%s,%s,%s,%s) RETURNING id""",
      (student_id,track_id,slot["id"],slot["starts_at"],slot["ends_at"]))
    return cur.fetchone()["id"],slot

def book(conn, student_id, track_id, starts_at):
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            ensure_eligible(cur,student_id,track_id)
            bid,slot=assign_slot(cur,starts_at,student_id,track_id)
            when=slot["starts_at"].astimezone(IST).strftime("%d %b %Y, %I:%M %p")
            add_notification(cur,student_id,"Interview booked",
              f"Your interview is booked for {when} IST. Join from My Interviews.","SUCCESS")
            return bid

def reschedule(conn, booking_id, starts_at):
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT * FROM bookings WHERE id=%s FOR UPDATE",(booking_id,))
            old=cur.fetchone()
            if not old or old["status"]!="SCHEDULED": raise ValueError("Only an active booking can be rescheduled.")
            if old["starts_at"]-datetime.now(IST)<timedelta(hours=4): raise ValueError("Rescheduling closes 4 hours before the interview.")
            cur.execute("UPDATE bookings SET status='CANCELLED' WHERE id=%s",(booking_id,))
            bid,slot=assign_slot(cur,starts_at,old["student_id"],old["track_id"])
            add_notification(cur,old["student_id"],"Interview rescheduled",
              f"Your new interview is scheduled for {slot['starts_at'].astimezone(IST).strftime('%d %b %Y, %I:%M %p')} IST.")
            return bid

def cancel(conn, booking_id):
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT * FROM bookings WHERE id=%s FOR UPDATE",(booking_id,))
            b=cur.fetchone()
            if not b or b["status"]!="SCHEDULED": raise ValueError("This booking is no longer active.")
            if b["starts_at"]-datetime.now(IST)<timedelta(hours=4): raise ValueError("Cancellation closes 4 hours before the interview.")
            cur.execute("UPDATE bookings SET status='CANCELLED' WHERE id=%s",(booking_id,))
            add_notification(cur,b["student_id"],"Interview cancelled","Your interview booking was cancelled.")
            return True

def record_outcome(conn, booking_id, outcome, feedback="", retake_after=None):
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""SELECT b.*,s.name student_name,t.name track_name FROM bookings b
              JOIN students s ON s.id=b.student_id JOIN tracks t ON t.id=b.track_id
              WHERE b.id=%s FOR UPDATE""",(booking_id,))
            b=cur.fetchone()
            if not b or b["status"]!="SCHEDULED": raise ValueError("Outcome can only be recorded for an active booking.")
            if outcome not in ("PASS","FAIL","RETAKE_LATER","NO_SHOW"): raise ValueError("Unsupported outcome.")
            if outcome=="RETAKE_LATER" and not retake_after: raise ValueError("Choose a retake date.")
            if outcome=="FAIL" and not retake_after: retake_after=today_ist()+timedelta(days=14)
            if outcome=="NO_SHOW": retake_after=today_ist()+timedelta(days=7)
            cur.execute("""UPDATE bookings SET status='COMPLETED',outcome=%s,feedback=%s,
              retake_after=%s,completed_at=now() WHERE id=%s""",(outcome,feedback,retake_after,booking_id))
            if outcome=="PASS":
                cur.execute("""INSERT INTO badges(student_id,track_id,status) VALUES(%s,%s,'ACTIVE')
                  ON CONFLICT(student_id,track_id) DO UPDATE SET status='ACTIVE',awarded_at=now(),revoked_at=NULL""",
                  (b["student_id"],b["track_id"]))
                cur.execute("UPDATE students SET miles=miles+500 WHERE id=%s",(b["student_id"],))
                add_notification(cur,b["student_id"],"Badge earned",
                  "Congratulations! You passed your interview. Your badge is now active and 500 bonus Miles have been added.","SUCCESS")
            elif outcome=="FAIL":
                add_notification(cur,b["student_id"],"Interview result",
                  f"You did not clear this interview. You can book another attempt after {retake_after}. Review the feedback in My Interviews.","WARNING")
            elif outcome=="RETAKE_LATER":
                add_notification(cur,b["student_id"],"Retake scheduled",
                  f"The interviewer has asked you to return on or after {retake_after}.","INFO")
            else:
                add_notification(cur,b["student_id"],"Interview marked no-show",
                  f"You can book another attempt after {retake_after}.","WARNING")
            return True

def flag_malpractice(conn, student_id, track_id, reason, flagged_by=None):
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT * FROM badges WHERE student_id=%s AND track_id=%s FOR UPDATE",(student_id,track_id))
            badge=cur.fetchone()
            cur.execute("INSERT INTO malpractice_flags(student_id,track_id,reason,flagged_by) VALUES(%s,%s,%s,%s)",
                        (student_id,track_id,reason,flagged_by))
            if badge and badge["status"]=="ACTIVE":
                cur.execute("UPDATE badges SET status='REVOKED',revoked_at=now() WHERE id=%s",(badge["id"],))
                cur.execute("UPDATE students SET miles=GREATEST(0,miles-500) WHERE id=%s",(student_id,))
                add_notification(cur,student_id,"Badge revoked",
                  "Your badge has been revoked following an integrity review. 500 bonus Miles have been removed.","WARNING")
            else:
                add_notification(cur,student_id,"Interview journey on hold",
                  "An integrity review has placed this track on hold. Contact the GRIT team for next steps.","WARNING")
