// Photo uploads for the /upload/ page, stored in Netlify Blobs (no git commit, no rebuild).
//
//   POST   /api/login         check username + password, returns the role
//   POST   /api/upload        body = JPEG bytes (the page converts every photo to JPEG first)
//   GET    /api/photos        list of uploaded photos, newest first
//   GET    /api/photo/:key    the photo itself (cached by the CDN)
//   DELETE /api/photo/:key    admin only
//
// Credentials live in Netlify environment variables, never in this public repo:
//   UPLOAD_USER / UPLOAD_PASSWORD   can only add photos
//   ADMIN_USER  / ADMIN_PASSWORD    can add and delete

import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";

const MAX_BYTES = 6 * 1024 * 1024;
const KEY_PATTERN = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}\.jpg$/;

const store = () => getStore({ name: "uploaded-photos", consistency: "strong" });

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

function newKey() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${date}-${time}-${rand}.jpg`;
}

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/login" && req.method === "POST") {
    const role = await roleFor(req);
    return role ? json({ role }) : json({ error: "Wrong username or password" }, 401);
  }

  if (path === "/api/upload" && req.method === "POST") {
    const role = await roleFor(req);
    if (!role) return json({ error: "Wrong username or password" }, 401);

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) return json({ error: "Empty file" }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: "Photo is too large" }, 413);
    // Only accept real JPEG data (the page converts every photo to JPEG).
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
      return json({ error: "Not a photo" }, 415);
    }

    const key = newKey();
    await store().set(key, bytes, {
      metadata: { uploadedAt: new Date().toISOString(), role, size: bytes.length },
    });
    return json({ key, url: `/api/photo/${key}` }, 201);
  }

  if (path === "/api/photos" && req.method === "GET") {
    const { blobs } = await store().list();
    const photos = blobs
      .map((b) => b.key)
      .filter((k) => KEY_PATTERN.test(k))
      .sort()
      .reverse()
      .map((key) => ({ key, url: `/api/photo/${key}` }));
    return json({ photos });
  }

  if (path.startsWith("/api/photo/")) {
    const key = context.params?.key || decodeURIComponent(path.slice("/api/photo/".length));
    if (!KEY_PATTERN.test(key)) return json({ error: "Not found" }, 404);

    if (req.method === "GET") {
      const data = await store().get(key, { type: "arrayBuffer" });
      if (!data) return json({ error: "Not found" }, 404);
      return new Response(data, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
          "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
          "Netlify-Cache-Tag": `photo-${key.slice(0, -4)}`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (req.method === "DELETE") {
      const role = await roleFor(req);
      if (role !== "admin") return json({ error: "Only the admin can delete photos" }, 403);
      await store().delete(key);
      await purgeCache({ tags: [`photo-${key.slice(0, -4)}`] }).catch(() => {});
      return json({ deleted: key });
    }
  }

  return json({ error: "Not found" }, 404);
};

export const config = {
  path: ["/api/login", "/api/upload", "/api/photos", "/api/photo/:key"],
};
