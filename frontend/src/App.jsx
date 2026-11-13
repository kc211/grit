
import React, { useEffect, useState, useCallback } from "react";
import { get } from "./lib";
import Student from "./Student";
import Staff from "./Staff";

export default function App() {
  const [meta, setMeta] = useState({
    students: [],
    interviewers: [],
    tracks: [],
  });
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [role, setRole] = useState("Student");
  const [person, setPerson] = useState("1");
  const [page, setPage] = useState("Home");
  const [toast, setToast] = useState("");
  const [refresh, setRefresh] = useState(0);

  const notify = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(""), 3600);
  }, []);

  const loadMeta = useCallback(async (signal) => {
    setMetaLoading(true);
    setMetaError("");

    try {
      const data = await get("/api/meta", { signal });
      setMeta(data);
      setPerson((current) =>
        data.students.some((s) => String(s.id) === current)
          ? current
          : String(data.students[0]?.id || "")
      );
    } catch (error) {
      if (error.name !== "AbortError") {
        setMetaError(error.message || "Unable to load application data.");
      }
    } finally {
      if (!signal?.aborted) setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadMeta(controller.signal);
    return () => controller.abort();
  }, [loadMeta]);

  const people = role === "Student" ? meta.students : meta.interviewers;

  const nav =
    role === "Student"
      ? ["Home", "Book Interview", "My Interviews", "Badges", "Leaderboard", "Demo scenarios"]
      : role === "Interviewer"
        ? ["Daily schedule", "Availability"]
        : ["Team tracker"];

  if (metaLoading) {
    return (
      <div className="app">
        <div className="loading-screen">
          <div className="loader" />
          <h2>Loading GRIT Interview Hub</h2>
          <p>Getting your dashboard ready…</p>
        </div>
      </div>
    );
  }

  if (metaError) {
    return (
      <div className="app">
        <div className="loading-screen">
          <h2>Unable to load GRIT</h2>
          <p>{metaError}</p>
          <button className="btn primary" onClick={() => loadMeta()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brandmark">G</div>
          <div>
            <b>GRIT</b>
            <small>INTERVIEW HUB</small>
          </div>
        </div>

        <div className="top-controls">
          <label>
            Role
            <select
              value={role}
              onChange={(e) => {
                const nextRole = e.target.value;
                setRole(nextRole);
                setPerson(
                  String(
                    (nextRole === "Student"
                      ? meta.students
                      : meta.interviewers)[0]?.id || ""
                  )
                );
                setPage(
                  nextRole === "Student"
                    ? "Home"
                    : nextRole === "Interviewer"
                      ? "Daily schedule"
                      : "Team tracker"
                );
              }}
            >
              <option>Student</option>
              <option>Interviewer</option>
              <option>Interview Team</option>
            </select>
          </label>

          {role !== "Interview Team" && (
            <label>
              Viewing as
              <select value={person} onChange={(e) => setPerson(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="avatar">
          {(people.find((p) => String(p.id) === person)?.name || "G")
            .split(" ")
            .map((x) => x[0])
            .join("")
            .slice(0, 2)}
        </div>
      </header>

      <div className="shell">
        <aside className="sidebar">
          <div className="side-label">WORKSPACE</div>
          {nav.map((n) => (
            <button
              className={page === n ? "nav active" : "nav"}
              key={n}
              onClick={() => setPage(n)}
            >
              <span>
                {{
                  Home: "⌂",
                  "Book Interview": "＋",
                  "My Interviews": "▤",
                  Badges: "◇",
                  Leaderboard: "♜",
                  "Demo scenarios": "◈",
                  "Daily schedule": "▦",
                  Availability: "◷",
                  "Team tracker": "☷",
                }[n]}
              </span>
              {n}
            </button>
          ))}
          <div className="side-bottom">
            <div className="live-dot" /> Demo environment <small>v1.0 · IST</small>
          </div>
        </aside>

        <main className="content">
          {role === "Student" ? (
            <Student
              key={`student-${person}`}
              studentId={person}
              page={page}
              meta={meta}
              notify={notify}
              refreshKey={refresh}
            />
          ) : (
            <Staff
              key={`staff-${role}-${person}`}
              role={role}
              personId={person}
              page={page}
              meta={meta}
              notify={notify}
              onReset={() => setRefresh((x) => x + 1)}
            />
          )}
        </main>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
