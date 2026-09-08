import { authenticateImport } from "./_lib/importAuth.js";
import { validateJobURL } from "./_lib/jobImport.js";
import { importJob, IMPORT_FAILURE } from "./_lib/jobImport.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed." });
  try {
    validateJobURL(req.body?.url);
    const auth = await authenticateImport(req);
    if (auth.status)
      return res.status(auth.status).json({ message: auth.message });
    return res.status(200).json(await importJob(req.body?.url));
  } catch (error) {
    console.warn("Job import failed", {
      code: /^[A-Z_]+$/.test(error.message) ? error.message : "IMPORT_FAILED",
    });
    return res
      .status(422)
      .json({ error: "IMPORT_FAILED", message: IMPORT_FAILURE });
  }
}
