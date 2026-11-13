
import React, { useEffect, useState } from "react";
import { get, post, ist } from "./lib";

export default function Staff({
  role,
  personId,
  page,
  meta,
  notify,
  onReset,
}) {
  const [items, setItems] = useState([]);
  const [slots, setSlots] = useState([]);

  const [day, setDay] = useState(
    new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    })
  );

  const [from, setFrom] = useState(day);
  const [tab, setTab] = useState("NOT_BOOKED");
  const [search, setSearch] = useState("");
  const [forms, setForms] = useState({});
  const [slotForm, setSlotForm] = useState({
    day,
    start: "10:00",
    end: "10:30",
  });
  const [withdrawReason, setWithdrawReason] =
    useState("Schedule change");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Load only the data required by the current page.
  const load = async (signal) => {
    setLoading(true);
    setLoadError("");

    try {
      if (role === "Interviewer" && page === "Daily schedule") {
        const d = await get(
          `/api/interviewers/${personId}/schedule?day=${day}`,
          { signal }
        );

        if (!signal?.aborted) {
          setItems(d.bookings || []);
        }
      } else if (
        role === "Interviewer" &&
        page === "Availability"
      ) {
        const d = await get(
          `/api/interviewers/${personId}/slots?from=${from}`,
          { signal }
        );

        if (!signal?.aborted) {
          setSlots(d.slots || []);
        }
      } else if (role === "Interview Team") {
        const d = await get("/api/team/tracker", { signal });

        if (!signal?.aborted) {
          setItems(d.items || []);
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setLoadError(e.message || "Unable to load data.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();

    load(controller.signal);

    return () => controller.abort();
  }, [role, personId, page, day, from]);

  // Save interview outcome.
  async function saveOutcome(id) {
    const f = forms[id] || {
      outcome: "PASS",
      feedback: "",
      retake_after: "",
    };

    try {
      await post(`/api/bookings/${id}/outcome`, {
        ...f,
        retake_after: f.retake_after || null,
      });

      notify("Interview outcome recorded.");
      load();
    } catch (e) {
      notify(e.message);
    }
  }

  // Add interviewer availability.
  async function addSlot() {
    try {
      await post(
        `/api/interviewers/${personId}/slots`,
        slotForm
      );

      notify("Availability added.");
      load();
    } catch (e) {
      notify(e.message);
    }
  }

  // Withdraw an availability slot.
  async function withdraw(id) {
    if (!confirm("Withdraw this availability slot?")) return;

    try {
      await post(`/api/slots/${id}/withdraw`, {
        reason: withdrawReason,
      });

      notify("Availability withdrawn.");
      load();
    } catch (e) {
      notify(e.message);
    }
  }

  // Flag malpractice.
  async function flag(x) {
    const reason = prompt(
      "Describe the malpractice concern:"
    );

    if (!reason) return;

    try {
      await post("/api/team/flag", {
        student_id: x.student_id,
        track_id: x.track_id,
        reason,
      });

      notify("Malpractice flag recorded.");
      load();
    } catch (e) {
      notify(e.message);
    }
  }

  // Send student reminder.
  async function reminder(x) {
    try {
      await post("/api/team/reminder", {
        student_id: x.student_id,
        message: `You are eligible to book your ${x.track_name} interview. Sign in to your GRIT dashboard to choose a slot.`,
      });

      notify("Dashboard reminder sent.");
    } catch (e) {
      notify(e.message);
    }
  }

  const tabs = [
    "NOT_BOOKED",
    "BOOKED",
    "RESULT_PENDING",
    "WAITING",
    "PASSED",
    "FLAGGED",
  ];

  const filtered = items.filter(
    (x) =>
      (role === "Interview Team" ? x.tab === tab : true) &&
      `${x.student_name || ""} ${x.track_name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            GRIT OPERATIONS / {role.toUpperCase()}
          </div>

          <h1>
            {role === "Interviewer"
              ? page === "Availability"
                ? "Manage availability"
                : "Your daily schedule"
              : "Interview team tracker"}
          </h1>

          <p className="muted">
            {role === "Interviewer"
              ? "Manage interviews, availability and outcomes."
              : "Monitor eligible students and keep every track moving."}
          </p>
        </div>

        <div className="date-pill">
          ◷ &nbsp; India Standard Time
        </div>
      </div>

      {loading && (
        <div className="loading-state">
          <div className="loader" />
          <p>Loading data...</p>
        </div>
      )}

      {loadError && !loading && (
        <div className="error-state">
          <p>{loadError}</p>
          <button
            className="btn primary"
            onClick={() => load()}
          >
            Retry
          </button>
        </div>
      )}

      {/* INTERVIEWER DAILY SCHEDULE */}
      {role === "Interviewer" &&
        page === "Daily schedule" &&
        !loading &&
        !loadError && (
          <>
            <div className="toolbar">
              <label className="field-label">
                Schedule date
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>

              <span className="muted">
                {items.length} scheduled interviews
              </span>
            </div>

            <div className="timeline">
              {items.length ? (
                items.map((b) => (
                  <div className="timeline-item" key={b.id}>
                    <div className="time">
                      {new Date(b.starts_at).toLocaleTimeString(
                        "en-IN",
                        {
                          timeZone: "Asia/Kolkata",
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </div>

                    <div className="timeline-line">
                      <i />
                    </div>

                    <div
                      className={`card interview-card ${
                        !b.outcome ? "needs-result" : ""
                      }`}
                    >
                      <div className="row between">
                        <div>
                          <div className="eyebrow">
                            {b.track_name}
                          </div>
                          <h3>{b.student_name}</h3>
                        </div>

                        <span
                          className={
                            !b.outcome
                              ? "state state-pending"
                              : "state state-passed"
                          }
                        >
                          {b.outcome || "NEEDS RESULT"}
                        </span>
                      </div>

                      {!b.outcome ? (
                        <div className="result-form">
                          <label>
                            Outcome
                            <select
                              value={
                                forms[b.id]?.outcome || "PASS"
                              }
                              onChange={(e) =>
                                setForms({
                                  ...forms,
                                  [b.id]: {
                                    ...forms[b.id],
                                    outcome: e.target.value,
                                  },
                                })
                              }
                            >
                              <option>PASS</option>
                              <option>FAIL</option>
                              <option>RETAKE_LATER</option>
                              <option>NO_SHOW</option>
                            </select>
                          </label>

                          <label>
                            Feedback
                            <textarea
                              placeholder="Share specific, constructive feedback…"
                              value={
                                forms[b.id]?.feedback || ""
                              }
                              onChange={(e) =>
                                setForms({
                                  ...forms,
                                  [b.id]: {
                                    ...forms[b.id],
                                    feedback: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>

                          {["FAIL", "RETAKE_LATER"].includes(
                            forms[b.id]?.outcome || "PASS"
                          ) && (
                            <label>
                              Retake date
                              <input
                                type="date"
                                value={
                                  forms[b.id]?.retake_after || ""
                                }
                                onChange={(e) =>
                                  setForms({
                                    ...forms,
                                    [b.id]: {
                                      ...forms[b.id],
                                      retake_after: e.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          )}

                          <button
                            className="btn primary"
                            onClick={() => saveOutcome(b.id)}
                          >
                            Save outcome
                          </button>

                          <small className="muted">
                            Demo mode allows recording results
                            before the interview starts.
                          </small>
                        </div>
                      ) : (
                        <p className="muted">
                          {b.feedback || "No feedback added."}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  No interviews scheduled for this date.
                </div>
              )}
            </div>
          </>
        )}

      {/* INTERVIEWER AVAILABILITY */}
      {role === "Interviewer" &&
        page === "Availability" &&
        !loading &&
        !loadError && (
          <>
            <div className="card booking-panel">
              <div className="eyebrow">ADD TIME WINDOW</div>
              <h2>Publish interview availability</h2>

              <div className="form-grid">
                <label>
                  Date
                  <input
                    type="date"
                    value={slotForm.day}
                    onChange={(e) =>
                      setSlotForm({
                        ...slotForm,
                        day: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Start time
                  <input
                    type="time"
                    value={slotForm.start}
                    onChange={(e) =>
                      setSlotForm({
                        ...slotForm,
                        start: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  End time
                  <input
                    type="time"
                    value={slotForm.end}
                    onChange={(e) =>
                      setSlotForm({
                        ...slotForm,
                        end: e.target.value,
                      })
                    }
                  />
                </label>
              </div>

              <p className="muted">
                Each availability entry is one 30-minute interview
                slot. Overlapping entries are rejected.
              </p>

              <button
                className="btn primary"
                onClick={addSlot}
              >
                ＋ Add availability
              </button>
            </div>

            <div className="section-title">
              <h2>Your next 7 days</h2>

              <label>
                From{" "}
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
            </div>

            <div className="card">
              {slots.map((s) => (
                <div className="notice" key={s.id}>
                  <span className="notice-icon">◷</span>

                  <div className="grow">
                    <b>{ist(s.starts_at)}</b>
                    <p>
                      {s.booked
                        ? "Booked"
                        : s.status === "OPEN"
                        ? "Available"
                        : "Withdrawn"}
                    </p>
                  </div>

                  {s.status === "OPEN" && !s.booked && (
                    <button
                      className="btn light"
                      onClick={() => withdraw(s.id)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              ))}

              {!slots.length && (
                <div className="empty">
                  No availability published for this week.
                </div>
              )}
            </div>
          </>
        )}

      {/* INTERVIEW TEAM TRACKER */}
      {role === "Interview Team" &&
        !loading &&
        !loadError && (
          <>
            <div className="stats">
              <div className="stat-card">
                <span>ELIGIBLE · NOT BOOKED</span>
                <strong>
                  {
                    items.filter(
                      (x) => x.tab === "NOT_BOOKED"
                    ).length
                  }
                </strong>
                <small>Students to follow up</small>
              </div>

              <div className="stat-card">
                <span>BOOKED / PENDING</span>
                <strong>
                  {
                    items.filter((x) =>
                      ["BOOKED", "RESULT_PENDING"].includes(
                        x.tab
                      )
                    ).length
                  }
                </strong>
                <small>Interviews in progress</small>
              </div>

              <div className="stat-card">
                <span>PASSED</span>
                <strong>
                  {
                    items.filter((x) => x.tab === "PASSED")
                      .length
                  }
                </strong>
                <small>Active track badges</small>
              </div>
            </div>

            <div className="toolbar">
              <input
                className="search"
                placeholder="Search students or tracks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <button
                className="btn light"
                onClick={async () => {
                  if (confirm("Reset all demo activity?")) {
                    try {
                      await post("/api/team/reset");

                      notify("Demo data reset.");
                      load();
                      onReset();
                    } catch (e) {
                      notify(e.message);
                    }
                  }
                }}
              >
                Reset demo data
              </button>
            </div>

            <div className="tabs">
              {tabs.map((t) => (
                <button
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                  key={t}
                >
                  {t.replaceAll("_", " ")}{" "}
                  <b>
                    {
                      items.filter((x) => x.tab === t).length
                    }
                  </b>
                </button>
              ))}
            </div>

            <div className="card table-card">
              <table>
                <thead>
                  <tr>
                    <th>STUDENT</th>
                    <th>TRACK / SKILLS</th>
                    <th>BOOKING / RESULT</th>
                    <th>ACTION</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((x) => (
                    <tr
                      key={`${x.student_id}-${x.track_id}`}
                    >
                      <td>
                        <b>{x.student_name}</b>
                        <small>
                          {x.student_id} · {x.student_email}
                        </small>
                      </td>

                      <td>
                        {x.track_name}
                        <small>
                          {x.cleared_skills}/{x.total_skills}{" "}
                          skills cleared
                        </small>
                      </td>

                      <td>
                        {x.starts_at
                          ? ist(x.starts_at)
                          : "Not booked"}

                        <small>
                          {x.outcome ||
                            x.booking_status ||
                            x.tab}
                        </small>

                        {x.interviewer_name && (
                          <small>{x.interviewer_name}</small>
                        )}
                      </td>

                      <td>
                        <div className="action-stack">
                          {x.tab === "NOT_BOOKED" && (
                            <button
                              className="btn light small"
                              onClick={() => reminder(x)}
                            >
                              Send reminder
                            </button>
                          )}

                          {x.tab !== "FLAGGED" && (
                            <button
                              className="btn danger small"
                              onClick={() => flag(x)}
                            >
                              Flag malpractice
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!filtered.length && (
                <div className="empty">
                  No students in this tab.
                </div>
              )}
            </div>
          </>
        )}
    </>
  );
}
