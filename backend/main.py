import os
from datetime import datetime, date, time, timedelta
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from psycopg.errors import UniqueViolation, ExclusionViolation
import logic
import time as pytime
from fastapi import Request
from dotenv import load_dotenv


load_dotenv()



IST = ZoneInfo("Asia/Kolkata")

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing. Check your environment variables.")

pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=True
)
app=FastAPI(title="GRIT Interview Scheduling API",version="1.0")

@app.middleware("http")
async def log_request_time(request: Request, call_next):
    start = pytime.perf_counter()

    response = await call_next(request)

    elapsed = pytime.perf_counter() - start

    print(
        f"[API] {request.method} {request.url.path} "
        f"| Status: {response.status_code} "
        f"| Time: {elapsed:.3f}s"
    )

    return response
app.add_middleware(CORSMiddleware,allow_origins=os.getenv("CORS_ORIGINS","*").split(","),allow_credentials=False,allow_methods=["*"],allow_headers=["*"])

class BookingIn(BaseModel):
    student_id:int
    track_id:int
    starts_at:datetime
class RescheduleIn(BaseModel): starts_at:datetime
class SlotIn(BaseModel):
    day:date
    start:time
    end:time
class WithdrawIn(BaseModel): reason:str=Field(min_length=3,max_length=300)
class OutcomeIn(BaseModel):
    outcome:str
    feedback:str=""
    retake_after:date|None=None
class FlagIn(BaseModel):
    student_id:int
    track_id:int
    reason:str=Field(min_length=3,max_length=500)

def db():
    return pool.connection()
def normalize(dt):
    if dt.tzinfo is None: return dt.replace(tzinfo=IST)
    return dt.astimezone(IST)
def fail(e):
    msg=str(e)
    if isinstance(e,LookupError): raise HTTPException(409,logic.CONFLICT_MESSAGE)
    if isinstance(e,ValueError): raise HTTPException(400,msg)
    if isinstance(e,(UniqueViolation,ExclusionViolation)): raise HTTPException(409,logic.CONFLICT_MESSAGE)
    raise HTTPException(500,"Something went wrong. Please try again.")

@app.get("/api/health")
def health():
    with db() as c: c.execute("SELECT 1")
    return {"status":"ok"}

@app.get("/api/meta")
def meta():
    with db() as c, c.cursor() as q:
        q.execute("SELECT id,name,description FROM tracks ORDER BY id"); tracks=q.fetchall()
        q.execute("SELECT id,name,email FROM students ORDER BY name"); students=q.fetchall()
        q.execute("SELECT id,name,email FROM interviewers ORDER BY name"); interviewers=q.fetchall()
    return {"tracks":tracks,"students":students,"interviewers":interviewers,"roles":["Student","Interviewer","Interview Team"],"timezone":"Asia/Kolkata"}

@app.get("/api/students/{student_id}")
def student_dashboard(student_id:int):
    with db() as c, c.cursor() as q:
        q.execute("SELECT id,name,email,miles FROM students WHERE id=%s",(student_id,)); student=q.fetchone()
        if not student: raise HTTPException(404,"Student not found.")
        q.execute("""SELECT t.id track_id,t.name track_name,t.description,
          count(ts.skill_id) total_skills,count(ss.cleared_at) cleared_skills,
          array_agg(json_build_object('id',sk.id,'name',sk.name,'cleared',ss.cleared_at IS NOT NULL)) skills
          FROM tracks t LEFT JOIN track_skills ts ON ts.track_id=t.id
          LEFT JOIN skills sk ON sk.id=ts.skill_id
          LEFT JOIN student_skills ss ON ss.skill_id=sk.id AND ss.student_id=%s
          GROUP BY t.id ORDER BY t.id""",(student_id,)); tracks=q.fetchall()
        for t in tracks: t["journey_state"]=logic.journey_state(c,student_id,t["track_id"])
        q.execute("""SELECT b.id,b.track_id,t.name track_name,b.starts_at,b.ends_at,b.status,b.outcome,b.feedback,b.retake_after,
          i.name interviewer_name,i.id interviewer_id,s.id slot_id
          FROM bookings b JOIN tracks t ON t.id=b.track_id JOIN interviewer_slots s ON s.id=b.slot_id
          JOIN interviewers i ON i.id=s.interviewer_id WHERE b.student_id=%s ORDER BY b.starts_at DESC""",(student_id,)); bookings=q.fetchall()
        q.execute("SELECT id,status,awarded_at,revoked_at,track_id FROM badges WHERE student_id=%s ORDER BY awarded_at DESC",(student_id,)); badges=q.fetchall()
        q.execute("SELECT id,title,body,kind,created_at,read_at FROM notifications WHERE student_id=%s ORDER BY created_at DESC LIMIT 20",(student_id,)); notifications=q.fetchall()
        q.execute("SELECT count(*) FROM badges WHERE student_id=%s AND status='ACTIVE'",(student_id,)); qualifier=q.fetchone()["count"]>0
        q.execute("SELECT id,name,miles,rank() OVER(ORDER BY miles DESC) rank FROM students ORDER BY miles DESC")
        leaderboard=q.fetchall()
    return {"student":student,"tracks":tracks,"bookings":bookings,"badges":badges,"notifications":notifications,"qualifier":qualifier,"leaderboard":leaderboard}

@app.get("/api/students/{student_id}/slots")
def student_slots(student_id:int,track_id:int):
    with db() as c, c.cursor() as q:
        q.execute("SELECT 1 FROM students WHERE id=%s",(student_id,))
        if not q.fetchone():
            raise HTTPException(404,"Student not found.")
        q.execute("SELECT 1 FROM tracks WHERE id=%s",(track_id,))
        if not q.fetchone():
            raise HTTPException(404,"Track not found.")
        # Never disclose bookable slots to a student who is not eligible.
        try:
            logic.ensure_eligible(q,student_id,track_id)
        except ValueError as e:
            raise HTTPException(status_code=403,detail=str(e))
        q.execute("""SELECT s.id,s.starts_at,s.ends_at,i.name interviewer_name
          FROM interviewer_slots s JOIN interviewers i ON i.id=s.interviewer_id
          WHERE s.status='OPEN' AND s.starts_at>=now()+interval '1 hour'
          AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status<>'CANCELLED')
          ORDER BY s.starts_at LIMIT 100""")
        return {"slots":q.fetchall()}

@app.post("/api/bookings")
def create_booking(body:BookingIn):
    try:
        with db() as c: bid=logic.book(c,body.student_id,body.track_id,normalize(body.starts_at))
        return {"id":bid,"message":"Interview booked successfully."}
    except Exception as e: fail(e)

@app.post("/api/bookings/{booking_id}/reschedule")
def reschedule(booking_id:int,body:RescheduleIn):
    try:
        with db() as c: bid=logic.reschedule(c,booking_id,normalize(body.starts_at))
        return {"id":bid,"message":"Interview rescheduled successfully."}
    except Exception as e: fail(e)

@app.post("/api/bookings/{booking_id}/cancel")
def cancel(booking_id:int):
    try:
        with db() as c: logic.cancel(c,booking_id)
        return {"message":"Booking cancelled."}
    except Exception as e: fail(e)

@app.get("/api/interviewers/{interviewer_id}/schedule")
def schedule(interviewer_id:int,day:date=Query(...)):
    start=datetime.combine(day,time.min,IST); end=start+timedelta(days=1)
    with db() as c, c.cursor() as q:
        q.execute("""SELECT b.id,b.starts_at,b.ends_at,b.status,b.outcome,b.feedback,b.retake_after,
          st.id student_id,st.name student_name,t.id track_id,t.name track_name
          FROM bookings b JOIN interviewer_slots sl ON sl.id=b.slot_id
          JOIN students st ON st.id=b.student_id JOIN tracks t ON t.id=b.track_id
          WHERE sl.interviewer_id=%s AND b.starts_at>=%s AND b.starts_at<%s AND b.status<>'CANCELLED'
          ORDER BY b.starts_at""",(interviewer_id,start,end))
        return {"bookings":q.fetchall()}

@app.get("/api/interviewers/{interviewer_id}/slots")
def interviewer_slots(
    interviewer_id: int,
    from_day: date = Query(..., alias="from")
):
    start=datetime.combine(from_day,time.min,IST); end=start+timedelta(days=7)
    with db() as c, c.cursor() as q:
        q.execute("""SELECT s.*,EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status<>'CANCELLED') booked
          FROM interviewer_slots s WHERE interviewer_id=%s AND starts_at>=%s AND starts_at<%s ORDER BY starts_at""",
          (interviewer_id,start,end))
        return {"slots":q.fetchall()}

@app.post("/api/interviewers/{interviewer_id}/slots")
def add_availability(interviewer_id:int,body:SlotIn):
    start=datetime.combine(body.day,body.start,IST); end=datetime.combine(body.day,body.end,IST)
    if end<=start or end-start!=timedelta(minutes=30): raise HTTPException(400,"Availability must be exactly 30 minutes.")
    if start<datetime.now(IST)+timedelta(hours=1): raise HTTPException(400,"Availability must be at least one hour ahead.")
    try:
        with db() as c, c.cursor() as q:
            q.execute("INSERT INTO interviewer_slots(interviewer_id,starts_at,ends_at) VALUES(%s,%s,%s) RETURNING id",
                      (interviewer_id,start,end)); sid=q.fetchone()["id"]
        return {"id":sid,"message":"Availability added."}
    except Exception as e: fail(e)

@app.post("/api/slots/{slot_id}/withdraw")
def withdraw_slot(slot_id:int,body:WithdrawIn):
    with db() as c, c.cursor() as q:
        q.execute("SELECT * FROM interviewer_slots WHERE id=%s FOR UPDATE",(slot_id,)); slot=q.fetchone()
        if not slot: raise HTTPException(404,"Slot not found.")
        q.execute("SELECT 1 FROM bookings WHERE slot_id=%s AND status='SCHEDULED'",(slot_id,))
        if q.fetchone(): raise HTTPException(409,"This slot has a booking. Reschedule it before withdrawing.")
        q.execute("UPDATE interviewer_slots SET status='WITHDRAWN',withdrawal_reason=%s WHERE id=%s",(body.reason,slot_id))
    return {"message":"Availability withdrawn."}

@app.post("/api/bookings/{booking_id}/outcome")
def outcome(booking_id:int,body:OutcomeIn):
    try:
        with db() as c: logic.record_outcome(c,booking_id,body.outcome,body.feedback,body.retake_after)
        return {"message":"Outcome saved."}
    except Exception as e: fail(e)


@app.get("/api/team/tracker")
def team_tracker():
    with db() as c, c.cursor() as q:
        q.execute("""
            WITH skill_progress AS (
                SELECT
                    st.id AS student_id,
                    t.id AS track_id,
                    COUNT(ts.skill_id) AS total_skills,
                    COUNT(ss.cleared_at) AS cleared_skills
                FROM students st
                CROSS JOIN tracks t
                LEFT JOIN track_skills ts
                    ON ts.track_id = t.id
                LEFT JOIN student_skills ss
                    ON ss.student_id = st.id
                    AND ss.skill_id = ts.skill_id
                GROUP BY st.id, t.id
            )
            SELECT
                st.id AS student_id,
                st.name AS student_name,
                st.email AS student_email,
                t.id AS track_id,
                t.name AS track_name,
                sp.total_skills,
                sp.cleared_skills,
                b.id AS booking_id,
                b.starts_at,
                b.status AS booking_status,
                b.outcome,
                b.feedback,
                b.retake_after,
                i.name AS interviewer_name,

                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM malpractice_flags mf
                        WHERE mf.student_id = st.id
                        AND (mf.track_id = t.id OR mf.track_id IS NULL)
                        AND mf.resolved_at IS NULL
                    ) THEN 'FLAGGED'

                    WHEN EXISTS (
                        SELECT 1
                        FROM badges bd
                        WHERE bd.student_id = st.id
                        AND bd.track_id = t.id
                        AND bd.status = 'ACTIVE'
                    ) THEN 'PASSED'

                    WHEN b.status = 'SCHEDULED'
                    AND b.starts_at <= now()
                    THEN 'RESULT_PENDING'

                    WHEN b.status = 'SCHEDULED'
                    THEN 'BOOKED'

                    WHEN b.outcome = 'RETAKE_LATER'
                    THEN 'WAITING'

                    WHEN b.outcome IN ('FAIL', 'NO_SHOW')
                    THEN 'WAITING'

                    WHEN sp.total_skills > 0
                    AND sp.cleared_skills = sp.total_skills
                    THEN 'NOT_BOOKED'

                    ELSE 'INELIGIBLE'
                END AS tab

            FROM students st
            CROSS JOIN tracks t

            JOIN skill_progress sp
                ON sp.student_id = st.id
                AND sp.track_id = t.id

            LEFT JOIN LATERAL (
                SELECT *
                FROM bookings bx
                WHERE bx.student_id = st.id
                AND bx.track_id = t.id
                ORDER BY bx.created_at DESC
                LIMIT 1
            ) b ON true

            LEFT JOIN interviewer_slots sl
                ON sl.id = b.slot_id

            LEFT JOIN interviewers i
                ON i.id = sl.interviewer_id

            ORDER BY st.name, t.name
        """)

        return {"items": q.fetchall()}

@app.post("/api/team/flag")
def flag(body:FlagIn):
    try:
        with db() as c: logic.flag_malpractice(c,body.student_id,body.track_id,body.reason)
        return {"message":"Malpractice flag recorded."}
    except Exception as e: fail(e)

@app.post("/api/team/reminder")
def reminder(body:dict):
    with db() as c, c.cursor() as q:
        q.execute("INSERT INTO notifications(student_id,title,body,kind) VALUES(%s,%s,%s,'INFO')",
          (body["student_id"],"Interview reminder",body.get("message","You are eligible to book your GRIT interview.")))
    return {"message":"Reminder sent to the student dashboard."}

@app.post("/api/team/reset")
def reset_demo():
    # Safe demo reset: clears transactional activity and restores sample progress/credits.
    with db() as c, c.cursor() as q:
        q.execute("TRUNCATE notifications,malpractice_flags,bookings,badges RESTART IDENTITY CASCADE")
        q.execute("UPDATE students SET miles=CASE id WHEN 1 THEN 1250 WHEN 2 THEN 1800 WHEN 3 THEN 900 WHEN 4 THEN 2100 WHEN 5 THEN 650 ELSE 1500 END")
        q.execute("UPDATE interviewer_slots SET status='OPEN',withdrawal_reason=NULL")
    return {"message":"Demo activity reset. Seeded skill progress and availability remain."}
