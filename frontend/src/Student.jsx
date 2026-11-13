
import React, { useEffect, useMemo, useState } from "react";
import { get, post, ist, dateInput } from "./lib";

const money = (n) => Number(n || 0).toLocaleString("en-IN");

const State = ({ value }) => (
  <span className={`state state-${String(value).toLowerCase()}`}>
    {String(value).replaceAll("_", " ")}
  </span>
);

function Ticket({ booking, onReschedule, onCancel, disabled }) {
  return (
    <div className="ticket">
      <div className="ticket-main">
        <div className="eyebrow">GRIT · BOARDING PASS</div>
        <h3>{booking.track_name}</h3>

        <div className="ticket-grid">
          <div>
            <small>DATE & TIME</small>
            <b>{ist(booking.starts_at)}</b>
          </div>
          <div>
            <small>INTERVIEWER</small>
            <b>{booking.interviewer_name}</b>
          </div>
          <div>
            <small>FORMAT</small>
            <b>Live online · 30 min</b>
          </div>
          <div>
            <small>BOOKING ID</small>
            <b>GR-{String(booking.id).padStart(5, "0")}</b>
          </div>
        </div>

        <div className="ticket-actions">
          <button
            className="btn primary"
            onClick={() => window.open("https://meet.google.com/", "_blank")}
          >
            Join interview ↗
          </button>
          <button
            className="btn light"
            disabled={disabled}
            onClick={onReschedule}
          >
            Reschedule
          </button>
          <button
            className="btn textbtn"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>

        {disabled && (
          <small className="muted">
            Changes close 4 hours before your interview.
          </small>
        )}
      </div>

      <div className="ticket-stub">
        <span>YOUR NEXT MILESTONE</span>
        <strong>30</strong>
        <small>MINUTES</small>
        <div className="barcode">▥ ▥ ▥ ▥ ▥</div>
      </div>
    </div>
  );
}

function JourneyCard({ track, onBook }) {
  const pct = track.total_skills
    ? Math.round((track.cleared_skills / track.total_skills) * 100)
    : 0;

  return (
    <article className="card journey">
      <div className="row between">
        <div>
          <div className="eyebrow">TRACK JOURNEY</div>
          <h3>{track.track_name}</h3>
        </div>
        <State value={track.journey_state} />
      </div>

      <p className="muted">{track.description}</p>

      <div className="progress-head">
        <span>Skill completion</span>
        <b>
          {track.cleared_skills}/{track.total_skills}
        </b>
      </div>

      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="skill-list">
        {track.skills?.map((s) => (
          <span className={s.cleared ? "skill done" : "skill"} key={s.id}>
            {s.cleared ? "✓" : "○"} {s.name}
          </span>
        ))}
      </div>

      {track.journey_state === "READY_TO_BOOK" && (
        <button
          className="btn primary full"
          onClick={() => onBook(track.track_id)}
        >
          Book interview <span>→</span>
        </button>
      )}
    </article>
  );
}

function LoadingState({ message = "Loading your GRIT dashboard…" }) {
  return (
    <div className="loading-state">
      <div className="loader" />
      <p>{message}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="empty error-state">
      <p>{message}</p>
      <button className="btn primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export default function Student({
  studentId,
  page,
  meta,
  notify,
  refreshKey,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [track, setTrack] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");

  const [selected, setSelected] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState("READY_TO_BOOK");
  const [reloadKey, setReloadKey] = useState(0);

  // Load student dashboard.
  useEffect(() => {
    const controller = new AbortController();

    async function loadStudent() {
      setLoading(true);
      setLoadError("");
      setData(null);
      setSlots([]);
      setSelected("");
      setSelectedSlotId("");

      try {
        const d = await get(`/api/students/${studentId}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        setData(d);

        setTrack((current) => {
          if (
            current &&
            d.tracks.some((t) => String(t.track_id) === String(current))
          ) {
            return current;
          }

          const firstEligible = d.tracks.find(
            (t) => t.journey_state === "READY_TO_BOOK"
          );

          return String(
            (firstEligible || d.tracks[0])?.track_id || ""
          );
        });
      } catch (e) {
        if (e.name !== "AbortError") {
          setLoadError(e.message || "Unable to load student dashboard.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadStudent();

    return () => controller.abort();
  }, [studentId, refreshKey, reloadKey]);

  // Load slots only when the student is on the booking page
  // and the selected track is eligible.
  useEffect(() => {
    const currentTrack = data?.tracks?.find(
      (t) => String(t.track_id) === String(track)
    );

    if (
      page !== "Book Interview" ||
      !track ||
      !currentTrack ||
      currentTrack.journey_state !== "READY_TO_BOOK"
    ) {
      setSlots([]);
      setSelected("");
      setSelectedSlotId("");
      setSlotsLoading(false);
      setSlotsError("");
      return;
    }

    const controller = new AbortController();

    setSlots([]);
    setSelected("");
    setSelectedSlotId("");
    setSlotsLoading(true);
    setSlotsError("");

    async function loadSlots() {
      try {
        const d = await get(
          `/api/students/${studentId}/slots?track_id=${track}`,
          { signal: controller.signal }
        );

        if (!controller.signal.aborted) {
          setSlots(d.slots || []);
        }
      } catch (e) {
        if (e.name !== "AbortError") {
          setSlotsError(e.message || "Unable to load available slots.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSlotsLoading(false);
        }
      }
    }

    loadSlots();

    return () => controller.abort();
  }, [page, track, studentId, data?.tracks]);

  const upcoming = data?.bookings?.find(
    (b) => b.status === "SCHEDULED"
  );

  // Group identical start times into one time option.
  // Different interviewers remain available in the dropdown.
  const grouped = useMemo(() => {
    const byDay = {};

    for (const slot of slots) {
      const date = dateInput(slot.starts_at);

      byDay[date] ??= [];

      let timeGroup = byDay[date].find(
        (x) =>
          new Date(x.starts_at).getTime() ===
          new Date(slot.starts_at).getTime()
      );

      if (!timeGroup) {
        timeGroup = {
          starts_at: slot.starts_at,
          options: [],
        };

        byDay[date].push(timeGroup);
      }

      timeGroup.options.push(slot);
    }

    Object.values(byDay).forEach((items) =>
      items.sort(
        (a, b) =>
          new Date(a.starts_at) - new Date(b.starts_at)
      )
    );

    return byDay;
  }, [slots]);

  const activeDay = grouped[day]
    ? day
    : Object.keys(grouped)[0] || "";

  const selectedGroup = (grouped[activeDay] || []).find(
    (x) => x.starts_at === selected
  );

  const selectedSlot = selectedGroup?.options.find(
    (x) => String(x.id) === String(selectedSlotId)
  );

  // Refresh dashboard data after a successful action.
  function reloadStudent() {
    setReloadKey((x) => x + 1);
  }

  async function book() {
    if (!selectedSlot || busy) return;

    setBusy(true);

    try {
      await post("/api/bookings", {
        student_id: Number(studentId),
        track_id: Number(track),
        starts_at: selectedSlot.starts_at,
        slot_id: Number(selectedSlot.id),
      });

      notify("Your interview has been booked.");
      setSelected("");
      setSelectedSlotId("");
      setSlots([]);
      reloadStudent();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(b) {
    if (!confirm("Cancel this interview booking?")) return;

    try {
      await post(`/api/bookings/${b.id}/cancel`);
      notify("Booking cancelled.");
      reloadStudent();
    } catch (e) {
      notify(e.message);
    }
  }

  async function reschedule(b) {
    try {
      const available = await get(
        `/api/students/${studentId}/slots?track_id=${b.track_id}`
      );

      const next = available.slots.find(
        (s) => s.id !== b.slot_id
      );

      if (!next) {
        notify("No alternative slots are available right now.");
        return;
      }

      await post(`/api/bookings/${b.id}/reschedule`, {
        starts_at: next.starts_at,
      });

      notify("Interview rescheduled.");
      reloadStudent();
    } catch (e) {
      notify(e.message);
    }
  }

  if (loading) {
    return <LoadingState />;
  }

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        onRetry={reloadStudent}
      />
    );
  }

  if (!data) return null;

  const {
    student,
    tracks,
    bookings,
    badges,
    notifications,
    leaderboard,
  } = data;

  const title = page === "Home" ? "Your learning journey" : page;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            STUDENT PORTAL / {page.toUpperCase()}
          </div>

          <h1>
            {page === "Home"
              ? `Welcome back, ${student.name.split(" ")[0]}`
              : title}
          </h1>

          <p className="muted">
            {page === "Home"
              ? "Keep building skills. Your next milestone is closer than you think."
              : "Track your progress and manage your GRIT interview journey."}
          </p>
        </div>

        <div className="date-pill">◷ &nbsp; All times in IST</div>
      </div>

      {page === "Home" && (
        <>
          <div className="stats">
            <div className="stat-card">
              <span>YOUR MILES</span>
              <strong>{money(student.miles)}</strong>
              <small>Across all GRIT challenges</small>
            </div>

            <div className="stat-card">
              <span>ACTIVE BADGES</span>
              <strong>
                {badges.filter((b) => b.status === "ACTIVE").length}
              </strong>
              <small>Track credentials earned</small>
            </div>

            <div className="stat-card">
              <span>QUALIFIER STATUS</span>
              <strong>
                {data.qualifier ? "Qualified" : "In progress"}
              </strong>
              <small>
                {data.qualifier
                  ? "You have at least one active badge"
                  : "Earn your first track badge"}
              </small>
            </div>
          </div>

          {upcoming && (
            <section className="section">
              <div className="section-title">
                <div>
                  <div className="eyebrow">UP NEXT</div>
                  <h2>Your upcoming interview</h2>
                </div>

                <button
                  className="link-btn"
                  onClick={() => (location.hash = "")}
                >
                  {" "}
                </button>
              </div>

              <Ticket
                booking={upcoming}
                onCancel={() => cancel(upcoming)}
                onReschedule={() => reschedule(upcoming)}
                disabled={
                  new Date(upcoming.starts_at) - Date.now() < 14400000
                }
              />
            </section>
          )}

          <section className="section">
            <div className="section-title">
              <div>
                <div className="eyebrow">YOUR TRACKS</div>
                <h2>Track progress</h2>
              </div>

              <span className="muted">
                {tracks.length} enrolled tracks
              </span>
            </div>

            <div className="cards-grid">
              {tracks.map((t) => (
                <JourneyCard
                  key={t.track_id}
                  track={t}
                  onBook={() => {}}
                />
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section-title">
              <h2>Recent notifications</h2>
              <span className="muted">Latest updates</span>
            </div>

            <div className="card notice-list">
              {notifications.length ? (
                notifications.slice(0, 4).map((n) => (
                  <div className="notice" key={n.id}>
                    <span className="notice-icon">✦</span>
                    <div>
                      <b>{n.title}</b>
                      <p>{n.body}</p>
                      <small>{ist(n.created_at)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No notifications yet.</p>
              )}
            </div>
          </section>
        </>
      )}

      {page === "Book Interview" && (
        <div className="card booking-panel">
          <div className="row between">
            <div>
              <div className="eyebrow">STEP 01 · CHOOSE TRACK</div>
              <h2>Find your interview slot</h2>
              <p className="muted">
                Choose a track, then select a 30-minute time that works for
                you.
              </p>
            </div>

            <div className="round-icon">⌁</div>
          </div>

          <label className="field-label">
            Track
            <select
              value={track}
              onChange={(e) => {
                setTrack(e.target.value);
                setSelected("");
                setSelectedSlotId("");
                setDay("");
              }}
            >
              {tracks.map((t) => (
                <option value={t.track_id} key={t.track_id}>
                  {t.track_name} · {t.journey_state}
                </option>
              ))}
            </select>
          </label>

          {tracks.find((t) => String(t.track_id) === track)
            ?.journey_state !== "READY_TO_BOOK" ? (
            <div className="callout">
              This track is not eligible for interview booking yet. You must
              clear every required skill and have no active malpractice hold,
              existing badge, or retake cooldown. Your current status is{" "}
              <b>
                {(
                  tracks.find((t) => String(t.track_id) === track)
                    ?.journey_state || "UNKNOWN"
                ).replaceAll("_", " ")}
              </b>
              .
            </div>
          ) : (
            <>
              <div className="eyebrow gap-top">
                STEP 02 · SELECT A TIME
              </div>

              {slotsLoading && (
                <LoadingState message="Finding available interview slots…" />
              )}

              {slotsError && (
                <ErrorState
                  message={slotsError}
                  onRetry={() => {
                    setSlotsError("");
                    setSlotsLoading(true);

                    get(
                      `/api/students/${studentId}/slots?track_id=${track}`
                    )
                      .then((d) => setSlots(d.slots || []))
                      .catch((e) => setSlotsError(e.message))
                      .finally(() => setSlotsLoading(false));
                  }}
                />
              )}

              {!slotsLoading && !slotsError && (
                <>
                  <div className="day-strip">
                    {Object.keys(grouped).map((d) => (
                      <button
                        className={activeDay === d ? "day active" : "day"}
                        key={d}
                        onClick={() => {
                          setDay(d);
                          setSelected("");
                          setSelectedSlotId("");
                        }}
                      >
                        <small>
                          {new Date(d + "T12:00:00").toLocaleDateString(
                            "en-IN",
                            { weekday: "short" }
                          )}
                        </small>

                        <b>
                          {new Date(d + "T12:00:00").toLocaleDateString(
                            "en-IN",
                            { day: "2-digit", month: "short" }
                          )}
                        </b>
                      </button>
                    ))}
                  </div>

                  <div className="slot-grid">
                    {(grouped[activeDay] || []).map((group) => (
                      <button
                        key={group.starts_at}
                        className={
                          selected === group.starts_at
                            ? "slot selected"
                            : "slot"
                        }
                        onClick={() => {
                          setSelected(group.starts_at);
                          setSelectedSlotId("");
                        }}
                      >
                        <b>
                          {new Date(group.starts_at).toLocaleTimeString(
                            "en-IN",
                            {
                              timeZone: "Asia/Kolkata",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </b>

                        <small>
                          {group.options.length} interviewer
                          {group.options.length === 1 ? "" : "s"} available
                        </small>
                      </button>
                    ))}
                  </div>

                  {!slots.length && (
                    <div className="empty">
                      No slots are available at the moment. Please check again
                      later.
                    </div>
                  )}

                  {selectedGroup && (
                    <div className="interviewer-picker">
                      <label className="field-label">
                        STEP 03 · SELECT AN INTERVIEWER

                        <select
                          value={selectedSlotId}
                          onChange={(e) =>
                            setSelectedSlotId(e.target.value)
                          }
                        >
                          <option value="">
                            Choose an available interviewer
                          </option>

                          {selectedGroup.options.map((option) => (
                            <option value={option.id} key={option.id}>
                              {option.interviewer_name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <p className="muted">
                        Selected time: {ist(selectedGroup.starts_at)}
                      </p>
                    </div>
                  )}

                  <button
                    className="btn primary"
                    disabled={!selectedSlot || busy}
                    onClick={book}
                  >
                    {busy
                      ? "Confirming…"
                      : "Confirm interview booking →"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {page === "My Interviews" && (
        <section className="section">
          <div className="section-title">
            <div>
              <div className="eyebrow">INTERVIEW HISTORY</div>
              <h2>All your interviews</h2>
            </div>
          </div>

          {bookings.length ? (
            bookings.map((b) => (
              <div className="card history" key={b.id}>
                <div className="row between">
                  <h3>{b.track_name}</h3>
                  <State value={b.outcome || b.status} />
                </div>

                <p>
                  {ist(b.starts_at)} · {b.interviewer_name}
                </p>

                {b.feedback && (
                  <div className="feedback">
                    <b>Interviewer feedback</b>
                    <p>{b.feedback}</p>
                  </div>
                )}

                {b.status === "SCHEDULED" && (
                  <Ticket
                    booking={b}
                    onCancel={() => cancel(b)}
                    onReschedule={() => reschedule(b)}
                    disabled={
                      new Date(b.starts_at) - Date.now() < 14400000
                    }
                  />
                )}
              </div>
            ))
          ) : (
            <div className="empty">
              Your interview history will appear here.
            </div>
          )}
        </section>
      )}

      {page === "Badges" && (
        <>
          <div className="stats">
            <div className="stat-card">
              <span>TOTAL MILES</span>
              <strong>{money(student.miles)}</strong>
              <small>Challenge + bonus Miles</small>
            </div>

            <div className="stat-card">
              <span>QUALIFIER</span>
              <strong>{data.qualifier ? "YES" : "NOT YET"}</strong>
              <small>At least one active badge</small>
            </div>
          </div>

          <div className="cards-grid">
            {badges.length ? (
              badges.map((b) => (
                <div className="card badge-card" key={b.id}>
                  <div className="badge-art">✦</div>

                  <div>
                    <div className="eyebrow">GRIT TRACK BADGE</div>
                    <h3>
                      {tracks.find((t) => t.track_id === b.track_id)
                        ?.track_name || "Track badge"}
                    </h3>

                    <State value={b.status} />

                    <p className="muted">
                      {b.status === "ACTIVE"
                        ? "Credential verified and active"
                        : "Credential revoked after integrity review"}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">
                Your first badge is waiting. Clear your track interview to earn
                it.
              </div>
            )}
          </div>
        </>
      )}

      {page === "Leaderboard" && (
        <div className="card table-card">
          <div className="section-title">
            <div>
              <div className="eyebrow">GRIT COMMUNITY</div>
              <h2>Leaderboard</h2>
            </div>

            <span className="muted">Ranked by Miles</span>
          </div>

          <table>
            <thead>
              <tr>
                <th>RANK</th>
                <th>STUDENT</th>
                <th>MILES</th>
                <th>STATUS</th>
              </tr>
            </thead>

            <tbody>
              {leaderboard.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>#{p.rank}</b>
                  </td>
                  <td>
                    {p.name}
                    {p.id === student.id ? " (You)" : ""}
                  </td>
                  <td>
                    <b>{money(p.miles)}</b>
                  </td>
                  <td>
                    {p.rank === 1 ? "Top performer" : "Active learner"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page === "Demo scenarios" && (
        <>
          <div className="callout">
            Interactive product walkthrough. Select an outcome to preview the
            corresponding student-facing Home, Badges and Leaderboard
            experience. Real demo actions remain available in Interviewer and
            Team views.
          </div>

          <div className="scenario-tabs">
            {[
              "READY_TO_BOOK",
              "SCHEDULED",
              "PASS",
              "FAIL",
              "RETAKE_LATER",
              "BADGE_REVOKED",
            ].map((x) => (
              <button
                className={scenario === x ? "active" : ""}
                onClick={() => setScenario(x)}
                key={x}
              >
                {x.replaceAll("_", " ")}
              </button>
            ))}
          </div>

          <div className="cards-grid scenario-preview-grid">
            <div className="card scenario-preview-card">
              <div className="eyebrow">HOME · {scenario}</div>

              <h3>
                {scenario === "PASS"
                  ? "Congratulations, you did it!"
                  : scenario === "FAIL"
                    ? "A learning moment"
                    : scenario === "BADGE_REVOKED"
                      ? "Integrity review update"
                      : scenario === "SCHEDULED"
                        ? "Your interview is booked"
                        : "Your next milestone"}
              </h3>

              <p className="muted">
                {scenario === "PASS"
                  ? "Your badge is active and 500 bonus Miles have been added."
                  : scenario === "FAIL"
                    ? "Review interviewer feedback and return after the 14-day cooldown."
                    : scenario === "RETAKE_LATER"
                      ? "Your interviewer has requested another attempt at a future date."
                      : scenario === "BADGE_REVOKED"
                        ? "Your badge is revoked and the 500 bonus Miles have been removed."
                        : "Your track journey and interview status are shown here."}
              </p>

              <State value={scenario} />
            </div>

            <div className="card scenario-preview-card">
              <div className="eyebrow">BADGES</div>
              <div className="badge-art">✦</div>

              <h3>
                {scenario === "PASS"
                  ? "AI Engineering · Active"
                  : scenario === "BADGE_REVOKED"
                    ? "AI Engineering · Revoked"
                    : "No new badge yet"}
              </h3>

              <p className="muted">
                Badge status changes automatically with the recorded interview
                outcome.
              </p>
            </div>

            <div className="card scenario-preview-card">
              <div className="eyebrow">LEADERBOARD</div>

              <h3>
                {scenario === "PASS"
                  ? "+500 bonus Miles"
                  : scenario === "BADGE_REVOKED"
                    ? "−500 bonus Miles"
                    : "Miles unchanged"}
              </h3>

              <p className="muted">
                Your position updates after the badge and Miles transaction.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
