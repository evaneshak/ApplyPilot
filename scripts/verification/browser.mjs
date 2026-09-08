import { createRequire } from "node:module";
import path from "node:path";
const requireQA = createRequire(
  path.resolve(process.env.APPLYPILOT_QA_MODULES || ".", "package.json"),
);
const { chromium } = requireQA("playwright");
import fs from "node:fs";
const outputDir =
  process.env.APPLYPILOT_QA_OUTPUT || "/private/tmp/applypilot-qa";
const env = fs.readFileSync(path.resolve(".env.local"), "utf8");
const base = env.match(/^VITE_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m)[1];
const project = new URL(base).hostname.split(".")[0];
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "alex@example.test",
  aud: "authenticated",
  role: "authenticated",
};
let apps = ["Northstar", "Arc Studio", "Fieldwork", "Forma", "Bloom"].map(
  (company, i) => ({
    id: String(i + 1),
    user_id: user.id,
    company,
    position: [
      "Product Engineer",
      "Frontend Engineer",
      "Software Engineer",
      "Design Engineer",
      "Full Stack Engineer",
    ][i],
    location: i % 2 ? "Hybrid — New York" : "Remote",
    status: ["saved", "applied", "interview", "offer", "rejected"][i],
    match: 84 - i * 4,
    salary: "$120,000 – $160,000",
    deadline: "2026-09-15",
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
    skills: ["React", "TypeScript"],
    raw_text: "Build reliable applications with React and TypeScript.",
    have: ["React"],
    missing: ["AWS — not mentioned"],
    suggestions: [],
    reason: "React experience aligns with the role.",
    questions: [],
    resume_id: "profile-1",
    v2_data: {},
    v2_version: 0,
  }),
);
let profiles = [
  {
    id: "profile-1",
    user_id: user.id,
    title: "Software Engineering Resume",
    text: "Built an API. Developed React applications.",
    is_default: true,
    notes: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(e.message));
await page.route(base + "/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  let data;
  if (url.pathname.includes("/auth/")) data = user;
  else if (url.pathname.includes("resume_profiles")) {
    if (req.method() === "GET") data = profiles;
    else if (req.method() === "POST") {
      const p = {
        ...req.postDataJSON(),
        id: "profile-" + (profiles.length + 1),
      };
      profiles.push(p);
      data = p;
    } else {
      data = profiles[0];
    }
  } else if (url.pathname.includes("Applications")) {
    if (req.method() === "PATCH") {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const patch = req.postDataJSON();
      apps = apps.map((a) =>
        a.id === id ? { ...a, ...patch, v2_version: a.v2_version + 1 } : a,
      );
      data = apps.find((a) => a.id === id);
    } else if (req.method() === "POST") {
      data = {
        ...req.postDataJSON(),
        id: "new-app",
        created_at: new Date().toISOString(),
      };
      apps.unshift(data);
    } else data = apps;
  } else if (url.pathname.includes("Resumes"))
    data = { text: profiles[0].text, updated_at: new Date().toISOString() };
  else data = [];
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
});
await page.route("http://localhost:3001/api/**", async (route) => {
  const body = route.request().postDataJSON();
  let data;
  if (route.request().url().endsWith("import-job"))
    data = {
      text: "Build reliable React applications with our engineering team. ".repeat(
        10,
      ),
      source_url: "https://example.com/jobs/engineer",
    };
  else {
    let result;
    if (body.system.includes('"overall"'))
      result = {
        overall: 85,
        scores: { Skills: 90, Experience: 80, Education: null, Keywords: 85 },
        strengths: ["React"],
        gaps: [{ item: "AWS", kind: "not mentioned" }],
        reason: "React experience supports this role.",
        nextAction: "Emphasize the API project.",
      };
    else if (body.system.includes('"original"'))
      result = {
        suggestions: [
          {
            original: "Built an API.",
            suggested: "Developed an API.",
            why: "Clarifies the wording without adding claims.",
          },
        ],
      };
    else if (body.system.includes('"priorities"'))
      result = {
        priorities: ["Reliable applications"],
        themes: ["Engineering collaboration"],
        technicalTopics: ["React"],
        stories: ["Describe how you built an API using STAR."],
        questions: ["How does the team review work?"],
        concerns: ["Be ready to explain your role."],
      };
    else if (body.system.includes("extract structured"))
      result = {
        company: "Example Company",
        position: "React Engineer",
        location: "Remote",
        salary: "$120,000",
        deadline: "2026-10-01",
        skills: ["React"],
        employment_type: "Full-time",
      };
    else
      result = {
        match: 85,
        have: ["React"],
        missing: [],
        suggestions: [],
        reason: "React experience supports this role.",
      };
    data = { text: JSON.stringify(result) };
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
});
await page.addInitScript(
  ({ project, user }) => {
    localStorage.setItem(
      `sb-${project}-auth-token`,
      JSON.stringify({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 36000,
        token_type: "bearer",
        user,
      }),
    );
  },
  { project, user },
);
await page.goto("http://127.0.0.1:5173/");
await page
  .getByRole("heading", { name: "Your next chapter, organized." })
  .waitFor();
fs.mkdirSync(outputDir, { recursive: true });
await page.screenshot({
  path: path.join(outputDir, "overview-desktop.png"),
  fullPage: true,
});
const overflow = [];
for (const width of [1440, 1024, 768, 430, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const view of [
    "Overview",
    "Applications",
    "Add Job",
    "Resumes",
    "Insights",
  ]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: view, exact: true })
      .click();
    await page.waitForTimeout(80);
    const sizes = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: innerWidth,
    }));
    if (sizes.body > sizes.viewport) overflow.push({ width, view, ...sizes });
  }
  if (width === 390) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await page.screenshot({
      path: path.join(outputDir, "overview-mobile.png"),
      fullPage: true,
    });
  }
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page
  .getByRole("navigation", { name: "Main navigation" })
  .getByRole("button", { name: "Applications", exact: true })
  .click();
await page.getByRole("button", { name: "Board", exact: true }).click();
await page.getByRole("button", { name: /Northstar/ }).click();
await page.getByRole("dialog").waitFor();
for (const tab of [
  "Match Analysis",
  "Resume",
  "Interviews",
  "Prep",
  "Activity",
  "Reminders",
])
  await page
    .getByRole("navigation", { name: "Application sections" })
    .getByRole("button", { name: tab, exact: true })
    .click();
await page.getByRole("button", { name: "Add reminder", exact: true }).click();
await page
  .getByLabel("Title", { exact: true })
  .fill("Follow up with recruiter");
await page.getByLabel(/Date & time/).fill("2026-09-18T11:00");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page
  .getByRole("heading", { name: "Follow up with recruiter", exact: true })
  .waitFor();
await page.screenshot({
  path: path.join(outputDir, "reminders.png"),
  fullPage: true,
});
await page
  .getByRole("navigation", { name: "Application sections" })
  .getByRole("button", { name: "Interviews", exact: true })
  .click();
await page.getByRole("button", { name: "Add round", exact: true }).click();
await page.getByLabel(/Date & time/).fill("2026-09-21T14:00");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.getByRole("button", { name: "Complete", exact: true }).click();
await page.getByText("Completed", { exact: true }).waitFor();
await page
  .getByRole("navigation", { name: "Application sections" })
  .getByRole("button", { name: "Match Analysis", exact: true })
  .click();
await page.getByRole("button", { name: "Analyze match", exact: true }).click();
await page
  .getByRole("heading", { name: "Why this score", exact: true })
  .waitFor();
await page
  .getByRole("navigation", { name: "Application sections" })
  .getByRole("button", { name: "Resume", exact: true })
  .click();
await page
  .getByRole("button", { name: "Tailor resume for this role", exact: true })
  .click();
await page
  .getByRole("button", { name: "Accept into role draft", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Role-specific draft", exact: true })
  .waitFor();
await page
  .getByRole("navigation", { name: "Application sections" })
  .getByRole("button", { name: "Prep", exact: true })
  .click();
await page
  .getByRole("button", { name: "Generate preparation", exact: true })
  .click();
await page
  .getByLabel("Your answer", { exact: true })
  .fill("I designed the API and tested its responses.");
await page.getByRole("button", { name: "Save answers", exact: true }).click();
await page
  .getByRole("navigation", { name: "Application sections" })
  .getByRole("button", { name: "Activity", exact: true })
  .click();
await page
  .getByLabel("Add a note", { exact: true })
  .fill("Recruiter will follow up Friday.");
await page.getByRole("button", { name: "Save note", exact: true }).click();
await page.getByRole("button", { name: "Save note", exact: true }).waitFor();
await page.keyboard.press("Escape");
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page
  .getByRole("navigation", { name: "Main navigation" })
  .getByRole("button", { name: "Add Job", exact: true })
  .click();
await page
  .getByLabel("Job posting URL", { exact: true })
  .fill("https://example.com/jobs/engineer");
await page.getByRole("button", { name: "Import job", exact: true }).click();
await page
  .getByRole("button", { name: "Save application", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Your next chapter, organized." })
  .waitFor();
if (
  !apps.some(
    (a) =>
      a.company === "Example Company" &&
      a.source_url === "https://example.com/jobs/engineer",
  )
)
  throw new Error("Imported job not persisted");
if (apps.find((a) => a.id === "1").v2_data.interviews[0].status !== "Completed")
  throw new Error("Interview completion failed");
// Exercise the real lazy-loaded PDF extractor with a generated, text-based PDF.
await page
  .getByRole("navigation", { name: "Main navigation" })
  .getByRole("button", { name: "Resumes", exact: true })
  .click();
await page.getByRole("button", { name: "Add resume", exact: true }).click();
const pdfText = "Built reliable React applications and tested an API.";
const stream = `BT /F1 12 Tf 50 750 Td (${pdfText}) Tj ET`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((n) => String(n).padStart(10, "0") + " 00000 n ")
  .join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await page
  .locator("input[type=file]")
  .setInputFiles({
    name: "test-resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  });
await page.getByLabel("Resume content", { exact: true }).waitFor();
await page.waitForFunction(
  (expected) =>
    document.querySelector(".resume-editor textarea")?.value.includes(expected),
  pdfText,
);
await page.getByLabel("Resume name", { exact: true }).fill("PDF Resume");
await page.getByRole("button", { name: "Save resume", exact: true }).click();
await page.getByRole("heading", { name: "PDF Resume", exact: true }).waitFor();
console.log(
  JSON.stringify({
    errors,
    overflow,
    reminderPersisted:
      apps.find((a) => a.id === "1").v2_data.reminders?.length === 1,
    screenshots: outputDir,
  }),
);
await browser.close();
if (errors.length || overflow.length) process.exitCode = 1;
