// Verify a Supabase access token against the configured project, never a caller-supplied origin.
export async function authenticateImport(req) {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const authorization = req.headers?.authorization;
  if (!base || !key)
    return {
      status: 503,
      message:
        "Job import is not configured. Paste the job description manually.",
    };
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ") ||
    authorization.length > 10000
  )
    return { status: 401, message: "Sign in to import a job." };
  try {
    const response = await fetch(new URL("/auth/v1/user", base), {
      headers: { apikey: key, Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      return { status: 401, message: "Your session expired. Sign in again." };
    const user = await response.json();
    if (!user.id) return { status: 401, message: "Sign in to import a job." };
    return { userId: user.id };
  } catch {
    return {
      status: 503,
      message: "Couldn’t verify your session. Please try again.",
    };
  }
}
