import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Plane, Radar, CheckCircle2, Plus, Sparkles,
  Loader2, Trash2, RefreshCw, FileText, MapPin,
  DollarSign, CalendarClock, ArrowLeft, AlertCircle, Wand2
} from "lucide-react";
import { supabase } from "./supabase";

/* ---------------------------------------------------------------
   ApplyPilot — mission control for a job search.
   Visual concept: a night cockpit panel. Each application is a
   "flight strip" — the paper strips air-traffic controllers use to
   track a flight through clearance stages — moving left to right
   through Saved -> Applied -> Interview -> Offer / Rejected.
------------------------------------------------------------------*/

const STATUS_ORDER = ["saved", "applied", "interview", "offer", "rejected"];
const STATUS_META = {
  saved: { label: "Saved", color: "#8CA0BF" },
  applied: { label: "Applied", color: "#E8A33D" },
  interview: { label: "Interview", color: "#5B8DEF" },
  offer: { label: "Offer", color: "#3FA796" },
  rejected: { label: "Rejected", color: "#D9695F" },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function safeParseJSON(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

async function callGemini(system, userText) {
  const geminiUrl = import.meta.env.DEV
    ? "http://localhost:3001/api/gemini"
    : "/api/gemini";

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system,
      userText,
    }),
  });

  if (!response.ok) {
    throw new Error("Request failed (" + response.status + ")");
  }

  const data = await response.json();
  return data.text;
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const year = new Date().getFullYear();
  let d = new Date(deadline);
  if (isNaN(d.getTime())) d = new Date(deadline + ", " + year);
  if (isNaN(d.getTime())) return null;
  const diff = Math.ceil((d.setHours(23, 59, 59, 999) - Date.now()) / 86400000);
  return diff;
}

/* ---------------------------- gauge ---------------------------- */
function MatchGauge({ value, size = 46 }) {
  if (value === null || value === undefined) {
    return (
      <div
        className="gauge gauge-empty"
        style={{ width: size, height: size }}
        title="No resume on file yet"
      >
        <span>—</span>
      </div>
    );
  }
  const r = 18;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c - (pct / 100) * c;
  const color = pct >= 80 ? "var(--teal)" : pct >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" width={size} height={size}>
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span className="gauge-label" style={{ color }}>{pct}%</span>
    </div>
  );
}

/* --------------------------- toasts ----------------------------- */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = "info") => {
    const id = uid();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return [toasts, push];
}

/* ============================ APP =============================== */
export default function App() {
  const [applications, setApplications] = useState([]);
  const [resume, setResume] = useState({ text: "", updatedAt: null });
  const [view, setView] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [toasts, pushToast] = useToasts();
  const [selectedId, setSelectedId] = useState(null);

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* ---- Supabase authentication session ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);


/* ---- load applications from Supabase ---- */
useEffect(() => {
  if (!session?.user?.id) return;

  const loadSupabaseApplications = async () => {
    setLoaded(false);

    const { data, error } = await supabase
      .from("Applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase Applications load failed:", error);
      pushToast("Couldn't load applications.", "error");
      setLoaded(true);
      return;
    }

    const formatted = (data || []).map((app) => ({
      id: app.id,
      company: app.company,
      position: app.position,
      location: app.location,
      salary: app.salary,
      deadline: app.deadline,
      status: app.status,
      skills: app.skills || [],
      rawText: app.raw_text,
      match: app.match,
      have: app.have || [],
      missing: app.missing || [],
      suggestions: app.suggestions || [],
      questions: app.questions || [],
      createdAt: app.created_at,
    }));

    setApplications(formatted);
    setLoaded(true);
  };

  loadSupabaseApplications();
}, [session, pushToast]);


/* ---- load persisted resume ---- */
useEffect(() => {
  try {
    const savedResume = localStorage.getItem("resume");

    if (savedResume) {
      setResume(JSON.parse(savedResume));
    }
  } catch (e) {
    console.error("Failed to load resume:", e);
  }
}, []);

const persistApplications = useCallback(
  (next) => {
    setApplications(next);

    try {
      localStorage.setItem("applications", JSON.stringify(next));
    } catch (e) {
      console.error("Failed to save applications:", e);
      pushToast("Couldn't save — your changes may not persist.", "error");
    }
  },
  [pushToast]
);

const persistResume = useCallback(
  (next) => {
    setResume(next);

    try {
      localStorage.setItem("resume", JSON.stringify(next));
    } catch (e) {
      console.error("Failed to save resume:", e);
      pushToast("Couldn't save your resume.", "error");
      return false;
    }

    return true;
  },
  [pushToast]
);

const addApplication = useCallback(
  async (app) => {
    if (!session?.user?.id) {
      pushToast("You must be logged in to save an application.", "error");
      return;
    }

    const { data, error } = await supabase
      .from("Applications")
      .insert({
        user_id: session.user.id,
        company: app.company,
        position: app.position,
        location: app.location,
        salary: app.salary,
        deadline: app.deadline || null,
        status: "saved",
        skills: app.skills || [],
        raw_text: app.rawText || null,
        match: app.match ?? null,
        have: app.have || [],
        missing: app.missing || [],
        suggestions: app.suggestions || [],
        questions: app.questions || [],
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert failed:", error);
      pushToast("Couldn't save application.", "error");
      return;
    }

    console.log("Supabase application created:", data);

    pushToast(
      "Flight logged: " + app.company + " — " + app.position,
      "success"
    );

    setView("dashboard");
  },
  [session, pushToast]
);

const selected =
  applications.find((a) => a.id === selectedId) || null;

  /* ---- authentication gate ---- */
  if (authLoading) {
    return (
      <div className="app">
        <Style />
        <div className="loading-screen">
          <Loader2 className="spin" size={22} />
          <span>Checking flight credentials…</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app">
        <Style />
        <AuthView pushToast={pushToast} />
        <Toasts toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="app">
      <Style />
      <TopBar view={view} setView={setView} />

      <main className="main">
        {!loaded ? (
          <div className="loading-screen">
            <Loader2 className="spin" size={22} />
            <span>Tuning instruments…</span>
          </div>
        ) : view === "dashboard" ? (
          <Dashboard
            applications={applications}
            hasResume={!!resume.text}
            onSelect={setSelectedId}
            onGoAdd={() => setView("add")}
          />
        ) : view === "add" ? (
          <AddFlight
            resumeText={resume.text}
            onAdd={addApplication}
            onCancel={() => setView("dashboard")}
            pushToast={pushToast}
          />
        ) : (
          <ResumeView
            resume={resume}
            onSave={persistResume}
            pushToast={pushToast}
            onRecalculate={async () => {
              if (!resume.text) {
                pushToast("Add a resume first.", "error");
                return;
              }

              pushToast("Recalculating matches…", "info");

              const next = [];

              for (const a of applications) {
                try {
                  const raw = await callGemini(
                    MATCH_SYSTEM,
                    matchUserPrompt(a, resume.text)
                  );

                  const parsed = safeParseJSON(raw);

                  next.push(
                    parsed
                      ? {
                          ...a,
                          match: parsed.match,
                          have: parsed.have,
                          missing: parsed.missing,
                          suggestions: parsed.suggestions,
                        }
                      : a
                  );
                } catch (e) {
                  next.push(a);
                }
              }

              persistApplications(next);
              pushToast("Matches updated.", "success");
            }}
          />
        )}
      </main>

      {selected && (
        <FlightDrawer
          app={selected}
          resumeText={resume.text}
          onClose={() => setSelectedId(null)}
          onStatusChange={(s) =>
            updateApplication(selected.id, { status: s })
          }
          onDelete={() => deleteApplication(selected.id)}
          onQuestions={(q) =>
            updateApplication(selected.id, { questions: q })
          }
          pushToast={pushToast}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

function AuthView({ pushToast }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      pushToast("Enter your email and password.", "error");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        pushToast(
          "Account created. Check your email if confirmation is required.",
          "success"
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        pushToast("Welcome back.", "success");
      }
    } catch (error) {
      pushToast(error.message || "Authentication failed.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark">
            <Plane size={18} />
          </span>

          <div className="brand-text">
            <span className="brand-name">ApplyPilot</span>
            <span className="brand-tag">
              MISSION CONTROL FOR YOUR JOB SEARCH
            </span>
          </div>
        </div>

        <h1 className="auth-title">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>

        <p className="auth-sub">
          {mode === "login"
            ? "Sign in to access your applications and resume."
            : "Create an account to start tracking your job search."}
        </p>

        <form onSubmit={submit}>
          <label className="field">
            <span className="mini-label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="field auth-password">
            <span className="mini-label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading && <Loader2 className="spin" size={16} />}
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          className="auth-switch"
          type="button"
          onClick={() =>
            setMode((current) =>
              current === "login" ? "signup" : "login"
            )
          }
        >
          {mode === "login"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}




/* --------------------------- top bar ---------------------------- */
function TopBar({ view, setView }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "add", label: "Log Application" },
    { id: "resume", label: "Resume" },
  ];

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Plane size={18} />
        </span>

        <div className="brand-text">
          <span className="brand-name">ApplyPilot</span>
          <span className="brand-tag">
            MISSION CONTROL FOR YOUR JOB SEARCH
          </span>
        </div>
      </div>

      <div className="topbar-actions">
        <nav className="nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={"navbtn" + (view === t.id ? " active" : "")}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <button
          className="btn btn-ghost logout-btn"
          onClick={handleLogout}
        >
          Log out
        </button>
      </div>
    </header>
  );
}

/* --------------------------- dashboard --------------------------- */
function Dashboard({ applications, hasResume, onSelect, onGoAdd }) {
  if (applications.length === 0) {
    return (
      <div className="empty">
        <Radar size={30} />
        <h2>No flights logged yet</h2>
        <p>File your first flight plan and ApplyPilot will read the posting for you.</p>
        <button className="btn btn-primary" onClick={onGoAdd}>
          <Plus size={16} /> Log an application
        </button>
      </div>
    );
  }

  return (
    <div className="board">
      {STATUS_ORDER.map((status) => {
        const items = applications.filter((a) => a.status === status);
        const meta = STATUS_META[status];
        return (
          <div className="column" key={status}>
            <div className="column-head">
              <span className="column-dot" style={{ background: meta.color }} />
              <span className="column-title">{meta.label}</span>
              <span className="column-count">{items.length}</span>
            </div>
            <div className="column-body">
              {items.length === 0 && <div className="column-empty">No flights here</div>}
              {items.map((a) => (
                <FlightStrip key={a.id} app={a} onSelect={() => onSelect(a.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlightStrip({ app, onSelect }) {
  const meta = STATUS_META[app.status];
  const dl = daysLeft(app.deadline);
  return (
    <button className="strip" onClick={onSelect}>
      <span className="strip-tab" style={{ background: meta.color }} />
      <div className="strip-body">
        <div className="strip-row strip-row-top">
          <span className="strip-company">{app.company || "Unknown company"}</span>
          <MatchGauge value={app.match} size={34} />
        </div>
        <div className="strip-position">{app.position || "Untitled role"}</div>
        <div className="strip-row strip-meta">
          {app.location && <span className="strip-meta-item"><MapPin size={11} /> {app.location}</span>}
          {app.deadline && (
            <span className={"strip-meta-item" + (dl !== null && dl <= 5 && dl >= 0 ? " urgent" : "")}>
              <CalendarClock size={11} /> {app.deadline}{dl !== null && dl >= 0 ? " · " + dl + "d" : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* -------------------------- add flight --------------------------- */
const EXTRACT_SYSTEM =
  "You extract structured data from a job posting. Respond with ONLY a raw JSON object, no markdown fences, no commentary, no explanation. Schema: {\"company\": string|null, \"position\": string|null, \"location\": string|null, \"salary\": string|null, \"deadline\": string|null, \"skills\": string[]}. Use null for any field you cannot find. Limit skills to at most 8 short items (e.g. \"Python\", \"AWS\").";

const MATCH_SYSTEM =
  "You compare a candidate's resume against a job posting. Respond with ONLY a raw JSON object, no markdown fences, no commentary. Schema: {\"match\": number (0-100 integer), \"have\": string[] (skills/experience the resume already shows that the job wants), \"missing\": string[] (skills the job wants that the resume does not show), \"suggestions\": string[] (at most 2 short, concrete resume-wording tips, each under 25 words, written in your own words, no quotations)}.";

function matchUserPrompt(app, resumeText) {
  return "JOB SKILLS: " + (app.skills || []).join(", ") +
    "\nJOB POSITION: " + app.position + " at " + app.company +
    (app.rawText ? "\nJOB POSTING TEXT:\n" + app.rawText : "") +
    "\n\nRESUME:\n" + resumeText;
}

function AddFlight({ resumeText, onAdd, onCancel, pushToast }) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [draft, setDraft] = useState(null);

  const handleParse = async () => {
    if (!text.trim()) { pushToast("Paste a job posting first.", "error"); return; }
    setParsing(true);
    setDraft(null);
    try {
      const raw = await callGemini(EXTRACT_SYSTEM, text);
      const parsed = safeParseJSON(raw);
      if (!parsed) throw new Error("parse-failed");
      let match = null, have = [], missing = [], suggestions = [];
      if (resumeText) {
        setMatching(true);
        try {
          const mraw = await callGemini(MATCH_SYSTEM, matchUserPrompt({ ...parsed, rawText: text }, resumeText));
          const mp = safeParseJSON(mraw);
          if (mp) { match = mp.match; have = mp.have || []; missing = mp.missing || []; suggestions = mp.suggestions || []; }
        } catch (e) { /* skip match on failure */ }
        setMatching(false);
      }
      setDraft({ ...parsed, rawText: text, match, have, missing, suggestions });
    } catch (e) {
      pushToast("Couldn't read that posting. Try pasting it again.", "error");
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="panel add-flight">
      <h2 className="panel-title"><FileText size={17} /> File a flight plan</h2>
      <p className="panel-sub">Paste the job posting. ApplyPilot pulls out the company, role, location, pay, deadline, and required skills.</p>

      <textarea
        className="textarea"
        rows={9}
        placeholder="Paste the full job description here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={parsing}
      />

      <div className="row-actions">
        <button className="btn btn-primary" onClick={handleParse} disabled={parsing}>
          {parsing ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          {parsing ? (matching ? "Matching to your resume…" : "Reading posting…") : "Parse posting"}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      {draft && (
        <div className="draft fade-in">
          <div className="draft-grid">
            <Field label="Company" value={draft.company} onChange={(v) => setDraft({ ...draft, company: v })} />
            <Field label="Position" value={draft.position} onChange={(v) => setDraft({ ...draft, position: v })} />
            <LocationField
              value={draft.location}
              onChange={(v) => setDraft({ ...draft, location: v })}
            />
            <Field label="Salary" value={draft.salary} onChange={(v) => setDraft({ ...draft, salary: v })} icon={<DollarSign size={12} />} />
            <Field
              label="Deadline"
              type="date"
              value={draft.deadline}
              onChange={(v) => setDraft({ ...draft, deadline: v })}
              icon={<CalendarClock size={12} />}
            />
          </div>

          <div className="skills-block">
            <span className="mini-label">Skills wanted</span>
            <div className="chip-row">
              {(draft.skills || []).length === 0 && <span className="muted-text">None detected</span>}
              {(draft.skills || []).map((s, i) => <span className="chip" key={i}>{s}</span>)}
            </div>
          </div>

          {resumeText ? (
            <div className="match-block">
              <MatchGauge value={draft.match} size={54} />
              <div className="match-details">
                {draft.have && draft.have.length > 0 && (
                  <div className="chip-row">
                    {draft.have.map((s, i) => <span className="chip chip-have" key={i}>{s}</span>)}
                  </div>
                )}
                {draft.missing && draft.missing.length > 0 && (
                  <div className="chip-row">
                    {draft.missing.map((s, i) => <span className="chip chip-missing" key={i}>{s}</span>)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="hint"><AlertCircle size={13} /> Add a resume to see a match score for this role.</div>
          )}

          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => onAdd(draft)}>
              <Plus size={16} /> Log flight
            </button>
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, icon, type = "text" }) {
  return (
    <label className="field">
      <span className="mini-label">{icon} {label}</span>
      <input
        className="input"
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Not found"
      />
    </label>
  );
}

function LocationField({ value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  useEffect(() => {
    const query = (value || "").trim();

    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        setLoadingLocations(true);

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&featuretype=city&q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
            headers: {
              "Accept-Language": "en",
            },
          }
        );

        const data = await response.json();

        const cleaned = data.map((place) => {
          const city =
            place.address?.city ||
            place.address?.town ||
            place.address?.village ||
            place.address?.municipality ||
            place.name;

          const state = place.address?.state;
          const country = place.address?.country;

          return {
            id: place.place_id,
            label: [city, state, country].filter(Boolean).join(", "),
          };
        });

        const unique = cleaned.filter(
          (item, index, array) =>
            item.label &&
            array.findIndex((x) => x.label === item.label) === index
        );

        setSuggestions(unique);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Location search failed:", error);
        }
      } finally {
        setLoadingLocations(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  return (
    <label className="field location-field">
      <span className="mini-label">
        <MapPin size={12} /> Location
      </span>

      <div className="location-input-wrap">
        <input
          className="input"
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Start typing a city..."
          autoComplete="off"
        />

        {loadingLocations && (
          <Loader2 className="spin location-loader" size={15} />
        )}

        {suggestions.length > 0 && (
          <div className="location-dropdown">
            {suggestions.map((place) => (
              <button
                key={place.id}
                type="button"
                className="location-option"
                onClick={() => {
                  onChange(place.label);
                  setSuggestions([]);
                }}
              >
                <MapPin size={13} />
                {place.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}


/* --------------------------- resume view -------------------------- */
function ResumeView({ resume, onSave, pushToast, onRecalculate }) {
  const [text, setText] = useState(resume.text || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setText(resume.text || ""), [resume.text]);

  const save = async () => {
    setSaving(true);

    const success = await onSave({
      text,
      updatedAt: Date.now(),
    });

    setSaving(false);

    if (success !== false) {
      pushToast("Resume saved.", "success");
    }
  };

  return (
    <div className="panel">
      <h2 className="panel-title"><FileText size={17} /> Your resume</h2>
      <p className="panel-sub">Paste your resume as plain text. ApplyPilot compares it against every posting you log so you always see where you stand.</p>
      <textarea
        className="textarea"
        rows={14}
        placeholder="Paste your resume text here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving || !text.trim()}>
          {saving ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />} Save resume
        </button>
        <button className="btn btn-ghost" onClick={onRecalculate}>
          <RefreshCw size={15} /> Recalculate all matches
        </button>
      </div>
      {resume.updatedAt && (
        <p className="muted-text small">Last saved {new Date(resume.updatedAt).toLocaleString()}</p>
      )}
    </div>
  );
}

/* -------------------------- flight drawer -------------------------- */
const INTERVIEW_SYSTEM =
  "You generate likely interview questions for a job candidate. Respond with ONLY a raw JSON object, no markdown fences, no commentary. Schema: {\"questions\": string[]} containing exactly 6 concise, realistic interview questions tailored to the role and, if given, the candidate's background.";

function FlightDrawer({ app, resumeText, onClose, onStatusChange, onDelete, onQuestions, pushToast }) {
  const [genLoading, setGenLoading] = useState(false);
  const dl = daysLeft(app.deadline);

  const generateQuestions = async () => {
    setGenLoading(true);
    try {
      const prompt = "POSITION: " + app.position + " at " + app.company +
        "\nSKILLS: " + (app.skills || []).join(", ") +
        (app.rawText ? "\nJOB POSTING:\n" + app.rawText : "") +
        "\n\nCANDIDATE RESUME:\n" + (resumeText || "Not provided.");
      const raw = await callGemini(INTERVIEW_SYSTEM, prompt);
      const parsed = safeParseJSON(raw);
      if (!parsed || !parsed.questions) throw new Error("bad-response");
      onQuestions(parsed.questions);
    } catch (e) {
      pushToast("Couldn't generate questions — try again.", "error");
    } finally {
      setGenLoading(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <button className="icon-btn" onClick={onClose}><ArrowLeft size={17} /></button>
          <MatchGauge value={app.match} size={40} />
        </div>

        <h2 className="drawer-title">{app.position || "Untitled role"}</h2>
        <p className="drawer-company">{app.company || "Unknown company"}</p>

        <div className="drawer-meta">
          {app.location && <span><MapPin size={13} /> {app.location}</span>}
          {app.salary && <span><DollarSign size={13} /> {app.salary}</span>}
          {app.deadline && (
            <span className={dl !== null && dl <= 5 && dl >= 0 ? "urgent" : ""}>
              <CalendarClock size={13} /> {app.deadline}{dl !== null && dl >= 0 ? " · " + dl + " days left" : ""}
            </span>
          )}
        </div>

        <div className="stage-track">
          {STATUS_ORDER.filter((s) => s !== "rejected").map((s) => (
            <button
              key={s}
              className={"stage-pill" + (app.status === s ? " active" : "")}
              style={app.status === s ? { borderColor: STATUS_META[s].color, color: STATUS_META[s].color } : {}}
              onClick={() => onStatusChange(s)}
            >
              {STATUS_META[s].label}
            </button>
          ))}
          <button
            className={"stage-pill stage-pill-reject" + (app.status === "rejected" ? " active" : "")}
            onClick={() => onStatusChange("rejected")}
          >
            Rejected
          </button>
        </div>

        {(app.skills && app.skills.length > 0) && (
          <Section title="Skills wanted">
            <div className="chip-row">
              {app.skills.map((s, i) => <span className="chip" key={i}>{s}</span>)}
            </div>
          </Section>
        )}

        {resumeText ? (
          <>
            {(app.have && app.have.length > 0) && (
              <Section title="You already have">
                <div className="chip-row">
                  {app.have.map((s, i) => <span className="chip chip-have" key={i}>{s}</span>)}
                </div>
              </Section>
            )}
            {(app.missing && app.missing.length > 0) && (
              <Section title="Worth adding">
                <div className="chip-row">
                  {app.missing.map((s, i) => <span className="chip chip-missing" key={i}>{s}</span>)}
                </div>
              </Section>
            )}
            {(app.suggestions && app.suggestions.length > 0) && (
              <Section title="Resume tips">
                <ul className="tip-list">
                  {app.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </Section>
            )}
          </>
        ) : (
          <div className="hint"><AlertCircle size={13} /> Add a resume to unlock matching and interview prep.</div>
        )}

        <Section title="Interview prep">
          {app.questions && app.questions.length > 0 ? (
            <ol className="question-list">
              {app.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          ) : (
            <p className="muted-text">No questions generated yet.</p>
          )}
          <button className="btn btn-ghost" onClick={generateQuestions} disabled={genLoading}>
            {genLoading ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}
            {app.questions && app.questions.length > 0 ? "Regenerate questions" : "Generate questions"}
          </button>
        </Section>

        <button className="btn btn-danger" onClick={onDelete}>
          <Trash2 size={15} /> Remove this flight
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="section">
      <span className="mini-label">{title}</span>
      {children}
    </div>
  );
}

/* ----------------------------- toasts ------------------------------ */
function Toasts({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div className={"toast toast-" + t.tone} key={t.id}>
          {t.tone === "success" && <CheckCircle2 size={14} />}
          {t.tone === "error" && <AlertCircle size={14} />}
          {t.tone === "info" && <Radar size={14} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ styles ------------------------------ */
function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

      :root{
        --bg:#0F1B2E;
        --panel:#16253D;
        --panel-2:#1C3050;
        --border:#2A3F5F;
        --text:#E7EAF0;
        --muted:#8CA0BF;
        --amber:#E8A33D;
        --teal:#3FA796;
        --red:#D9695F;
        --blue:#5B8DEF;
      }

      *{box-sizing:border-box;}

      .app{
        min-height:100%;
        background:
          radial-gradient(ellipse at top left, rgba(91,141,239,0.08), transparent 55%),
          radial-gradient(ellipse at bottom right, rgba(232,163,61,0.06), transparent 55%),
          var(--bg);
        color:var(--text);
        font-family:'Inter', sans-serif;
        padding-bottom:40px;
      }

      button{font-family:inherit;}
      :focus-visible{outline:2px solid var(--amber); outline-offset:2px;}

      .loading-screen{
        display:flex;
        align-items:center;
        gap:10px;
        justify-content:center;
        padding:80px 20px;
        color:var(--muted);
        font-family:'JetBrains Mono',monospace;
        font-size:13px;
      }

      .spin{animation:spin 1s linear infinite;}
      @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

      .fade-in{animation:fadeIn .35s ease;}
      @keyframes fadeIn{
        from{opacity:0; transform:translateY(6px)}
        to{opacity:1; transform:translateY(0)}
      }

      /* topbar */
      .topbar{
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:18px 28px;
        border-bottom:1px solid var(--border);
        background:rgba(15,27,46,0.85);
        backdrop-filter:blur(6px);
        position:sticky;
        top:0;
        z-index:20;
        flex-wrap:wrap;
        gap:14px;
      }

      .brand{display:flex; align-items:center; gap:10px;}

      .brand-mark{
        width:34px;
        height:34px;
        border-radius:10px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:linear-gradient(135deg, var(--amber), #b97a24);
        color:#1a1206;
        transform:rotate(-15deg);
      }

      .brand-text{display:flex; flex-direction:column; line-height:1.15;}
      .brand-name{font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:19px; letter-spacing:.2px;}
      .brand-tag{font-family:'JetBrains Mono',monospace; font-size:9.5px; letter-spacing:1.4px; color:var(--muted);}
      .nav{display:flex; gap:6px; background:var(--panel); padding:4px; border-radius:10px; border:1px solid var(--border);}

      .topbar-actions{
        display:flex; 
        align-items:center;
        gap:10px;
      }

      .logout-btn{
        padding:8px 12px;
        white-space:nowrap;
      }




      .navbtn{
        background:transparent;
        border:none;
        color:var(--muted);
        padding:8px 14px;
        border-radius:7px;
        font-size:13px;
        font-weight:500;
        cursor:pointer;
        transition:all .15s ease;
      }

      .navbtn:hover{color:var(--text);}
      .navbtn.active{background:var(--panel-2); color:var(--amber); box-shadow:inset 0 0 0 1px var(--border);}
      .main{max-width:1180px; margin:0 auto; padding:26px 24px;}

      /* empty state */
      .empty{
        display:flex;
        flex-direction:column;
        align-items:center;
        text-align:center;
        gap:10px;
        padding:90px 20px;
        color:var(--muted);
        max-width:420px;
        margin:0 auto;
      }

      .empty h2{font-family:'Space Grotesk',sans-serif; color:var(--text); font-size:20px; margin:4px 0 0;}
      .empty p{font-size:14px; margin:0 0 8px;}

      /* board */
      .board{display:flex; gap:16px; overflow-x:auto; padding-bottom:14px;}
      .column{min-width:250px; flex:1 1 250px;}

      .column-head{
        display:flex;
        align-items:center;
        gap:8px;
        padding:0 4px 10px;
        border-bottom:1px solid var(--border);
        margin-bottom:12px;
      }

      .column-dot{width:8px; height:8px; border-radius:50%; flex:none;}
      .column-title{font-family:'JetBrains Mono',monospace; font-size:11.5px; letter-spacing:1px; text-transform:uppercase; color:var(--text);}
      .column-count{margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); background:var(--panel); padding:1px 7px; border-radius:20px; border:1px solid var(--border);}
      .column-body{display:flex; flex-direction:column; gap:10px; min-height:60px;}
      .column-empty{font-size:12px; color:var(--muted); opacity:.6; padding:10px 4px; font-style:italic;}

      /* flight strip */
      .strip{
        display:flex;
        text-align:left;
        width:100%;
        background:var(--panel);
        border:1px solid var(--border);
        border-radius:8px;
        padding:0;
        cursor:pointer;
        overflow:hidden;
        transition:transform .15s ease, border-color .15s ease;
        animation:fadeIn .3s ease;
      }

      .strip:hover{transform:translateY(-2px); border-color:var(--muted);}
      .strip-tab{width:5px; flex:none;}
      .strip-body{padding:11px 13px; flex:1; min-width:0;}
      .strip-row{display:flex; align-items:center; justify-content:space-between; gap:8px;}
      .strip-company{font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.4px; color:var(--muted); text-transform:uppercase;}
      .strip-position{font-weight:600; font-size:14.5px; margin:3px 0 8px; color:var(--text);}
      .strip-meta{gap:12px; flex-wrap:wrap;}
      .strip-meta-item{display:flex; align-items:center; gap:4px; font-size:11.5px; color:var(--muted);}
      .strip-meta-item.urgent{color:var(--red);}

      /* gauge */
      .gauge{position:relative; display:flex; align-items:center; justify-content:center; flex:none;}
      .gauge-label{position:absolute; font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:500;}
      .gauge-empty{border-radius:50%; border:2px dashed var(--border); color:var(--muted); font-family:'JetBrains Mono',monospace; font-size:11px;}

      /* panels */
      .panel{background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:26px; max-width:760px; margin:0 auto;}
      .panel-title{display:flex; align-items:center; gap:8px; font-family:'Space Grotesk',sans-serif; font-size:19px; margin:0 0 6px; color:var(--amber);}
      .panel-sub{color:var(--muted); font-size:13.5px; margin:0 0 18px; line-height:1.5;}

      .textarea, .input{
        width:100%;
        background:var(--bg);
        border:1px solid var(--border);
        border-radius:8px;
        color:var(--text);
        padding:12px 13px;
        font-family:'JetBrains Mono',monospace;
        font-size:13px;
        resize:vertical;
        line-height:1.5;
      }

      .textarea:focus, .input:focus{border-color:var(--amber);}
      .input{font-family:'Inter',sans-serif; font-size:13.5px; padding:9px 11px;}

      .row-actions{display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;}

      .btn{
        display:inline-flex;
        align-items:center;
        gap:7px;
        border-radius:8px;
        padding:10px 16px;
        font-size:13.5px;
        font-weight:600;
        cursor:pointer;
        border:1px solid transparent;
        transition:opacity .15s ease, transform .1s ease;
      }

      .btn:active{transform:scale(.98);}
      .btn:disabled{opacity:.55; cursor:not-allowed;}
      .btn-primary{background:var(--amber); color:#1a1206;}
      .btn-primary:hover:not(:disabled){opacity:.9;}
      .btn-ghost{background:transparent; border-color:var(--border); color:var(--text);}
      .btn-ghost:hover{border-color:var(--muted);}
      .btn-danger{background:transparent; border-color:var(--red); color:var(--red); margin-top:22px;}
      .btn-danger:hover{background:rgba(217,105,95,0.1);}
      .icon-btn{background:var(--panel-2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:7px; cursor:pointer;}

      .draft{margin-top:20px; padding-top:20px; border-top:1px dashed var(--border);}
      .draft-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
      .field{display:flex; flex-direction:column; gap:5px;}

      /* location autocomplete */
      .location-input-wrap{
        position:relative;
      }

      .location-loader{
        position:absolute;
        right:11px;
        top:11px;
        color:var(--muted);
      }

      .location-dropdown{
        position:absolute;
        top:calc(100% + 6px);
        left:0;
        right:0;
        z-index:40;
        background:var(--panel-2);
        border:1px solid var(--border);
        border-radius:8px;
        overflow:hidden;
        box-shadow:0 12px 30px rgba(0,0,0,0.35);
      }

      .location-option{
        width:100%;
        display:flex;
        align-items:center;
        gap:8px;
        padding:10px 11px;
        background:transparent;
        border:none;
        border-bottom:1px solid var(--border);
        color:var(--text);
        text-align:left;
        font-size:13px;
        cursor:pointer;
      }

      .location-option:last-child{
        border-bottom:none;
      }

      .location-option:hover{
        background:var(--panel);
        color:var(--amber);
      }

      .mini-label{
        display:flex;
        align-items:center;
        gap:5px;
        font-family:'JetBrains Mono',monospace;
        font-size:10.5px;
        letter-spacing:.8px;
        text-transform:uppercase;
        color:var(--muted);
      }

      .skills-block{margin-top:16px;}
      .chip-row{display:flex; flex-wrap:wrap; gap:6px; margin-top:7px;}
      .chip{background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-size:12px; padding:4px 10px; border-radius:20px;}
      .chip-have{border-color:var(--teal); color:var(--teal);}
      .chip-missing{border-color:var(--amber); color:var(--amber);}
      .match-block{display:flex; gap:16px; align-items:flex-start; margin-top:18px; padding-top:16px; border-top:1px dashed var(--border);}
      .match-details{flex:1; display:flex; flex-direction:column; gap:8px;}
      .hint{display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12.5px; margin-top:16px;}
      .muted-text{color:var(--muted); font-size:13px;}
      .muted-text.small{font-size:11.5px; margin-top:14px;}

      /* drawer */
      .drawer-overlay{
        position:fixed;
        inset:0;
        background:rgba(6,11,20,0.65);
        backdrop-filter:blur(2px);
        display:flex;
        justify-content:flex-end;
        z-index:50;
      }

      .drawer{
        width:min(440px, 100%);
        height:100%;
        background:var(--panel);
        border-left:1px solid var(--border);
        padding:24px;
        overflow-y:auto;
        animation:slideIn .25s ease;
      }

      @keyframes slideIn{
        from{transform:translateX(30px); opacity:0}
        to{transform:translateX(0); opacity:1}
      }

      .drawer-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;}
      .drawer-title{font-family:'Space Grotesk',sans-serif; font-size:21px; margin:0;}
      .drawer-company{font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin:4px 0 14px;}
      .drawer-meta{display:flex; flex-direction:column; gap:7px; font-size:13px; color:var(--muted); margin-bottom:18px;}
      .drawer-meta span{display:flex; align-items:center; gap:6px;}
      .drawer-meta .urgent{color:var(--red);}

      .stage-track{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:20px;}

      .stage-pill{
        background:transparent;
        border:1px solid var(--border);
        color:var(--muted);
        border-radius:20px;
        padding:6px 12px;
        font-size:12px;
        cursor:pointer;
        font-weight:500;
      }

      .stage-pill.active{background:var(--panel-2);}
      .stage-pill-reject.active{border-color:var(--red); color:var(--red); background:rgba(217,105,95,0.1);}

      .section{margin-bottom:18px; padding-top:16px; border-top:1px dashed var(--border);}
      .tip-list, .question-list{margin:8px 0 0; padding-left:18px; font-size:13px; line-height:1.6; color:var(--text);}
      .question-list{font-family:'Inter',sans-serif;}

      .toast-wrap{
        position:fixed;
        bottom:20px;
        right:20px;
        display:flex;
        flex-direction:column;
        gap:8px;
        z-index:80;
      }

      .toast{
        display:flex;
        align-items:center;
        gap:8px;
        background:var(--panel-2);
        border:1px solid var(--border);
        color:var(--text);
        padding:10px 14px;
        border-radius:8px;
        font-size:13px;
        animation:fadeIn .25s ease;
        max-width:300px;
      }

      .toast-success{border-color:var(--teal);}
      .toast-error{border-color:var(--red);}

      @media(max-width:640px){
        .draft-grid{grid-template-columns:1fr;}
        .topbar{padding:14px 16px;}
        .main{padding:18px 14px;}
        .panel{padding:18px;}
      }
    `}</style>
  );
}
