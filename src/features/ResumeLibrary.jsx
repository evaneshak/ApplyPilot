import { useState } from "react";
import { Plus, FileText, Copy, Trash2 } from "lucide-react";
import { PageHeading } from "./Workspace";
import { extractPdfText, MAX_PDF_SIZE_BYTES } from "../pdfText";
export function ResumeSelector({
  library,
  value,
  onChange,
  disabled = false,
  allowNone = false,
}) {
  return (
    <label className="field">
      <span className="mini-label">Use resume</span>
      <select
        className="input"
        disabled={disabled}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowNone && <option value="">No resume selected</option>}
        {!library.profiles.length && (
          <option value="">Add a resume to enable matching</option>
        )}
        {library.profiles.map((p) => (
          <option value={p.id} key={p.id}>
            {p.title}
            {p.is_default ? " · Default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
export default function ResumeLibrary({
  library,
  applications,
  pushToast,
  legacyEditor,
  onRecalculate,
  recalculating,
}) {
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  async function act(fn) {
    setBusy(true);
    try {
      return await fn();
    } catch {
      pushToast("Couldn’t complete that action. Please try again.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function importPdf(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_PDF_SIZE_BYTES) {
      pushToast("This PDF is too large.", "error");
      return;
    }
    setBusy(true);
    try {
      const text = await extractPdfText(f);
      if (text.trim().length < 20 || text.length > 100000)
        throw new Error("No usable text or too long");
      setEditor((v) => ({ ...v, text }));
      pushToast("PDF imported. Review and save your resume.", "success");
    } catch {
      pushToast(
        "Couldn’t read this PDF. Try a text-based PDF or paste your resume.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!library.ready)
    return (
      <>
        <p className="insights-note">
          Your primary resume is available below. Resume versions are
          temporarily unavailable.
        </p>
        {legacyEditor}
      </>
    );
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="TELL YOUR STORY"
        title="Your resumes"
        description="Keep a version for every direction you want to take."
      >
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            setEditor({ title: "Untitled Resume", text: "", notes: "" })
          }
        >
          <Plus size={17} /> Add resume
        </button>
      </PageHeading>
      <div className="row-actions resume-bulk">
        <button
          className="btn btn-ghost"
          disabled={busy || recalculating || !applications.length}
          onClick={onRecalculate}
        >
          {recalculating
            ? "Recalculating…"
            : "Recalculate all application matches"}
        </button>
        <span className="muted-text">
          Uses each application’s selected resume.
        </span>
      </div>
      {editor ? (
        <form
          className="workspace-card resume-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => library.save(editor))) setEditor(null);
          }}
        >
          <label className="field">
            <span className="mini-label">Resume name</span>
            <input
              className="input"
              required
              maxLength={120}
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="mini-label">Resume content</span>
            <textarea
              className="textarea"
              rows={18}
              maxLength={100000}
              value={editor.text}
              onChange={(e) => setEditor({ ...editor, text: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="mini-label">Notes</span>
            <textarea
              className="textarea"
              maxLength={5000}
              rows={2}
              value={editor.notes || ""}
              onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="mini-label">
              Import PDF (replaces this draft’s text)
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={importPdf}
            />
          </label>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save resume"}
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
      ) : (
        <div className="resume-grid">
          {library.profiles.map((p) => {
            const uses = applications.filter(
              (a) => a.resume_id === p.id,
            ).length;
            return (
              <section className="workspace-card" key={p.id}>
                <FileText size={26} color="var(--accent)" />
                <div className="card-heading">
                  <h2>{p.title}</h2>
                  {p.is_default && (
                    <span className="status-badge status-offer">Default</span>
                  )}
                </div>
                <p className="muted-text">
                  Updated {new Date(p.updated_at).toLocaleDateString()} · {uses}{" "}
                  applications
                </p>
                <p className="resume-snippet">
                  {p.text.slice(0, 150) || "Ready for your experience."}
                </p>
                <div className="row-actions">
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setEditor({ ...p })}
                  >
                    Open / rename
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={`Duplicate ${p.title}`}
                    onClick={() =>
                      act(() =>
                        library.save({
                          ...p,
                          id: undefined,
                          title: p.title.slice(0, 110) + " copy",
                        }),
                      )
                    }
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy || uses > 0 || p.is_default}
                    title={
                      uses
                        ? "Reassign applications first"
                        : p.is_default
                          ? "Choose another default first"
                          : "Delete resume"
                    }
                    aria-label={`Delete ${p.title}`}
                    onClick={() => setConfirm(p.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {!p.is_default && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => act(() => library.makeDefault(p.id))}
                  >
                    Make default
                  </button>
                )}
                {confirm === p.id && (
                  <div role="alert">
                    <p>Delete this resume permanently?</p>
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={async () => {
                        if (await act(() => library.remove(p.id)))
                          setConfirm(null);
                      }}
                    >
                      Delete
                    </button>{" "}
                    <button
                      className="btn btn-ghost"
                      onClick={() => setConfirm(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </section>
            );
          })}
          {!library.profiles.length && (
            <p className="quiet-empty">
              Add your first resume to start matching opportunities.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
