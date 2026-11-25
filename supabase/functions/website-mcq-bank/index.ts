import { createClient } from "npm:@supabase/supabase-js@2";

const site = Deno.env.get("WEBSITE_ALLOWED_ORIGIN") || "https://neocliniq.maplecanadaramadan.ca";
const url = Deno.env.get("SUPABASE_URL");
const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const headers = {
  "Access-Control-Allow-Origin": site,
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
  "Vary": "Origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const statuses = new Set([200, 400, 403, 404, 503]);
const itemId = /^NCQ-[1-9][0-9]?\.[1-9][0-9]?-S[0-9]{2}-Q[0-9]{2}$/;
const chapterCode = /^[1-9][0-9]?\.[1-9][0-9]?$/;
const competency = /^(1A|1B|2|3|4|5|unclassified|1\.(?:[1-9]|10)|2\.2|3\.[1-4]|4\.2|5\.[1245])$/;

async function readJSON(req: Request) {
  if (!req.body) throw new Error("Missing body");
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, json = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } finally { reader.releaseLock(); }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== site) return reply({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || ""))
    return reply({ error: "JSON request required." }, 415);
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return reply({ error: "Sign in is required." }, 401);
  if (!url || !anon || !secret) return reply({ error: "Question bank unavailable." }, 503);
  try {
    const auth = createClient(url, anon, options);
    const { data, error: authError } = await auth.auth.getUser(token);
    if (authError || !data?.user) return reply({ error: "Sign in is required." }, 401);
    let body;
    try { body = await readJSON(req); } catch { return reply({ error: "Invalid request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !["status", "catalog", "list", "answer", "flag"].includes(body.action)) return reply({ error: "Invalid action." }, 400);
    const keys = body.action === "list" ? ["action", "module", "chapter", "competency", "planner", "track", "after", "review"] :
      body.action === "answer" ? ["action", "item", "selected"] :
      body.action === "flag" ? ["action", "item", "flagged"] : ["action"];
    if (!Object.keys(body).every(k => keys.includes(k))) return reply({ error: "Unexpected input." }, 400);
    if (body.action === "list" &&
        ((body.module != null && (!Number.isInteger(body.module) || body.module < 1 || body.module > 14)) ||
        (body.chapter != null && (typeof body.chapter !== "string" || !chapterCode.test(body.chapter))) ||
        (body.competency != null && (typeof body.competency !== "string" || !competency.test(body.competency))) ||
        (body.planner != null && (!Array.isArray(body.planner) || body.planner.length > 40 ||
          !body.planner.every((v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 161))) ||
        (body.track != null && !["single", "additional"].includes(body.track)) ||
        (body.review != null && !["all", "flagged", "wrong"].includes(body.review)) ||
        (body.after != null && (typeof body.after !== "string" || !itemId.test(body.after)))))
      return reply({ error: "Invalid filters." }, 400);
    if (body.action === "answer" &&
        (typeof body.item !== "string" || !itemId.test(body.item) || !Array.isArray(body.selected) ||
          body.selected.length > 5 || new Set(body.selected).size !== body.selected.length ||
          !body.selected.every((v: unknown) => typeof v === "string" && /^[A-E]$/.test(v))))
      return reply({ error: "Invalid answer choice." }, 400);
    if (body.action === "flag" && (typeof body.item !== "string" || !itemId.test(body.item) || typeof body.flagged !== "boolean"))
      return reply({ error: "Invalid flag." }, 400);
    const result = await createClient(url, secret, options).rpc("website_mcq_bank_action", {
      p_user_id: data.user.id,
      p_action: body.action,
      p_module: body.module ?? null,
      p_chapter: body.chapter ?? null,
      p_competency: body.competency ?? null,
      p_planner: body.planner ?? [],
      p_track: body.track ?? "single",
      p_after: body.after ?? null,
      p_item: body.item ?? null,
      p_selected: body.selected ?? [],
      p_review: body.review ?? "all",
      p_flagged: body.flagged ?? null,
    });
    if (result.error || !result.data?.body || !statuses.has(result.data.status))
      return reply({ error: "Question bank unavailable." }, 503);
    return reply(result.data.body, result.data.status);
  } catch { return reply({ error: "Question bank unavailable." }, 503); }
});
