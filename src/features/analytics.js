export const stages = ["saved", "applied", "interview", "offer", "rejected"];
export function analytics(apps, now = new Date()) {
  const counts = Object.fromEntries(
    stages.map((s) => [s, apps.filter((a) => a.status === s).length]),
  );
  const submitted = apps.filter((a) => a.status !== "saved").length;
  const responses = counts.interview + counts.offer + counts.rejected;
  const scores = apps
    .map((a) => a.match)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const rate = (n) => (submitted ? Math.round((n / submitted) * 100) : null);
  const month = apps.filter((a) => {
    const d = new Date(a.createdAt);
    return (
      d <= now &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }).length;
  const week = apps.filter((a) => {
    const d = new Date(a.createdAt);
    return d <= now && now - d < 7 * 86400000;
  }).length;
  const trend = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (7 - i) * 7 - 6);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      label: start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      count: apps.filter(
        (a) => new Date(a.createdAt) >= start && new Date(a.createdAt) < end,
      ).length,
    };
  });
  const group = (key) =>
    Object.entries(
      apps.reduce((all, a) => {
        const label = a[key] || "Not specified";
        all[label] = (all[label] || 0) + 1;
        return all;
      }, Object.create(null)),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  return {
    counts,
    submitted,
    responses,
    month,
    week,
    responseRate: rate(responses),
    interviewRate: rate(counts.interview + counts.offer),
    offerRate: rate(counts.offer),
    rejectionRate: rate(counts.rejected),
    conversion: apps.length
      ? Math.round((submitted / apps.length) * 100)
      : null,
    interviewConversion:
      counts.interview + counts.offer
        ? Math.round((counts.offer / (counts.interview + counts.offer)) * 100)
        : null,
    average: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null,
    trend,
    companies: group("company"),
    locations: group("location"),
    employment: group("employment_type"),
    matchBands: [
      [0, 59],
      [60, 79],
      [80, 100],
    ].map(([min, max]) => {
      const group = apps.filter(
        (a) =>
          typeof a.match === "number" &&
          a.match >= min &&
          a.match <= max &&
          a.status !== "saved",
      );
      const n = group.filter((a) =>
        ["interview", "offer"].includes(a.status),
      ).length;
      return {
        label: `${min}–${max}% match`,
        count: group.length,
        rate: group.length ? Math.round((n / group.length) * 100) : null,
      };
    }),
    stageTime: stageDurations(apps),
  };
}
export function upcoming(apps, now = new Date()) {
  return apps
    .filter((a) => a.deadline && !["offer", "rejected"].includes(a.status))
    .map((a) => ({
      ...a,
      days: Math.ceil((new Date(a.deadline + "T23:59:59") - now) / 86400000),
    }))
    .filter((a) => Number.isFinite(a.days) && a.days <= 14)
    .sort((a, b) => a.days - b.days);
}

export function stageDurations(apps) {
  const durations = {};
  for (const app of apps) {
    const transitions = (app.v2_data?.events || [])
      .filter((e) => e.type === "status_changed" && stages.includes(e.status))
      .slice()
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    for (let i = 0; i < transitions.length - 1; i++) {
      const stage = transitions[i].status;
      const days =
        (new Date(transitions[i + 1].at) - new Date(transitions[i].at)) /
        86400000;
      if (!Number.isFinite(days) || days < 0) continue;
      (durations[stage] ||= []).push(days);
    }
  }
  return Object.entries(durations).map(([stage, values]) => ({
    stage,
    days:
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    count: values.length,
  }));
}
