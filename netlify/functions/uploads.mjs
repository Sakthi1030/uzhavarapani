// Uploads from the /upload/ page, stored in Netlify Blobs (no git commit, no rebuild).
// Four sections, matching the website: realImages, realVideos, aiImages, aiVideos.
//
// Files are sent in small chunks (Netlify functions accept ~6 MB per request),
// and videos are served back with HTTP Range support so they stream and seek.
//
//   POST   /api/login                     check username + password, returns the role
//   POST   /api/upload/start              { section, contentType, size } -> { id, chunkSize }
//   PUT    /api/upload/:id/:n             chunk n (raw bytes)
//   POST   /api/upload/:id/finish         checks the file and publishes it
//   GET    /api/media                     { realImages: [url], realVideos: [...], ... } newest first
//   GET    /api/file/:name                the file itself (name = <id>.<ext>)
//   DELETE /api/file/:name                admin only
//
// Credentials live in Netlify environment variables, never in this public repo:
//   UPLOAD_USER / UPLOAD_PASSWORD   can only add
//   ADMIN_USER  / ADMIN_PASSWORD    can add and delete

import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";

const CHUNK = 3 * 1024 * 1024;
const MB = 1024 * 1024;

const SECTIONS = {
  realImages: { kind: "image", max: 6 * MB },
  aiImages: { kind: "image", max: 6 * MB },
  realVideos: { kind: "video", max: 50 * MB },
  aiVideos: { kind: "video", max: 50 * MB },
};

const TYPES = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/x-m4v": { kind: "video", ext: "m4v" },
  "video/webm": { kind: "video", ext: "webm" },
};

// What the browser is told when playing the file (Chrome won't play "video/quicktime").
const SERVE_TYPE = { jpg: "image/jpeg", mp4: "video/mp4", mov: "video/mp4", m4v: "video/mp4", webm: "video/webm" };

const ID = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}$/;
const NAME = /^([0-9]{8}-[0-9]{6}-[a-z0-9]{6})\.(jpg|mp4|mov|m4v|webm)$/;

const store = () => getStore({ name: "site-uploads", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function same(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Returns "admin", "uploader" or null. Usernames are not case-sensitive.
async function roleFor(req) {
  const user = (req.headers.get("x-user") || "").trim().toLowerCase();
  const pass = req.headers.get("x-pass") || "";
  const env = Netlify.env;
  let role = null;
  if (env.get("ADMIN_PASSWORD") && same(user, (env.get("ADMIN_USER") || "").toLowerCase()) && same(pass, env.get("ADMIN_PASSWORD"))) {
    role = "admin";
  } else if (env.get("UPLOAD_PASSWORD") && same(user, (env.get("UPLOAD_USER") || "").toLowerCase()) && same(pass, env.get("UPLOAD_PASSWORD"))) {
    role = "uploader";
  }
  // Slow down password guessing.
  if (!role) await new Promise((r) => setTimeout(r, 1500));
  return role;
}

function newId() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${date}-${time}-${rand}`;
}

// Check the first bytes really are a JPEG / MP4 / MOV / WebM.
function looksValid(ext, b) {
  if (ext === "jpg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "webm") return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  const box = String.fromCharCode(b[4], b[5], b[6], b[7]);
  return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(box);
}

const fileUrl = (id, ext) => `/api/file/${id}.${ext}`;
const cacheTag = (id) => `upload-${id}`;

/* ---------- handlers ---------- */

async function start(req) {
  const body = await req.json().catch(() => ({}));
  const section = SECTIONS[body.section];
  const type = TYPES[body.contentType];
  const size = Number(body.size);
  if (!section) return json({ error: "Unknown section" }, 400);
  if (!type || type.kind !== section.kind) return json({ error: "This file type is not allowed here" }, 415);
  if (!Number.isFinite(size) || size <= 0) return json({ error: "Empty file" }, 400);
  if (size > section.max) return json({ error: `File is larger than ${section.max / MB} MB` }, 413);

  const id = newId();
  const chunks = Math.ceil(size / CHUNK);
  await store().setJSON(`meta/${id}`, {
    id, section: body.section, ext: type.ext, size, chunks, chunkSize: CHUNK,
    uploadedAt: new Date().toISOString(),
  });
  return json({ id, chunkSize: CHUNK, chunks }, 201);
}

async function putChunk(req, id, n) {
  const meta = await store().get(`meta/${id}`, { type: "json" });
  if (!meta) return json({ error: "Upload not found" }, 404);
  if (!(n >= 0 && n < meta.chunks)) return json({ error: "Bad chunk number" }, 400);

  const bytes = new Uint8Array(await req.arrayBuffer());
  const expected = n === meta.chunks - 1 ? meta.size - n * CHUNK : CHUNK;
  if (bytes.length !== expected) return json({ error: "Chunk size mismatch" }, 400);
  if (n === 0 && !looksValid(meta.ext, bytes)) return json({ error: "This file is not a valid photo/video" }, 415);

  await store().set(`data/${id}/${n}`, bytes);
  return json({ ok: true });
}

async function finish(id) {
  const meta = await store().get(`meta/${id}`, { type: "json" });
  if (!meta) return json({ error: "Upload not found" }, 404);
  const { blobs } = await store().list({ prefix: `data/${id}/` });
  if (blobs.length !== meta.chunks) return json({ error: "Upload incomplete, please try again" }, 400);

  // The "items/" key is what makes the file appear on the website.
  await store().set(`items/${meta.section}/${id}.${meta.ext}`, "1");
  return json({ url: fileUrl(id, meta.ext), section: meta.section }, 201);
}

async function listMedia() {
  const { blobs } = await store().list({ prefix: "items/" });
  const out = { realImages: [], realVideos: [], aiImages: [], aiVideos: [] };
  blobs
    .map((b) => b.key.split("/"))
    .filter(([, section, name]) => out[section] && NAME.test(name || ""))
    .sort((a, b) => (a[2] < b[2] ? 1 : -1)) // newest first
    .forEach(([, section, name]) => {
      const [, id, ext] = name.match(NAME);
      out[section].push(fileUrl(id, ext));
    });
  return json(out);
}

async function serve(req, id, ext) {
  const meta = await store().get(`meta/${id}`, { type: "json" });
  if (!meta || meta.ext !== ext) return json({ error: "Not found" }, 404);

  const type = SERVE_TYPE[ext];
  const base = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Netlify-Cache-Tag": cacheTag(id),
  };

  // Photos: one small file, cached by the CDN.
  if (ext === "jpg") {
    const parts = [];
    for (let n = 0; n < meta.chunks; n++) {
      const chunk = await store().get(`data/${id}/${n}`, { type: "arrayBuffer" });
      if (!chunk) return json({ error: "Not found" }, 404);
      parts.push(new Uint8Array(chunk));
    }
    return new Response(Buffer.concat(parts), {
      headers: {
        ...base,
        "Cache-Control": "public, max-age=86400",
        "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
      },
    });
  }

  // Videos: answer each Range request from the one chunk that holds it.
  const total = meta.size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  let startByte = 0;
  let endByte = total - 1;
  if (range) {
    if (range[1] === "" && range[2] !== "") {
      startByte = Math.max(0, total - Number(range[2])); // "bytes=-500" = last 500 bytes
    } else {
      startByte = Number(range[1] || 0);
      if (range[2] !== "") endByte = Math.min(Number(range[2]), total - 1);
    }
    if (startByte >= total || startByte > endByte) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${total}` } });
    }
  }

  const idx = Math.floor(startByte / CHUNK);
  const chunk = await store().get(`data/${id}/${idx}`, { type: "arrayBuffer" });
  if (!chunk) return json({ error: "Not found" }, 404);
  const chunkStart = idx * CHUNK;
  endByte = Math.min(endByte, chunkStart + chunk.byteLength - 1);
  const slice = new Uint8Array(chunk).subarray(startByte - chunkStart, endByte - chunkStart + 1);

  const whole = startByte === 0 && endByte === total - 1;
  return new Response(slice, {
    status: whole && !range ? 200 : 206,
    headers: {
      ...base,
      "Content-Length": String(slice.length),
      ...(whole && !range ? {} : { "Content-Range": `bytes ${startByte}-${endByte}/${total}` }),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function remove(id) {
  const meta = await store().get(`meta/${id}`, { type: "json" });
  if (!meta) return json({ error: "Not found" }, 404);
  await store().delete(`items/${meta.section}/${id}.${meta.ext}`);
  for (let n = 0; n < meta.chunks; n++) await store().delete(`data/${id}/${n}`);
  await store().delete(`meta/${id}`);
  await purgeCache({ tags: [cacheTag(id)] }).catch(() => {});
  return json({ deleted: id });
}

/* ---------- router ---------- */

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const m = req.method;

  if (path === "/api/media" && m === "GET") return listMedia();

  let match;
  if ((match = path.match(/^\/api\/file\/([^/]+)$/))) {
    const name = NAME.exec(decodeURIComponent(match[1]));
    if (!name) return json({ error: "Not found" }, 404);
    if (m === "GET" || m === "HEAD") return serve(req, name[1], name[2]);
    if (m === "DELETE") {
      if ((await roleFor(req)) !== "admin") return json({ error: "Only the admin can delete" }, 403);
      return remove(name[1]);
    }
  }

  // Everything below needs a valid login.
  if (path === "/api/login" && m === "POST") {
    const role = await roleFor(req);
    return role ? json({ role }) : json({ error: "Wrong username or password" }, 401);
  }

  if (path.startsWith("/api/upload")) {
    const role = await roleFor(req);
    if (!role) return json({ error: "Wrong username or password" }, 401);

    if (path === "/api/upload/start" && m === "POST") return start(req);
    if ((match = path.match(/^\/api\/upload\/([^/]+)\/(\d+)$/)) && m === "PUT" && ID.test(match[1])) {
      return putChunk(req, match[1], Number(match[2]));
    }
    if ((match = path.match(/^\/api\/upload\/([^/]+)\/finish$/)) && m === "POST" && ID.test(match[1])) {
      return finish(match[1]);
    }
  }

  return json({ error: "Not found" }, 404);
};

export const config = {
  path: ["/api/login", "/api/media", "/api/file/*", "/api/upload/*"],
};
