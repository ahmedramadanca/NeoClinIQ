/**
 * NeoClinIQ original reference assistant integration for Expo/React Native.
 * Pass the existing authenticated Supabase client from the app.
 * Never embed service_role keys, PDF links, or Google OAuth credentials in clients.
 * Requires a valid Supabase session and an active MCQ entitlement (or admin claim).
 */
export type ReferenceCitation = {
  ref: number;
  title: string;
  collection?: string | null;
  passageNumber: number;
};
export type ReferenceAnswer = {
  answer: string;
  citations: ReferenceCitation[];
  insufficient_evidence: boolean;
  notice?: string;
};

type AuthClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
  };
};

const PROJECT_URL = "https://uxnqoglkqptnslsdowxn.supabase.co";
const PUBLIC_KEY = "sb_publishable_v0uOpwZ-BBas2E7jyDkMXQ_TzNOHdAA";

export async function askOriginalReferences(
  client: AuthClient,
  question: string,
  signal?: AbortSignal,
): Promise<ReferenceAnswer> {
  const q = question.trim();
  if (q.length < 8 || q.length > 3000) {
    throw new Error("Please enter a question between 8 and 3000 characters.");
  }
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error("Unable to verify your session.");
  if (!data.session?.access_token) throw new Error("Sign in to NeoClinIQ first.");

  const response = await fetch(
    PROJECT_URL + "/functions/v1/original-reference-assistant",
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        apikey: PUBLIC_KEY,
        Authorization: "Bearer " + data.session.access_token,
      },
      body: JSON.stringify({ question: q }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Reference assistant unavailable.");
  }
  return {
    answer: String(payload.answer || ""),
    citations: Array.isArray(payload.citations) ? payload.citations : [],
    insufficient_evidence: Boolean(payload.insufficient_evidence),
    notice: typeof payload.notice === "string" ? payload.notice : undefined,
  };
}
