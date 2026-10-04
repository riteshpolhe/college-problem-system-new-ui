// College Problem Reporting System - zero-dependency server (Node.js 16+)
// Run: node server.js   (no npm install needed)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123"; // change this, or set ADMIN_PASSWORD
const TRUST_PROXY = !!process.env.TRUST_PROXY; // set when hosted behind a proxy (Render, Railway...)
const FILE = process.env.DATA_FILE || path.join(__dirname, "problems.json");
const PUBLIC = path.join(__dirname, "public");

const CATEGORIES = ["Classroom", "Lab / Computer", "Electricity", "Water", "Cleanliness", "Infrastructure", "Other"];
const PRIORITIES = ["Low", "Medium", "High"];
const STATUSES = ["Pending", "In Progress", "Resolved"];
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---------- storage ----------
function read() {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf8");
  if (!raw.trim()) return [];
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d)) throw new Error("not an array");
    return d;
  } catch {
    // Never silently overwrite a damaged file: move it aside so the data can be recovered.
    const bad = FILE + ".damaged-" + Date.now();
    fs.renameSync(FILE, bad);
    console.error("problems.json was damaged. Saved a copy as " + bad);
    return [];
  }
}
function write(d) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, FILE);
}
// IDs never repeat, even if the newest complaint is deleted: a counter file remembers the highest number used.
const COUNTER = FILE + ".counter";
function nextId(data) {
  const max = data.reduce((m, p) => Math.max(m, parseInt(String(p.id).split("-")[2], 10) || 0), 0);
  let saved = 0;
  try { saved = parseInt(fs.readFileSync(COUNTER, "utf8"), 10) || 0; } catch {}
  const n = Math.max(max, saved) + 1;
  fs.writeFileSync(COUNTER, String(n));
  return "CPR-" + new Date().getFullYear() + "-" + String(n).padStart(4, "0");
}

// ---------- helpers ----------
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};
const send = (res, code, obj) => {
  res.writeHead(code, { ...HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const clientIp = (req) => (TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let failed = false;
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > 20000) { failed = true; reject(new HttpError(413, "Request too large.")); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (failed) return;
      try { const b = JSON.parse(Buffer.concat(chunks).toString() || "{}"); resolve(b && typeof b === "object" ? b : {}); }
      catch { reject(new HttpError(400, "Invalid request.")); }
    });
    req.on("error", reject);
  });
}

// Sliding-window limiter: allow(key, max, windowMs)
const buckets = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now); buckets.set(key, list);
  return list.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 600000)) buckets.delete(k); for (const [k, v] of failures) if (!v.some((t) => now - t < 600000)) failures.delete(k); }, 300000).unref();

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const passwordOk = (given) => crypto.timingSafeEqual(sha(given || ""), sha(ADMIN_PASSWORD));

const failures = new Map(); // ip -> [timestamps of wrong passwords]
function requireAdmin(req, res) {
  const ip = clientIp(req), now = Date.now();
  const recent = (failures.get(ip) || []).filter((t) => now - t < 10 * 60000);
  if (recent.length >= 8) { send(res, 429, { error: "Too many wrong passwords. Try again in 10 minutes." }); return false; }
  if (passwordOk(req.headers["x-admin-key"])) { failures.delete(ip); return true; }
  recent.push(now); failures.set(ip, recent);
  send(res, 401, { error: "Wrong admin password." });
  return false;
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "problems", id]
  const ip = clientIp(req);

  // Student: report a problem
  if (req.method === "POST" && url.pathname === "/api/problems") {
    if (tooMany("submit:" + ip, 10, 60000)) return send(res, 429, { error: "Too many submissions. Please wait a minute." });
    const b = await readBody(req);
    const name = str(b.name, 60), rollNo = str(b.rollNo, 20), location = str(b.location, 80), description = str(b.description, 600);
    if (!name || !rollNo || !location || !description) return send(res, 400, { error: "Please fill in all required fields." });
    if (!CATEGORIES.includes(b.category) || !PRIORITIES.includes(b.priority)) return send(res, 400, { error: "Invalid category or priority." });
    const data = read();
    const now = new Date().toISOString();
    const problem = { id: nextId(data), name, rollNo, category: b.category, priority: b.priority, location, description, status: "Pending", remark: "", createdAt: now, updatedAt: now };
    data.push(problem);
    write(data);
    return send(res, 201, { id: problem.id });
  }

  // Student: track. Needs complaint ID + roll number so IDs can't be guessed to read other complaints.
  if (req.method === "POST" && url.pathname === "/api/track") {
    if (tooMany("track:" + ip, 20, 60000)) return send(res, 429, { error: "Too many attempts. Please wait a minute." });
    const b = await readBody(req);
    const id = str(b.id, 30).toLowerCase(), roll = str(b.rollNo, 20).toLowerCase();
    const p = id && roll && read().find((x) => x.id.toLowerCase() === id && x.rollNo.toLowerCase() === roll);
    if (!p) return send(res, 404, { error: "No complaint found with that ID and roll number." });
    const { category, priority, location, description, status, remark, createdAt, updatedAt } = p;
    return send(res, 200, { id: p.id, category, priority, location, description, status, remark, createdAt, updatedAt });
  }

  // Admin-only
  if (parts[1] === "problems") {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET" && !parts[2]) return send(res, 200, read().reverse());

    if (req.method === "PATCH" && parts[2]) {
      const id = decodeURIComponent(parts[2]);
      const b = await readBody(req);
      const data = read();
      const p = data.find((x) => x.id === id);
      if (!p) return send(res, 404, { error: "Complaint not found." });
      if (b.status !== undefined) {
        if (!STATUSES.includes(b.status)) return send(res, 400, { error: "Invalid status." });
        p.status = b.status;
      }
      if (b.remark !== undefined) p.remark = str(b.remark, 300);
      p.updatedAt = new Date().toISOString();
      write(data);
      return send(res, 200, p);
    }

    if (req.method === "DELETE" && parts[2]) {
      const id = decodeURIComponent(parts[2]);
      const data = read();
      const next = data.filter((x) => x.id !== id);
      if (next.length === data.length) return send(res, 404, { error: "Complaint not found." });
      write(next);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: "Not found." });
}

// ---------- static files ----------
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400, HEADERS); return res.end("Bad request"); }
  if (rel === "/favicon.ico") { res.writeHead(204, HEADERS); return res.end(); }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403, HEADERS); return res.end("Forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { ...HEADERS, "Content-Type": "text/plain" }); return res.end("Page not found"); }
    res.writeHead(200, { ...HEADERS, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, HEADERS); return res.end(); }
    serveStatic(req, res, url);
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) return send(res, err.code, { error: err.message });
    console.error(err);
    send(res, 500, { error: "Server error. Please try again." });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error("Port " + PORT + " is already in use. Close the other copy of the server, or run with a different port (PORT=3001).");
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log("Running at http://localhost:" + PORT);
  try { // some phones (Termux) don't allow reading network interfaces
    for (const list of Object.values(os.networkInterfaces()))
      for (const i of list || []) if (i.family === "IPv4" && !i.internal) console.log("On your Wi-Fi/network: http://" + i.address + ":" + PORT);
  } catch {}
  if (ADMIN_PASSWORD === "admin123") console.log("Warning: default admin password in use. Set ADMIN_PASSWORD to change it.");
});
