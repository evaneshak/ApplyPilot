import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
export const IMPORT_FAILURE =
  "We couldn’t automatically import this posting. Some job sites block automated access. Paste the job description manually instead.";
export function isPublicIP(address) {
  // Conservative: only public IPv4 is accepted. IPv6 literals and AAAA-only sites fall back to manual paste.
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function validateJobURL(input) {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error("INVALID_URL");
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    /\.(localhost|local|internal|test|invalid|home|lan|arpa)\.?$/.test(host) ||
    host.endsWith(".") ||
    host.includes(":") ||
    (isIP(host) && !isPublicIP(host))
  )
    throw new Error("UNSAFE_URL");
  url.hash = "";
  return url;
}
export async function resolveJobURL(input, lookup = dns.lookup) {
  const url = validateJobURL(input);
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !isPublicIP(a.address)))
    throw new Error("UNSAFE_ADDRESS");
  return { url, address: addresses[0].address };
}
function decode(text) {
  return text
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (x) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        })[x],
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const c =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : " ";
    });
}
export function plainText(html) {
  return decode(
    String(html)
      .replace(
        /<(script|style|noscript|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, " "),
  )
    .split("")
    .map((c) => (c.charCodeAt(0) < 32 ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
export function extractPosting(html) {
  const jobs = [];
  const visit = (v, depth = 0) => {
    if (depth > 12 || !v || typeof v !== "object") return;
    if (
      v["@type"] === "JobPosting" ||
      (Array.isArray(v["@type"]) && v["@type"].includes("JobPosting"))
    )
      jobs.push(v);
    else
      for (const value of Object.values(v)) {
        if (Array.isArray(value)) value.forEach((x) => visit(x, depth + 1));
        else visit(value, depth + 1);
      }
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* Malformed structured data uses visible-text fallback. */
    }
  }
  let text;
  if (jobs.length) {
    const j = jobs[0];
    text = plainText(
      JSON.stringify({
        title: j.title,
        company: j.hiringOrganization,
        description: j.description,
        location: j.jobLocation,
        workArrangement: j.jobLocationType,
        salary: j.baseSalary,
        deadline: j.validThrough,
        employmentType: j.employmentType,
        requirements: j.qualifications,
        skills: j.skills,
      }),
    );
  } else {
    const main = html.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i);
    text = plainText(main ? main[2] : html);
  }
  if (text.length < 100) throw new Error("NO_POSTING");
  return text.slice(0, 60000);
}
async function retrieve(input, signal, redirects = 0) {
  if (signal.aborted) throw new Error("TIMEOUT");
  const { url, address } = await resolveJobURL(input);
  if (signal.aborted) throw new Error("TIMEOUT");
  const result = await new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal,
        agent: false,
        maxHeaderSize: 16384,
        lookup: (_host, options, cb) =>
          options.all
            ? cb(null, [{ address, family: 4 }])
            : cb(null, address, 4),
        headers: {
          "User-Agent": "ApplyPilot/2.0 (job posting import)",
          Accept: "text/html, application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          resolve({ redirect: res.headers.location });
          return;
        }
        if (
          res.statusCode !== 200 ||
          !/^text\/html\b|^application\/xhtml\+xml\b/i.test(
            res.headers["content-type"] || "",
          ) ||
          !["identity", undefined].includes(res.headers["content-encoding"])
        ) {
          res.destroy();
          reject(new Error("UNSUPPORTED_RESPONSE"));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1500000) {
            req.destroy(new Error("TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            html: Buffer.concat(chunks).toString("utf8"),
            url: url.href,
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
  });
  if (result.redirect) {
    if (redirects >= 3) throw new Error("TOO_MANY_REDIRECTS");
    return retrieve(new URL(result.redirect, url).href, signal, redirects + 1);
  }
  if (!result.html) throw new Error("NO_POSTING");
  return result;
}
export async function importJob(input) {
  const controller = new AbortController();
  let timer;
  try {
    const result = await Promise.race([
      retrieve(input, controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("TIMEOUT"));
        }, 10000);
      }),
    ]);
    return { text: extractPosting(result.html), source_url: result.url };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
