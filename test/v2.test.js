import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicIP,
  validateJobURL,
  resolveJobURL,
  extractPosting,
} from "../api/_lib/jobImport.js";
import handler from "../api/import-job.js";
import { analytics, upcoming } from "../src/features/analytics.js";
import {
  validateAnalysis,
  validateTask,
  snoozeDate,
  dueItems,
} from "../src/features/analysis.js";
test("URL validation blocks local, reserved, alternate IP encodings, credentials and ports", () => {
  for (const value of [
    "file:///etc/passwd",
    "ftp://example.com/job",
    "http://localhost/job",
    "http://127.0.0.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://10.2.3.4",
    "http://172.31.1.1",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://100.100.100.200",
    "http://198.18.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://metadata.internal",
    "http://foo.local",
    "https://user:pass@example.com",
    "https://example.com:444/job",
    "https://example.com./",
    "https://example.com/" + "x".repeat(2050),
  ])
    assert.throws(() => validateJobURL(value), value);
  assert.equal(
    validateJobURL("https://example.com/jobs/123#apply").href,
    "https://example.com/jobs/123",
  );
});
test("IP validation conservatively rejects reserved networks and all IPv6", () => {
  for (const ip of [
    "0.1.2.3",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "192.88.99.2",
    "2001:4860:4860::8888",
    "garbage",
  ])
    assert.equal(isPublicIP(ip), false, ip);
  assert.equal(isPublicIP("8.8.8.8"), true);
});
test("DNS blocks any private answer; public address returned for pinned transport", async () => {
  await assert.rejects(
    resolveJobURL("https://example.com", async () => [
      { address: "8.8.8.8" },
      { address: "127.0.0.1" },
    ]),
  );
  await assert.rejects(resolveJobURL("https://example.com", async () => []));
  assert.equal(
    (
      await resolveJobURL("https://example.com", async () => [
        { address: "8.8.8.8" },
      ])
    ).address,
    "8.8.8.8",
  );
});
test("structured JobPosting is preferred and HTML is removed", () => {
  const description =
    "Build reliable applications with the engineering team. ".repeat(5);
  const html = `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "JobPosting", title: "Engineer", description: "<p>" + description + "</p>", hiringOrganization: { name: "Example" } }] })}</script><main>Unrelated content</main>`;
  const result = extractPosting(html);
  assert.match(result, /Engineer/);
  assert.match(result, /Example/);
  assert.doesNotMatch(result, /<p>|Unrelated content/);
});
test("malformed JSON-LD falls back to main content and omits scripts", () => {
  const result = extractPosting(
    '<script type="application/ld+json">bad</script><nav>Do not include navigation</nav><main>' +
      "<p>Engineering role building services and supporting customers.</p>".repeat(
        4,
      ) +
      "<script>secret()</script></main>",
  );
  assert.match(result, /Engineering/);
  assert.doesNotMatch(result, /secret|navigation/);
  assert.throws(() => extractPosting("<p>Access denied</p>"));
});
test("URL handler provides safe fallback and rejects unsupported method", async () => {
  const res = {
    setHeader() {},
    status(v) {
      this.code = v;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
  };
  await handler({ method: "GET" }, res);
  assert.equal(res.code, 405);
  await handler({ method: "POST", body: { url: "file:///secret" } }, res);
  assert.equal(res.code, 422);
  assert.match(res.body.message, /Paste the job description/);
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});
test("analytics handles empty, null scores, future and invalid dates", () => {
  const empty = analytics([]);
  assert.equal(empty.average, null);
  assert.equal(empty.responseRate, null);
  const a = analytics(
    [
      { status: "saved", match: null, createdAt: "invalid" },
      { status: "offer", match: 80, createdAt: "2026-09-05" },
      { status: "rejected", match: 60, createdAt: "2026-09-01T12:00:00Z" },
      { status: "applied", createdAt: "2027-01-01" },
    ],
    new Date("2026-09-07T12:00:00Z"),
  );
  assert.equal(a.responseRate, 67);
  assert.equal(a.average, 70);
  assert.equal(a.week, 2);
  assert.equal(a.month, 2);
  assert.equal(a.conversion, 75);
});
test("reminders filter completed items, sort upcoming, and snooze across month boundaries", () => {
  const apps = [
    {
      id: 1,
      v2_data: {
        reminders: [
          { id: "r", date: "2026-09-08", completed: false },
          { id: "c", date: "2026-09-07", completed: true },
        ],
        interviews: [
          { id: "i", date: "2026-09-07", status: "Upcoming" },
          { id: "x", date: "2026-09-07", status: "Cancelled" },
        ],
      },
    },
  ];
  assert.deepEqual(
    dueItems(apps, new Date("2026-09-07")).map((i) => i.id),
    ["i", "r"],
  );
  assert.equal(snoozeDate("2026-09-30T12:00:00Z"), "2026-10-01T12:00:00.000Z");
  assert.throws(() => snoozeDate("bad"));
  assert.equal(
    upcoming(
      [{ deadline: "invalid" }, { deadline: "2026-09-08", status: "offer" }],
      new Date("2026-09-07"),
    ).length,
    0,
  );
});
test("advanced match schema validates evidence categories and scores", () => {
  const valid = {
    overall: 80,
    scores: { Skills: 80, Education: null },
    strengths: ["React"],
    gaps: [{ item: "AWS", kind: "not mentioned" }],
    reason: "React supported",
    nextAction: "Emphasize real React projects",
  };
  assert.ok(validateAnalysis(valid));
  for (const patch of [
    { overall: 101 },
    { scores: { Skills: "80" } },
    { gaps: [{ item: "AWS", kind: "you cannot use AWS" }] },
    { strengths: [{}] },
  ])
    assert.equal(validateAnalysis({ ...valid, ...patch }), false);
});
test("tailoring rejects source quotes absent from resume", () => {
  const suggestion = {
    original: "Built an API.",
    suggested: "Developed an API.",
    why: "Clearer wording",
  };
  assert.ok(
    validateTask("tailoring", { suggestions: [suggestion] }, "Built an API."),
  );
  assert.equal(
    validateTask("tailoring", { suggestions: [suggestion] }, "Other text"),
    false,
  );
  assert.equal(
    validateTask(
      "tailoring",
      { suggestions: [{ ...suggestion, original: "" }] },
      "Other text",
    ),
    false,
  );
});
test("history-derived follow-ups never guess application submission dates", () => {
  const now = new Date("2026-09-20");
  assert.equal(
    dueItems([{ id: 1, status: "applied", createdAt: "2026-09-01" }], now)
      .length,
    0,
  );
  const app = {
    id: 1,
    status: "applied",
    v2_data: {
      events: [
        {
          title: "Status changed to applied",
          type: "status_changed",
          status: "applied",
          at: "2026-09-01",
        },
      ],
    },
  };
  assert.equal(dueItems([app], now)[0].title, "Consider following up");
  app.v2_data.reminders = [
    { type: "Follow up", date: "2026-09-10", completed: true },
  ];
  assert.equal(dueItems([app], now).length, 0);
});
test("stage duration uses only complete recorded intervals", () => {
  const a = analytics([
    {
      status: "offer",
      v2_data: {
        events: [
          {
            title: "Status changed to applied",
            type: "status_changed",
            status: "applied",
            at: "2026-09-01",
          },
          {
            title: "Status changed to interview",
            type: "status_changed",
            status: "interview",
            at: "2026-09-04",
          },
          {
            title: "Status changed to offer",
            type: "status_changed",
            status: "offer",
            at: "2026-09-10",
          },
        ],
      },
    },
  ]);
  assert.deepEqual(a.stageTime, [
    { stage: "applied", days: 3, count: 1 },
    { stage: "interview", days: 6, count: 1 },
  ]);
});
