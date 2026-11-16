#!/usr/bin/env node
// Admin-only local uploader. Never run in browser or commit credentials.
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";

const [file, chapter] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!file || !/^[0-9]{1,3}$/.test(chapter ?? "")) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-private-mcq.mjs /path/to/authorized.pdf 20");
  process.exit(2);
}
if (!url || !key || !/^https:\/\//.test(url)) throw new Error("Missing secure server-side Supabase credentials");
if (extname(file).toLowerCase() !== ".pdf") throw new Error("This test uploader accepts authored PDFs only");
const info = await stat(file);
if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error("File must be a PDF below 100 MiB");
const safeName = basename(file).replace(/[^a-zA-Z0-9._-]/g, "_");
const objectPath = `module-01/chapter-${chapter}/${randomUUID()}-${safeName}`;
const base = url.replace(/\/$/, "");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const bucketResponse = await fetch(`${base}/storage/v1/bucket/mcq-content`, { headers });
if (!bucketResponse.ok) throw new Error(`Bucket check failed: ${bucketResponse.status}`);
const bucket = await bucketResponse.json();
if (bucket.public !== false) throw new Error("Refusing upload: bucket is public");
const bytes = await readFile(file);
const upload = await fetch(`${base}/storage/v1/object/mcq-content/${objectPath}`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/pdf", "x-upsert": "false" },
  body: bytes,
});
if (!upload.ok) throw new Error(`Upload failed (${upload.status}): ${(await upload.text()).slice(0,300)}`);
console.log(JSON.stringify({ bucket: "mcq-content", objectPath, bytes: bytes.length, published: false }, null, 2));
const anonymous = await fetch(`${base}/storage/v1/object/mcq-content/${objectPath}`);
if (anonymous.status !== 400 && anonymous.status !== 401 && anonymous.status !== 403 && anonymous.status !== 404) {
  throw new Error(`SECURITY CHECK FAILED: anonymous request returned ${anonymous.status}`);
}
console.log(JSON.stringify({ anonymousAccessDenied: true, anonymousStatus: anonymous.status }));
