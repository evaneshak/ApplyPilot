import {
  ArrowUpRight,
  Plus,
  ArrowRight,
  CalendarDays,
  BriefcaseBusiness,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";
import { dueItems } from "./analysis";
import { analytics, stages, upcoming } from "./analytics";
export function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function ApplicationTable({ applications, onSelect }) {
  return (
    <div className="table-scroll">
      <table className="applications-table">
        <thead>
          <tr>
            <th>Company & role</th>
            <th>Location</th>
            <th>Status</th>
            <th>Match</th>
            <th>Deadline</th>
            <th aria-label="Open application" />
          </tr>
        </thead>
        <tbody>
          {applications.map((a) => (
            <tr key={a.id}>
              <td>
                <button className="role-link" onClick={() => onSelect(a.id)}>
                  <span className="company-avatar">
                    {(a.company || "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{a.position || "Untitled role"}</strong>
                    <small>{a.company}</small>
                  </span>
                </button>
              </td>
              <td>{a.location || "—"}</td>
              <td>
                <span className={"status-badge status-" + a.status}>
                  {a.status}
                </span>
              </td>
              <td>
                {a.match == null ? (
                  <span className="muted-text">Not scored</span>
                ) : (
                  <strong className="match-number">{a.match}%</strong>
                )}
              </td>
              <td>{a.deadline || "—"}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Open ${a.position} at ${a.company}`}
                  onClick={() => onSelect(a.id)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!applications.length && (
        <div className="quiet-empty">
          No applications yet. Your opportunities will appear here.
        </div>
      )}
    </div>
  );
}
function Metrics({ items }) {
  return (
    <div className="metric-grid">
      {items.map(([label, value, detail, Icon]) => (
        <div className="metric-card" key={label}>
          <div className="metric-top">
            {label}
            {Icon && <Icon size={18} />}
          </div>
          <strong>{value ?? "—"}</strong>
          <small>{detail}</small>
        </div>
      ))}
    </div>
  );
}
export function Overview({
  applications,
  onSelect,
  setView,
  upcomingItems = dueItems(applications).slice(0, 5),
}) {
  const a = analytics(applications);
  const deadlines = upcoming(applications).slice(0, 4);
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="A LITTLE PROGRESS, EVERY DAY"
        title="Your next chapter, organized."
        description="A clear view of your job search. A little more room to focus."
      >
        <button className="btn btn-primary" onClick={() => setView("add")}>
          <Plus size={18} /> Add a job
        </button>
      </PageHeading>
      <Metrics
        items={[
          [
            "Total applications",
            applications.length,
            `${a.week} added in the last 7 days`,
            BriefcaseBusiness,
          ],
          [
            "Responses",
            a.responses,
            a.responseRate == null
              ? "Start applying to track responses"
              : `${a.responseRate}% of submitted applications`,
            MessageSquare,
          ],
          [
            "Interviewing",
            a.counts.interview,
            "Opportunities moving forward",
            CalendarDays,
          ],
          [
            "Offers",
            a.counts.offer,
            "Your hard work, paying off",
            CheckCircle2,
          ],
        ]}
      />
      <div className="overview-grid">
        <section className="workspace-card pipeline-card">
          <div className="card-heading">
            <h2>Your application pipeline</h2>
            <button
              className="text-button"
              onClick={() => setView("applications")}
            >
              View all <ArrowUpRight size={15} />
            </button>
          </div>
          <p className="muted-text">Every opportunity, one step closer.</p>
          <div className="pipeline-stages">
            {stages.map((s) => (
              <div key={s}>
                <span className={"stage-dot status-" + s} />
                <strong>{a.counts[s]}</strong>
                <span>{s}</span>
                <div className="pipeline-bar">
                  <i
                    style={{
                      width: `${applications.length ? (a.counts[s] / applications.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="focus-card">
          <span className="eyebrow">MAKE YOUR NEXT MOVE</span>
          <h2>
            A great fit starts <br />
            with your story.
          </h2>
          <p>
            Keep your resume ready for the opportunities that matter to you.
          </p>
          <button onClick={() => setView("resume")}>
            Manage resumes <ArrowRight size={17} />
          </button>
        </section>
      </div>
      <div className="overview-grid">
        <section className="workspace-card">
          <div className="card-heading">
            <h2>Recent applications</h2>
            <button
              className="text-button"
              onClick={() => setView("applications")}
            >
              View all <ArrowUpRight size={15} />
            </button>
          </div>
          <ApplicationTable
            applications={applications.slice(0, 5)}
            onSelect={onSelect}
          />
          {!applications.length && (
            <button className="btn btn-ghost" onClick={() => setView("add")}>
              <Plus size={16} /> Save your first opportunity
            </button>
          )}
        </section>
        <section className="workspace-card">
          <div className="card-heading">
            <h2>Coming up</h2>
            <CalendarDays size={18} />
          </div>
          {upcomingItems.map((item) => (
            <button
              className="upcoming-item"
              key={item.id}
              onClick={() => onSelect(item.application.id)}
            >
              <CalendarDays size={18} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.application.company} ·{" "}
                  {new Date(item.date).toLocaleString()}
                </small>
                <span>{item.kind}</span>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {deadlines.map((d) => (
            <button
              className="upcoming-item"
              key={d.id}
              onClick={() => onSelect(d.id)}
            >
              <span className="date-tile">
                {d.days < 0 ? "!" : d.days}
                <small>{d.days < 0 ? "overdue" : "days"}</small>
              </span>
              <span>
                <strong>{d.company}</strong>
                <small>{d.position}</small>
                <span>Application deadline</span>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {!deadlines.length && !upcomingItems.length && (
            <div className="quiet-empty">
              <CalendarDays size={28} />
              <strong>You have a little breathing room.</strong>
              <p>
                Upcoming interviews, reminders, and job deadlines will appear
                here.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
export function Insights({ applications }) {
  const a = analytics(applications);
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="THE BIGGER PICTURE"
        title="Job search insights"
        description="Understand your activity and where your opportunities stand."
      />
      <Metrics
        items={[
          ["Added this week", a.week, "Last 7 days"],
          ["Added this month", a.month, "Current calendar month"],
          [
            "Response rate",
            a.responseRate == null ? "—" : a.responseRate + "%",
            "Interview, offer, or rejection",
          ],
          [
            "Average match",
            a.average == null ? "—" : a.average + "%",
            "Applications with a score",
          ],
        ]}
      />
      <p className="insights-note">
        Rates use current statuses as a snapshot, not a historical funnel. An
        offer counts as an interview response. Earlier stages and response dates
        are not inferred.
      </p>
      <div className="overview-grid">
        <section className="workspace-card">
          <h2>How active has your search been?</h2>
          <p className="muted-text">Applications saved by week</p>
          <div className="trend-chart">
            {a.trend.map((t) => (
              <div key={t.label}>
                <span>{t.count}</span>
                <i
                  style={{
                    height: Math.max(
                      3,
                      (t.count / Math.max(1, ...a.trend.map((t) => t.count))) *
                        150,
                    ),
                  }}
                />
                <small>{t.label}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="workspace-card">
          <h2>Where do things stand?</h2>
          {[
            ["Saved → submitted", a.conversion],
            ["Submitted → interview / offer", a.interviewRate],
            ["Interview / offer → offer", a.interviewConversion],
            ["Offer rate", a.offerRate],
            ["Rejection rate", a.rejectionRate],
          ].map(([label, value]) => (
            <div className="insight-row" key={label}>
              <span>{label}</span>
              <strong>{value == null ? "—" : value + "%"}</strong>
            </div>
          ))}
        </section>
        {[
          ["Companies", a.companies],
          ["Locations", a.locations],
          ["Employment type", a.employment],
        ].map(([title, items]) => (
          <section className="workspace-card" key={title}>
            <h2>{title}</h2>
            {items.map(([name, n]) => (
              <div className="insight-row" key={name}>
                <span>{name}</span>
                <strong>{n}</strong>
              </div>
            ))}
            {!items.length && (
              <p className="quiet-empty">
                Add applications to discover patterns.
              </p>
            )}
          </section>
        ))}
        <section className="workspace-card">
          <h2>Do stronger matches get interviews?</h2>
          <p className="muted-text">
            Interview or offer rate among submitted applications. Small samples
            are not predictive.
          </p>
          {a.matchBands.map((b) => (
            <div className="insight-row" key={b.label}>
              <span>
                {b.label} · {b.count} applications
              </span>
              <strong>{b.rate == null ? "—" : b.rate + "%"}</strong>
            </div>
          ))}
        </section>
        <section className="workspace-card">
          <h2>Time between stages</h2>
          <p className="muted-text">
            Only completed intervals with two recorded status changes are
            included.
          </p>
          {a.stageTime.map((s) => (
            <div className="insight-row" key={s.stage}>
              <span>
                {s.stage} · {s.count} intervals
              </span>
              <strong>{s.days} days</strong>
            </div>
          ))}
          {!a.stageTime.length && (
            <p className="quiet-empty">
              More recorded status changes are needed.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
