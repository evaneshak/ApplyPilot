import { useState } from "react";
import { CalendarDays, Bell, Sparkles, Copy } from "lucide-react";
import { callGemini, parseGeminiJson, getAIErrorMessage } from "../aiClient";
import { AI_TASKS, validateTask, snoozeDate } from "./analysis";
import { ResumeSelector } from "./ResumeLibrary";
const tabs = [
  "Overview",
  "Match Analysis",
  "Resume",
  "Interviews",
  "Prep",
  "Activity",
  "Reminders",
];
const blankItem = (kind) => ({
  id: crypto.randomUUID(),
  title: kind === "interviews" ? "Recruiter screen" : "Follow up",
  date: "",
  type: kind === "interviews" ? "Recruiter screen" : "Follow up",
  location: "",
  interviewer: "",
  interviewerTitle: "",
  notes: "",
  status: "Upcoming",
  completed: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});
function localDate(value) {
  if (!value) return "";
  const d = new Date(value);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
export default function ApplicationWorkspace({
  app,
  library,
  resumeText,
  onEdit,
  pushToast,
}) {
  const [tab, setTab] = useState("Overview");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState(app.v2_data?.answers || {});
  const [confirm, setConfirm] = useState(null);
  const data = app.v2_data || {};
  const persist = async (patch, event, extra = {}) => {
    const ok = await onEdit({
      v2_data: { ...data, ...patch, pendingEvent: event },
      v2_version: app.v2_version || 0,
      ...extra,
    });
    if (ok) pushToast("Changes saved.", "success");
    return ok;
  };
  const act = async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } catch {
      pushToast(
        "Couldn’t save changes. Reopen the application and try again.",
        "error",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const generate = async (task) => {
    if (task !== "prep" && !resumeText) {
      pushToast("Select a saved resume first.", "error");
      return;
    }
    setBusy(true);
    try {
      const raw = await callGemini(
        AI_TASKS[task],
        JSON.stringify({
          job: app.rawText,
          company: app.company,
          position: app.position,
          skills: app.skills,
          resume: resumeText,
          match: app.reason,
        }),
      );
      const result = parseGeminiJson(raw);
      if (!validateTask(task, result, resumeText))
        throw new Error(
          "The AI response could not be verified. Please try again.",
        );
      await persist(
        {
          [task]: {
            ...result,
            resumeUpdatedAt: library.profiles.find(
              (p) => p.id === app.resume_id,
            )?.updated_at,
          },
        },
        `${task === "analysis" ? "Match analysis" : task === "tailoring" ? "Resume suggestions" : "Interview preparation"} generated`,
        task === "analysis"
          ? {
              match: result.overall,
              reason: result.reason,
              have: result.strengths,
              missing: result.gaps.map((g) => `${g.item} (${g.kind})`),
            }
          : {},
      );
    } catch (error) {
      pushToast(getAIErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("Copied.", "success");
    } catch {
      pushToast(
        "Copy is unavailable. Select the text to copy manually.",
        "error",
      );
    }
  };
  const saveItem = async (e) => {
    e.preventDefault();
    const { kind, item } = editor;
    if (!item.title.trim() || !item.date) return;
    const next = { ...item, date: new Date(item.date).toISOString() };
    const items = data[kind] || [];
    const updated = items.some((i) => i.id === item.id)
      ? items.map((i) => (i.id === item.id ? next : i))
      : [...items, next];
    if (
      await act(() =>
        persist(
          { [kind]: updated },
          `${kind === "interviews" ? "Interview" : "Reminder"} saved: ${item.title}`,
        ),
      )
    )
      setEditor(null);
  };
  const editField = (key, value) =>
    setEditor({ ...editor, item: { ...editor.item, [key]: value } });
  if (!library.ready) return null;
  return (
    <div className="application-workspace">
      <div
        className="detail-tabs"
        role="navigation"
        aria-label="Application sections"
      >
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setEditor(null);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {app.source_url && /^https?:\/\//i.test(app.source_url) && (
        <a
          className="text-button"
          target="_blank"
          rel="noopener noreferrer"
          href={app.source_url}
        >
          View original posting ↗
        </a>
      )}
      {app.employment_type && (
        <p className="muted-text">{app.employment_type}</p>
      )}
      {["analysis", "tailoring", "prep"].some(
        (k) =>
          data[k] &&
          data[k].resumeUpdatedAt !==
            library.profiles.find((p) => p.id === app.resume_id)?.updated_at,
      ) && (
        <p className="insights-note">
          Your selected resume has changed since some results were generated.
          Recalculate or regenerate before relying on them.
        </p>
      )}
      {tab === "Overview" && (
        <p className="muted-text">
          Review the role below, or use the tabs to prepare your next step.
        </p>
      )}
      {tab === "Match Analysis" && (
        <section className="workspace-section">
          <div className="card-heading">
            <h3>How your resume fits</h3>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => generate("analysis")}
            >
              {busy
                ? "Analyzing…"
                : data.analysis
                  ? "Recalculate"
                  : "Analyze match"}
            </button>
          </div>
          {data.analysis ? (
            <>
              <div className="analysis-overall">
                {data.analysis.overall}% <small>overall match</small>
              </div>
              {Object.entries(data.analysis.scores)
                .filter(([, v]) => v != null)
                .map(([label, value]) => (
                  <div className="score-row" key={label}>
                    <span>{label}</span>
                    <progress max="100" value={value} />
                    <strong>{value}%</strong>
                  </div>
                ))}
              <h4>Why this score</h4>
              <p>{data.analysis.reason}</p>
              <h4>Strengths</h4>
              <ul>
                {data.analysis.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <h4>Potential gaps</h4>
              <ul>
                {data.analysis.gaps.map((g, i) => (
                  <li key={i}>
                    {g.item} <span className="muted-text">— {g.kind}</span>
                  </li>
                ))}
              </ul>
              <h4>Next action</h4>
              <p>{data.analysis.nextAction}</p>
            </>
          ) : (
            <p className="quiet-empty">
              Generate an evidence-based breakdown using this application’s
              resume. Existing match information is retained below.
            </p>
          )}
        </section>
      )}
      {tab === "Resume" && (
        <section className="workspace-section">
          <ResumeSelector
            library={library}
            allowNone
            value={app.resume_id}
            disabled={busy}
            onChange={(id) =>
              act(() =>
                persist({}, "Resume selection changed", {
                  resume_id: id || null,
                  match: null,
                  reason: "",
                  have: [],
                  missing: [],
                  suggestions: [],
                }),
              )
            }
          />
          <p className="muted-text">
            Suggestions use the selected resume. Your master resume is never
            overwritten.
          </p>
          <button
            className="btn btn-primary"
            disabled={busy || !resumeText}
            onClick={() => generate("tailoring")}
          >
            <Sparkles size={15} />
            {busy
              ? "Generating…"
              : data.tailoring
                ? "Regenerate suggestions"
                : "Tailor resume for this role"}
          </button>
          {data.tailoring?.suggestions.map((s, i) => (
            <article className="suggestion-card" key={i}>
              <h4>Original</h4>
              <blockquote>{s.original}</blockquote>
              <h4>Suggested</h4>
              <p>{s.suggested}</p>
              <p className="muted-text">{s.why}</p>
              <div className="row-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => copy(s.suggested)}
                >
                  <Copy size={14} /> Copy
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy || !!s.state}
                  onClick={() =>
                    act(async () => {
                      const draft = data.tailoredText || resumeText;
                      if (!draft.includes(s.original)) {
                        pushToast(
                          "The original text changed. Regenerate suggestions.",
                          "error",
                        );
                        return false;
                      }
                      return persist(
                        {
                          tailoredText: draft.replace(s.original, s.suggested),
                          tailoring: {
                            suggestions: data.tailoring.suggestions.map(
                              (v, j) =>
                                j === i ? { ...v, state: "Accepted" } : v,
                            ),
                          },
                        },
                        "Resume suggestion accepted into role draft",
                      );
                    })
                  }
                >
                  {s.state || "Accept into role draft"}
                </button>
                <button
                  className="text-button"
                  disabled={busy || !!s.state}
                  onClick={() =>
                    act(() =>
                      persist(
                        {
                          tailoring: {
                            suggestions: data.tailoring.suggestions.map(
                              (v, j) =>
                                j === i ? { ...v, state: "Dismissed" } : v,
                            ),
                          },
                        },
                        "Resume suggestion dismissed",
                      ),
                    )
                  }
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
          {data.tailoring?.suggestions.length === 0 && (
            <p>No grounded wording changes were suggested.</p>
          )}
          {data.tailoredText && (
            <>
              <h4>Role-specific draft</h4>
              <p className="muted-text">
                Review all claims before using this draft.
              </p>
              <textarea
                className="textarea"
                rows={10}
                readOnly
                value={data.tailoredText}
                aria-label="Role-specific resume draft"
              />
              <button
                className="btn btn-ghost"
                onClick={() => copy(data.tailoredText)}
              >
                Copy role draft
              </button>
            </>
          )}
        </section>
      )}
      {["Interviews", "Reminders"].includes(tab) &&
        (() => {
          const kind = tab.toLowerCase();
          return (
            <section className="workspace-section">
              <div className="card-heading">
                <h3>
                  {tab === "Interviews"
                    ? "Interview process"
                    : "Your reminders"}
                </h3>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setEditor({ kind, item: blankItem(kind) })}
                >
                  Add {kind === "interviews" ? "round" : "reminder"}
                </button>
              </div>
              {editor?.kind === kind && (
                <form className="item-editor" onSubmit={saveItem}>
                  <label className="field">
                    <span className="mini-label">Title</span>
                    <input
                      className="input"
                      required
                      maxLength={160}
                      value={editor.item.title}
                      onChange={(e) => editField("title", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="mini-label">
                      Date & time (
                      {Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </span>
                    <input
                      className="input"
                      type="datetime-local"
                      required
                      value={localDate(editor.item.date)}
                      onChange={(e) =>
                        editField(
                          "date",
                          e.target.value
                            ? new Date(e.target.value).toISOString()
                            : "",
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="mini-label">Type</span>
                    <select
                      className="input"
                      value={editor.item.type}
                      onChange={(e) => editField("type", e.target.value)}
                    >
                      {(kind === "interviews"
                        ? [
                            "Recruiter screen",
                            "Hiring manager",
                            "Behavioral",
                            "Technical",
                            "Coding",
                            "System design",
                            "Take-home",
                            "Onsite",
                            "Final",
                            "Custom",
                          ]
                        : [
                            "Application deadline",
                            "Follow up",
                            "Interview",
                            "Recruiter response",
                            "Custom",
                          ]
                      ).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  {kind === "interviews" && (
                    <>
                      {[
                        ["location", "Location / meeting URL"],
                        ["interviewer", "Interviewer name"],
                        ["interviewerTitle", "Interviewer title"],
                      ].map(([key, label]) => (
                        <label className="field" key={key}>
                          <span className="mini-label">{label}</span>
                          <input
                            className="input"
                            maxLength={500}
                            value={editor.item[key]}
                            onChange={(e) => editField(key, e.target.value)}
                          />
                        </label>
                      ))}
                      <label className="field">
                        <span className="mini-label">Status</span>
                        <select
                          className="input"
                          value={editor.item.status}
                          onChange={(e) => editField("status", e.target.value)}
                        >
                          {["Upcoming", "Completed", "Cancelled"].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label className="field">
                    <span className="mini-label">Notes</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      maxLength={5000}
                      value={editor.item.notes}
                      onChange={(e) => editField("notes", e.target.value)}
                    />
                  </label>
                  <div className="row-actions">
                    <button className="btn btn-primary" disabled={busy}>
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => setEditor(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {(data[kind] || [])
                .slice()
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map((item) => (
                  <article className="suggestion-card" key={item.id}>
                    <div className="card-heading">
                      <h4>{item.title}</h4>
                      <span className="status-badge">
                        {kind === "interviews"
                          ? item.status
                          : item.completed
                            ? "Completed"
                            : "Upcoming"}
                      </span>
                    </div>
                    <p>
                      {new Date(item.date).toLocaleString()}{" "}
                      <small>
                        ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                      </small>
                    </p>
                    <p>
                      {item.type}
                      {item.interviewer
                        ? ` · ${item.interviewer} ${item.interviewerTitle || ""}`
                        : ""}
                    </p>
                    {item.location &&
                      (/^https?:\/\//i.test(item.location) ? (
                        <a
                          href={item.location}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Join meeting ↗
                        </a>
                      ) : (
                        <p>{item.location}</p>
                      ))}
                    <p className="preserve-lines">{item.notes}</p>
                    <div className="row-actions">
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => setEditor({ kind, item: { ...item } })}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={
                          busy || item.completed || item.status === "Completed"
                        }
                        onClick={() =>
                          act(() =>
                            persist(
                              {
                                [kind]: data[kind].map((i) =>
                                  i.id === item.id
                                    ? {
                                        ...i,
                                        completed: true,
                                        status: "Completed",
                                      }
                                    : i,
                                ),
                              },
                              `${kind === "interviews" ? "Interview" : "Reminder"} completed: ${item.title}`,
                            ),
                          )
                        }
                      >
                        Complete
                      </button>
                      {kind === "reminders" && !item.completed && (
                        <button
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              persist(
                                {
                                  [kind]: data[kind].map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          date: snoozeDate(
                                            new Date(
                                              Math.max(
                                                Date.now(),
                                                new Date(i.date).getTime(),
                                              ),
                                            ).toISOString(),
                                          ),
                                        }
                                      : i,
                                  ),
                                },
                                "Reminder snoozed one day",
                              ),
                            )
                          }
                        >
                          Snooze 1 day
                        </button>
                      )}
                      {kind === "interviews" && (
                        <button
                          className="text-button"
                          onClick={() => setTab("Prep")}
                        >
                          Prepare
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setConfirm(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                    {confirm === item.id && (
                      <div role="alert">
                        Delete this item?{" "}
                        <button
                          className="btn btn-danger"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              persist(
                                {
                                  [kind]: data[kind].filter(
                                    (i) => i.id !== item.id,
                                  ),
                                },
                                `${item.title} deleted`,
                              ),
                            )
                          }
                        >
                          Delete
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setConfirm(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              {!data[kind]?.length && !editor && (
                <p className="quiet-empty">
                  {kind === "interviews" ? <CalendarDays /> : <Bell />}No {kind}{" "}
                  yet. Add one to keep your next step in view.
                </p>
              )}
            </section>
          );
        })()}
      {tab === "Prep" && (
        <section className="workspace-section">
          <h3>Company & interview prep</h3>
          <p className="muted-text">
            Based on the job posting and your resume. This is AI-generated
            preparation, not live company research.
          </p>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => generate("prep")}
          >
            {busy
              ? "Preparing…"
              : data.prep
                ? "Regenerate preparation"
                : "Generate preparation"}
          </button>
          {data.prep &&
            Object.entries({
              priorities: "What the role appears to prioritize",
              themes: "Likely interview themes",
              technicalTopics: "Technical topics to review",
              stories: "STAR stories to prepare",
              questions: "Questions to ask",
              concerns: "Potential concerns",
            }).map(([key, label]) => (
              <div key={key}>
                <h4>{label}</h4>
                {data.prep[key].map((q, i) => (
                  <div className="prep-prompt" key={i}>
                    <p>{q}</p>
                    {key === "stories" && (
                      <label className="field">
                        <span className="mini-label">Your answer</span>
                        <textarea
                          className="textarea"
                          rows={3}
                          maxLength={10000}
                          value={answers[q] || ""}
                          onChange={(e) =>
                            setAnswers({ ...answers, [q]: e.target.value })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            ))}
          {data.prep && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                act(() =>
                  persist({ answers }, "Interview preparation answers saved"),
                )
              }
            >
              Save answers
            </button>
          )}
        </section>
      )}
      {tab === "Activity" && (
        <section className="workspace-section">
          <h3>Activity timeline</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (note.trim() && (await act(() => persist({}, note.trim()))))
                setNote("");
            }}
          >
            <label className="field">
              <span className="mini-label">Add a note</span>
              <textarea
                className="textarea"
                maxLength={5000}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </label>
            <button className="btn btn-primary" disabled={busy || !note.trim()}>
              Save note
            </button>
          </form>
          <ol className="timeline">
            {(data.events || [])
              .slice()
              .reverse()
              .map((event, i) => (
                <li key={event.id || i}>
                  <span>{event.title}</span>
                  <small>{new Date(event.at).toLocaleString()}</small>
                </li>
              ))}
          </ol>
          {!data.events?.length && (
            <p className="muted-text">
              New activity is recorded from the workspace upgrade onward.
              Earlier history is not reconstructed.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
