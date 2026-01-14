/**
 * PillNow Local Backend (LAN)
 *
 * Responsibilities:
 * - Store per-container pill config + schedule times (from app via /set-schedule)
 * - Trigger alarms per container by publishing MQTT messages (bridge forwards to Arduino)
 * - Trigger ESP32-CAM captures per container via MQTT (/trigger-capture/:containerId)
 * - Receive ESP32-CAM uploads (/ingest/:deviceId/:container), call FastAPI verifier, persist latest result
 * - Publish pill mismatch alerts via MQTT so Arduino can buzz and app can show mismatch modal via BT
 *
 * See docs/MQTT_and_Ingest.md for protocol notes.
 */

/* eslint-env node */

const path = require("path");
// Load env from backend/backend.env first (local IoT backend config), then fall back to repo root .env.
// NOTE: We avoid dotfiles here because some environments block creating/editing them.
require("dotenv").config({ path: path.join(__dirname, "backend.env") });
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const mqtt = require("mqtt");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const { FormData } = require("undici");
let nodemailer = null;
try {
  // Optional dependency; only used if SMTP env vars are provided.
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

const PORT = Number(process.env.PORT || 5001);
// Default to local broker; override in backend/backend.env when using a different host.
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883";
const VERIFIER_URL = process.env.VERIFIER_URL || "http://127.0.0.1:8000/verify";
const EMAIL_ENABLED = String(process.env.EMAIL_ENABLED || "").toLowerCase() === "true";
const EMAIL_TO = process.env.EMAIL_TO || "";
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER || "";
const EMAIL_HOST = process.env.EMAIL_HOST || "";
const EMAIL_PORT = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587;
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";

// Auto-capture: when an alarm fires, should the backend automatically request an ESP32-CAM capture?
const AUTO_CAPTURE_ON_ALARM = String(process.env.AUTO_CAPTURE_ON_ALARM || "").toLowerCase() === "true";
const AUTO_CAPTURE_DELAY_MS = Number(process.env.AUTO_CAPTURE_DELAY_MS || 5000);
// Optional single-camera override (publish captures to this device regardless of logical container)
const SINGLE_CAMERA_DEVICE_ID = String(process.env.SINGLE_CAMERA_DEVICE_ID || "").trim();

const CAPTURES_DIR = path.join(__dirname, "captures");
const STATE_PATH = path.join(__dirname, "state.json");

fs.mkdirSync(CAPTURES_DIR, { recursive: true });

/**
 * State shape:
 * {
 *   containers: {
 *     [containerId]: {
 *       pill_config: {count,label?},
 *       // legacy daily schedule (repeats every day)
 *       times: ["HH:MM", ...],
 *       // date-aware schedules (recommended): [{ date: "YYYY-MM-DD", time: "HH:MM" }]
 *       schedules: Array<{date: string, time: string}>
 *     }
 *   },
 *   verifications: {
 *     [containerId]: { ...payload returned by /containers/:id/verification }
 *   },
 *   notifications: [{...}]
 *   passwordResets: {
 *     [phone]: {
 *       email: string,
 *       otpHash?: string,
 *       otpSalt?: string,
 *       otpExp?: number,
 *       otpAttempts?: number,
 *       lastSentAt?: number,
 *       resetToken?: string,
 *       resetTokenExp?: number
 *     }
 *   }
 * }
 */
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      return { containers: {}, verifications: {}, notifications: [], passwordResets: {} };
    }
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    if (!raw.trim()) return { containers: {}, verifications: {}, notifications: [], passwordResets: {} };
    const parsed = JSON.parse(raw);
    return {
      containers: parsed.containers || {},
      verifications: parsed.verifications || {},
      notifications: parsed.notifications || [],
      passwordResets: parsed.passwordResets || {},
    };
  } catch (e) {
    console.warn("[backend] Failed to load state.json, starting fresh:", e?.message || e);
    return { containers: {}, verifications: {}, notifications: [], passwordResets: {} };
  }
}

let state = loadState();
state.passwordResets = state.passwordResets || {};
let saveTimer = null;
function saveStateSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
    } catch (e) {
      console.warn("[backend] Failed to write state.json:", e?.message || e);
    }
  }, 250);
}

function normalizeContainerId(id) {
  if (!id) return "container1";
  const s = String(id).trim();
  // Support legacy names
  if (s === "morning") return "container1";
  if (s === "noon") return "container2";
  if (s === "evening") return "container3";
  return s;
}

// Normalize a container identifier from database/cloud schedule records to a stable
// numeric container index (1, 2, or 3). Supports:
// - numeric values (1, 2, 3)
// - strings "1", "2", "3"
// - strings like "container1", "container2"
// - legacy labels "morning", "noon", "evening"
function normalizeContainerNumber(raw) {
  if (raw === null || raw === undefined) return 1;
  const s = String(raw).trim().toLowerCase();

  // Extract first digit sequence (handles "1", "01", "container2", etc.)
  const m = s.match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 3) return n;
  }

  // Legacy string labels
  if (s === "morning") return 1;
  if (s === "noon") return 2;
  if (s === "evening" || s === "night") return 3;

  // Fallback to container1 for any unknown format
  return 1;
}

// If you only have one ESP32-CAM, set SINGLE_CAMERA_DEVICE_ID in backend.env (e.g., "container2")
// All MQTT publishes will target that device's topic while preserving the logical container in payloads.
function resolveDeviceId(containerId) {
  const single = String(process.env.SINGLE_CAMERA_DEVICE_ID || "").trim();
  if (single) return normalizeContainerId(single);
  return normalizeContainerId(containerId);
}

function hhmmNowLocal() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function yyyyMmDdLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeHhMm(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  // allow "HH:MM:SS" etc
  return s.slice(0, 5);
}

function normalizeYyyyMmDd(d) {
  const s = String(d || "").trim();
  // very light validation
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return "";
}

function getTimesForToday(cfg, todayYmd) {
  const schedules = Array.isArray(cfg?.schedules) ? cfg.schedules : [];
  if (schedules.length > 0) {
    const times = schedules
      .filter((s) => normalizeYyyyMmDd(s?.date) === todayYmd)
      .map((s) => normalizeHhMm(s?.time))
      .filter(Boolean);
    return times;
  }
  // fallback to legacy repeating times
  return Array.isArray(cfg?.times) ? cfg.times : [];
}

// --- MQTT setup ---
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
  reconnectPeriod: 2000,
  connectTimeout: 5000,
});

mqttClient.setMaxListeners?.(50);

mqttClient.on("message", (topic, payloadBuf) => {
  try {
    const topicStr = String(topic || "");
    if (!topicStr.startsWith("pillnow/")) return;

    // Expect: pillnow/<deviceId>/status
    const m = topicStr.match(/^pillnow\/([^/]+)\/status$/);
    if (!m) return;
    const deviceId = m[1];

    const raw = payloadBuf ? payloadBuf.toString("utf8") : "";
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = { raw };
    }

    const now = Date.now();
    state.cameraStatus = state.cameraStatus || {};
    state.cameraStatus[deviceId] = {
      lastSeenMs: now,
      lastSeenIso: new Date(now).toISOString(),
      topic: topicStr,
      payload: parsed,
    };
    // Don't persist this into state.json (transient), but keep it in memory for diagnostics
  } catch (e) {
    console.warn("[backend] MQTT status parse error:", e?.message || e);
  }
});

mqttClient.on("connect", () => {
  console.log(`[backend] MQTT connected: ${MQTT_BROKER_URL}`);
  try {
    mqttClient.subscribe("pillnow/+/status", { qos: 0 }, (err) => {
      if (err) console.warn("[backend] MQTT subscribe failed (status):", err?.message || err);
      else console.log("[backend] MQTT subscribed: pillnow/+/status");
    });
  } catch (e) {
    console.warn("[backend] MQTT subscribe exception (status):", e?.message || e);
  }
});
mqttClient.on("reconnect", () => {
  console.log("[backend] MQTT reconnecting...");
});
mqttClient.on("error", (err) => {
  console.warn("[backend] MQTT error:", err?.message || err);
});

// Track last published capture timestamp per container/device to suppress duplicates
const lastCaptureAt = new Map(); // key -> timestamp (ms)

// Simple in-memory metrics (transient)
const metrics = {
  capturesPublished: 0,
  capturesSuppressed: 0,
  alarmTriggers: 0,
  postStops: 0,
  triggerRequests: 0,
};

function publishCmd(deviceId, payload) {
  const topic = `pillnow/${deviceId}/cmd`;
  const msg = JSON.stringify(payload);

  // Check if MQTT client is connected
  if (!mqttClient.connected) {
    console.error(`[backend] ❌ MQTT NOT CONNECTED - Cannot publish to ${topic}`);
    console.error(`[backend] MQTT connection status: ${mqttClient.connected}`);
    return false;
  }

  // Suppress near-duplicate capture publishes to avoid double-capture when both app and bridge
  // request a capture around the same time. Only applies to payload.action === 'capture'.
  if (payload && payload.action === 'capture') {
    const key = payload.container || deviceId || 'unknown';
    const last = lastCaptureAt.get(key) || 0;
    const now = Date.now();
    if (now - last < 3000) {
      console.log(`[backend] ⏭️ Suppressing duplicate capture publish for ${key} (last: ${now - last}ms ago)`);
      metrics.capturesSuppressed = (metrics.capturesSuppressed || 0) + 1;
      return true; // treat as OK since a capture was recently requested
    }
    lastCaptureAt.set(key, now);
    console.log(`[backend] ⏱️ Setting lastCaptureAt for ${key} = ${now}`);
  }

  console.log(`[backend] 📤 Publishing MQTT message:`);
  console.log(`[backend]    Topic: ${topic}`);
  console.log(`[backend]    Payload: ${msg}`);

  try {
    mqttClient.publish(topic, msg, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[backend] ❌ MQTT publish failed for ${topic}:`, err?.message || err);
      } else {
        console.log(`[backend] ✅ MQTT message published successfully to ${topic}`);
        // increment capturesPublished only for capture messages
        try {
          const p = JSON.parse(msg || '{}');
          if (p && p.action === 'capture') metrics.capturesPublished = (metrics.capturesPublished || 0) + 1;
        } catch (e) {
          // ignore
        }
      }
    });
    return true;
  } catch (e) {
    console.error(`[backend] ❌ MQTT publish exception for ${topic}:`, e?.message || e);
    return false;
  }
}

async function sendEmail({ to, subject, text }) {
  if (!EMAIL_ENABLED) return false;
  if (!nodemailer) {
    console.warn("[backend] EMAIL_ENABLED=true but nodemailer is not installed. Run npm install.");
    return false;
  }
  const finalTo = String(to || EMAIL_TO || "").trim();
  if (!finalTo || !EMAIL_FROM || !EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    console.warn("[backend] Email not configured. Set EMAIL_FROM, EMAIL_HOST, EMAIL_USER, EMAIL_PASS and either EMAIL_TO or per-container notify_email.");
    return false;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: finalTo,
      subject: String(subject || ""),
      text: String(text || ""),
    });
    return true;
  } catch (e) {
    console.warn("[backend] Failed to send email:", e?.message || e);
    return false;
  }
}

function maskEmail(email) {
  const s = String(email || "");
  const [user, domain] = s.split("@");
  if (!user || !domain) return s;
  const shown = user.length <= 2 ? user[0] || "*" : `${user[0]}${"*".repeat(Math.max(1, user.length - 2))}${user[user.length - 1]}`;
  return `${shown}@${domain}`;
}

async function fetchUserEmailByPhoneFromCloud(phone) {
  const phoneTrimmed = String(phone || "").trim();
  if (!phoneTrimmed) return null;
  const base = "https://pillnow-database.onrender.com";
  const candidates = [
    `${base}/api/users/phone/${encodeURIComponent(phoneTrimmed)}`,
    `${base}/api/users/phone/${encodeURIComponent(phoneTrimmed)}?role=2`,
    `${base}/api/users/elder/${encodeURIComponent(phoneTrimmed)}`,
    `${base}/api/users?phone=${encodeURIComponent(phoneTrimmed)}&role=2`,
    `${base}/api/users?phone=${encodeURIComponent(phoneTrimmed)}`,
  ];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { method: "GET" });
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => null);
      const email =
        data?.email ||
        data?.user?.email ||
        data?.data?.email ||
        data?.data?.user?.email ||
        data?.elder?.email ||
        (Array.isArray(data?.data) ? data.data?.[0]?.email : null) ||
        (Array.isArray(data) ? data?.[0]?.email : null);
      if (email && String(email).includes("@")) return String(email).trim().toLowerCase();
    } catch {
      // try next
    }
  }
  return null;
}

function makeOtp6() {
  // 6 digits
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

function makeResetToken() {
  return crypto.randomBytes(16).toString("hex");
}

// --- Express app ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve captures for quick inspection (optional)
app.use("/captures", express.static(CAPTURES_DIR));

// Endpoint: list captures (most recent first)
app.get('/captures/list', (req, res) => {
  try {
    const files = fs.readdirSync(CAPTURES_DIR).map((name) => {
      const stat = fs.statSync(path.join(CAPTURES_DIR, name));
      return { name, mtime: stat.mtimeMs, size: stat.size, url: `/captures/${encodeURIComponent(name)}` };
    }).sort((a, b) => b.mtime - a.mtime);
    return res.json({ ok: true, files });
  } catch (e) {
    console.warn('[backend] Failed to list captures:', e?.message || e);
    return res.status(500).json({ ok: false, message: 'Failed to list captures' });
  }
});

// Endpoint: latest capture for a container (raw + annotated if available)
app.get('/captures/latest/:container', (req, res) => {
  try {
    const container = normalizeContainerId(req.params.container);
    const all = fs.readdirSync(CAPTURES_DIR);
    // Raw files follow pattern: device_container_ts.jpg (e.g., container1_container1_1766...)
    const rawMatches = all.filter(n => n.includes(`_${container}_`)).map((name) => ({ name, mtime: fs.statSync(path.join(CAPTURES_DIR, name)).mtimeMs }));
    rawMatches.sort((a,b) => b.mtime - a.mtime);
    const latestRaw = rawMatches[0] ? rawMatches[0].name : null;
    // Annotated images include 'annotated_' prefix; pick the most recent annotated file
    const annotatedMatches = all.filter(n => n.startsWith('annotated_')).map((name) => ({ name, mtime: fs.statSync(path.join(CAPTURES_DIR, name)).mtimeMs }));
    annotatedMatches.sort((a,b) => b.mtime - a.mtime);
    const latestAnnotated = annotatedMatches[0] ? annotatedMatches[0].name : null;
    return res.json({ ok: true, latest: { raw: latestRaw ? `/captures/${encodeURIComponent(latestRaw)}` : null, annotated: latestAnnotated ? `/captures/${encodeURIComponent(latestAnnotated)}` : null } });
  } catch (e) {
    console.warn('[backend] Failed to get latest capture:', e?.message || e);
    return res.status(500).json({ ok: false, message: 'Failed to get latest capture' });
  }
});

// Rate limit capture triggers (avoid spamming devices)
// Increased limit to allow pre/post alarm captures and multiple containers
const triggerLimiter = rateLimit({
  windowMs: 10_000, // 10 second window (increased from 5s)
  limit: 10, // 10 requests per 10 seconds (increased from 3 per 5s)
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
  keyGenerator: (req) => {
    const cid = normalizeContainerId(req.params?.containerId || req.body?.container_id || "unknown");
    const ip = ipKeyGenerator(req);
    return `${ip}|${cid}`;
  },
  // Custom handler to provide better error message
  handler: (req, res) => {
    const retryAfter = Math.ceil(triggerLimiter.windowMs / 1000);
    res.status(429).json({ 
      success: false, 
      message: `Too many requests, please try again later. Rate limit: ${triggerLimiter.limit} requests per ${retryAfter} seconds.`,
      retryAfter 
    });
  },
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/test", (_req, res) => res.json({ ok: true, mqtt: mqttClient.connected, verifier: VERIFIER_URL }));

/**
 * GET /current-ip
 * Returns the current Mac IP address for automatic backend URL configuration
 */
app.get("/current-ip", (req, res) => {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let ip = null;
    
    // Find the primary network interface (usually en0 on Mac)
    // Try en0 first (primary WiFi on Mac), then en1, then any en* interface
    const interfaceNames = Object.keys(interfaces || {});
    const primaryInterface = interfaceNames.find(name => 
      name.startsWith('en') && !name.includes('bridge') && !name.includes('loopback')
    ) || interfaceNames.find(name => name.startsWith('en')) || interfaceNames[0];
    
    if (primaryInterface && interfaces[primaryInterface]) {
      const ifaceList = Array.isArray(interfaces[primaryInterface]) 
        ? interfaces[primaryInterface] 
        : [interfaces[primaryInterface]];
      
      for (const iface of ifaceList) {
        // Handle both 'IPv4' and 4 (numeric family code)
        const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
        if (isIPv4 && !iface.internal) {
          ip = iface.address;
          break;
        }
      }
    }
    
    // Fallback: try all interfaces if primary didn't work
    if (!ip) {
      for (const name of interfaceNames) {
        if (name.includes('loopback') || name.includes('bridge')) continue;
        const ifaceList = Array.isArray(interfaces[name]) ? interfaces[name] : [interfaces[name]];
        for (const iface of ifaceList) {
          const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
          if (isIPv4 && !iface.internal) {
            ip = iface.address;
            break;
          }
        }
        if (ip) break;
      }
    }
    
    if (ip) {
      return res.json({ 
        ok: true, 
        ip, 
        backend_url: `http://${ip}:${PORT}`,
        port: PORT 
      });
    } else {
      // Last resort: try to get from req connection (might be localhost though)
      const reqIp = req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
      if (reqIp && reqIp !== '127.0.0.1' && reqIp !== '::1') {
        return res.json({ 
          ok: true, 
          ip: reqIp, 
          backend_url: `http://${reqIp}:${PORT}`,
          port: PORT,
          note: 'Using request IP (may not be accurate)'
        });
      }
      return res.status(500).json({ ok: false, message: 'Could not detect IP address', interfaces: interfaceNames });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, message: String(e?.message || e) });
  }
});

/**
 * GET /alarm-events
 * Returns recent alarm and mismatch events for app polling (fallback when Bluetooth unavailable)
 * Query params: since (timestamp in ms) - only return events after this time
 */
app.get("/alarm-events", (req, res) => {
  const since = parseInt(String(req.query.since || '0')) || 0;
  const events = [];
  
  // Get recent alarm triggers (from firedKeys)
  const now = Date.now();
  const recentWindow = 60000; // 1 minute window
  
  // Check for alarms that fired recently
  for (const [key, firedAt] of firedKeys.entries()) {
    if (firedAt > since && firedAt > now - recentWindow) {
      const match = key.match(/^(container\d+)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})$/);
      if (match) {
        events.push({
          type: 'alarm_triggered',
          container: match[1],
          date: match[2],
          time: match[3],
          timestamp: firedAt
        });
      }
    }
  }
  
  // Get recent pill mismatches (from notifications)
  if (state.notifications) {
    for (const note of state.notifications) {
      if (note.timestamp && new Date(note.timestamp).getTime() > since) {
        if (note.type === 'pill_mismatch' || (note.message && note.message.includes('mismatch'))) {
          events.push({
            type: 'pill_mismatch',
            container: note.container || 'unknown',
            data: note,
            timestamp: new Date(note.timestamp).getTime()
          });
        }
      }
    }
  }
  
  // Sort by timestamp (newest first)
  events.sort((a, b) => b.timestamp - a.timestamp);
  
  return res.json({ ok: true, events, count: events.length });
});
app.get('/metrics', (_req, res) => res.json({ ok: true, metrics }));

/**
 * GET /cameras
 * Diagnostic endpoint to tell whether ESP32-CAMs are online (based on MQTT status heartbeats).
 */
app.get("/cameras", (_req, res) => {
  const now = Date.now();
  const status = state.cameraStatus || {};
  const out = {};
  for (const id of ["container1", "container2", "container3"]) {
    const s = status[id];
    const lastSeenMs = s?.lastSeenMs || 0;
    const ageMs = lastSeenMs ? now - lastSeenMs : null;
    out[id] = {
      online: typeof ageMs === "number" ? ageMs < 30000 : false,
      lastSeenIso: s?.lastSeenIso || null,
      ageMs,
      payload: s?.payload || null,
    };
  }
  return res.json({ ok: true, cameras: out });
});

function isValidEmail(email) {
  const s = String(email || "").trim();
  // simple check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function fetchUserByEmailFromCloud(email) {
  const e = String(email || "").trim();
  const eLower = e.toLowerCase();
  if (!e) return null;
  const base = "https://pillnow-database.onrender.com";
  const candidates = [
    `${base}/api/users?email=${encodeURIComponent(e)}`,
    `${base}/api/users?email=${encodeURIComponent(eLower)}`,
    `${base}/api/users/email/${encodeURIComponent(e)}`,
    `${base}/api/users/email/${encodeURIComponent(eLower)}`,
    `${base}/api/users/email/${encodeURIComponent(e)}`,
    `${base}/api/users/user?email=${encodeURIComponent(e)}`,
    `${base}/api/users/user?email=${encodeURIComponent(eLower)}`,
    `${base}/api/users/find-by-email?email=${encodeURIComponent(e)}`,
    `${base}/api/users/find-by-email?email=${encodeURIComponent(eLower)}`,
    `${base}/api/users/check-email?email=${encodeURIComponent(e)}`,
    `${base}/api/users/check-email?email=${encodeURIComponent(eLower)}`,
  ];

  const findUserWithEmail = (node) => {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findUserWithEmail(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof node === "object") {
      const nodeEmail = node.email ? String(node.email).trim().toLowerCase() : "";
      if (nodeEmail && nodeEmail === eLower) return node;
      // Common wrappers
      const wrappers = ["user", "data", "result", "payload", "users", "elders"];
      for (const k of wrappers) {
        if (node[k]) {
          const found = findUserWithEmail(node[k]);
          if (found) return found;
        }
      }
      // Scan all keys (last resort)
      for (const v of Object.values(node)) {
        const found = findUserWithEmail(v);
        if (found) return found;
      }
    }
    return null;
  };

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { method: "GET" });
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => null);
      const found = findUserWithEmail(data);
      if (found) {
        console.log(`[backend] password-reset email lookup hit: ${url} -> found ${maskEmail(found.email)}`);
        return found;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function extractPhoneFromUser(user) {
  const phone =
    user?.phone ||
    user?.contactNumber ||
    user?.phoneNumber ||
    user?.contact_number ||
    user?.contact_number ||
    user?.data?.phone ||
    user?.data?.contactNumber;
  return phone ? String(phone).trim() : "";
}

/**
 * Password reset via EMAIL OTP (local backend).
 * Supports:
 * - request by email (preferred): { email }
 * - request by phone (legacy): { phone } (looks up email by phone)
 */
app.post("/api/password-reset/request-otp-email", async (req, res) => {
  try {
    console.log("[backend][password-reset] request-otp-email", {
      hasEmail: Boolean(req.body?.email),
      hasPhone: Boolean(req.body?.phone),
    });
    const emailInput = String(req.body?.email || "").trim().toLowerCase();
    const phoneInput = String(req.body?.phone || "").trim();
    if (!emailInput && !phoneInput) {
      return res.status(400).json({ success: false, message: "email is required" });
    }
    if (!EMAIL_ENABLED) return res.status(400).json({ success: false, message: "Email is not enabled on the local backend." });

    let email = "";
    let phone = "";
    if (emailInput) {
      if (!isValidEmail(emailInput)) {
        return res.status(400).json({ success: false, message: "Invalid email format." });
      }
      // Prefer phone-based verification when phone is provided: it is more reliable than email lookup
      // (some cloud APIs don't allow unauthenticated email search).
      if (phoneInput) {
        const emailFromPhone = await fetchUserEmailByPhoneFromCloud(phoneInput);
        if (!emailFromPhone) {
          return res.status(404).json({ success: false, message: "No account found for that phone number." });
        }
        if (String(emailFromPhone).trim().toLowerCase() !== emailInput) {
          return res.status(400).json({
            success: false,
            message: "Email does not match the account for that phone number. Please check and try again.",
          });
        }
        email = emailInput;
        phone = phoneInput;
      } else {
        // Fallback: try email lookup (may not work depending on cloud API)
        const user = await fetchUserByEmailFromCloud(emailInput);
        if (!user) {
          return res.status(404).json({
            success: false,
            message: "No account found for that email. If you have an account, also enter your phone number to verify.",
          });
        }
        email = emailInput;
        phone = extractPhoneFromUser(user) || "";
      }
    } else {
      phone = phoneInput;
      email = await fetchUserEmailByPhoneFromCloud(phone);
      if (!email) return res.status(404).json({ success: false, message: "No account email found for that phone number." });
    }

    const key = email || phone;
    const entry = state.passwordResets?.[key] || {};
    const now = Date.now();
    if (entry.lastSentAt && now - entry.lastSentAt < 60_000) {
      const wait = Math.ceil((60_000 - (now - entry.lastSentAt)) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${wait}s before requesting another OTP.` });
    }

    const otp = makeOtp6();
    const salt = crypto.randomBytes(8).toString("hex");
    const otpHash = hashOtp(otp, salt);
    const otpExp = now + 10 * 60_000; // 10 minutes

    state.passwordResets[key] = {
      phone,
      email,
      otpHash,
      otpSalt: salt,
      otpExp,
      otpAttempts: 0,
      lastSentAt: now,
      resetToken: "",
      resetTokenExp: 0,
    };
    saveStateSoon();

    const ok = await sendEmail({
      to: email,
      subject: "PillNow Password Reset Code",
      text: `Your PillNow password reset code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you did not request this, ignore this email.`,
    });
    if (!ok) return res.status(500).json({ success: false, message: "Failed to send OTP email. Check SMTP settings." });

    console.log("[backend][password-reset] OTP email sent", { to: maskEmail(email), key });
    return res.json({ success: true, message: "OTP sent to email.", email: maskEmail(email) });
  } catch (e) {
    console.warn("[backend][password-reset] request-otp-email error:", e?.message || e);
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
});

app.post("/api/password-reset/verify-otp-email", async (req, res) => {
  try {
    console.log("[backend][password-reset] verify-otp-email", {
      hasEmail: Boolean(req.body?.email),
      hasPhone: Boolean(req.body?.phone),
    });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const otp = String(req.body?.otp || "").trim();
    if (!otp) return res.status(400).json({ success: false, message: "otp is required" });
    const key = email || phone;
    if (!key) return res.status(400).json({ success: false, message: "email is required" });

    const entry = state.passwordResets?.[key];
    if (!entry?.otpHash || !entry?.otpSalt || !entry?.otpExp) {
      return res.status(400).json({ success: false, message: "No OTP request found. Please request a new code." });
    }
    const now = Date.now();
    if (now > entry.otpExp) {
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new code." });
    }

    entry.otpAttempts = Number(entry.otpAttempts || 0) + 1;
    if (entry.otpAttempts > 5) {
      saveStateSoon();
      return res.status(429).json({ success: false, message: "Too many attempts. Please request a new code." });
    }

    const expectedHash = hashOtp(otp, entry.otpSalt);
    if (expectedHash !== entry.otpHash) {
      saveStateSoon();
      return res.status(400).json({ success: false, message: "Invalid code." });
    }

    // Issue a short-lived reset token
    const token = makeResetToken();
    entry.resetToken = token;
    entry.resetTokenExp = now + 15 * 60_000; // 15 minutes
    // Invalidate OTP after successful verification
    entry.otpHash = "";
    entry.otpSalt = "";
    entry.otpExp = 0;
    saveStateSoon();

    console.log("[backend][password-reset] OTP verified", { key });
    return res.json({ success: true, message: "OTP verified.", resetToken: token });
  } catch (e) {
    console.warn("[backend][password-reset] verify-otp-email error:", e?.message || e);
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
});

app.post("/api/password-reset/reset-with-token", async (req, res) => {
  try {
    console.log("[backend][password-reset] reset-with-token", {
      hasEmail: Boolean(req.body?.email),
      hasPhone: Boolean(req.body?.phone),
    });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const resetToken = String(req.body?.resetToken || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: "resetToken and newPassword are required" });
    }

    const key = email || phone;
    if (!key) return res.status(400).json({ success: false, message: "email is required" });
    const entry = state.passwordResets?.[key];
    const now = Date.now();
    if (!entry?.resetToken || entry.resetToken !== resetToken || !entry.resetTokenExp || now > entry.resetTokenExp) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token. Please restart the forgot password flow." });
    }
    const phoneToUse = String(entry.phone || phone || "").trim();
    if (!phoneToUse) {
      return res.status(400).json({ success: false, message: "This account has no phone number on record. Contact support." });
    }

    // Call cloud API to actually reset password
    const cloudResp = await fetch("https://pillnow-database.onrender.com/api/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneToUse, newPassword }),
    });
    const text = await cloudResp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }

    if (!cloudResp.ok || (json && json.success === false)) {
      return res.status(502).json({ success: false, message: json?.message || `Cloud reset-password failed (${cloudResp.status})`, detail: text });
    }

    // One-time token: clear entry
    delete state.passwordResets[key];
    saveStateSoon();
    console.log("[backend][password-reset] password reset success", { key });
    return res.json({ success: true, message: "Password reset successfully." });
  } catch (e) {
    console.warn("[backend][password-reset] reset-with-token error:", e?.message || e);
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
});

/**
 * Save per-container schedule + pill config.
 * Body: { container_id: "container1", pill_config: {count,label?}, times: ["HH:MM", ...] }
 */
app.post("/set-schedule", (req, res) => {
  const containerId = normalizeContainerId(req.body?.container_id);
  const pill_config = req.body?.pill_config || {};
  const timesInput = req.body?.times;
  const schedulesInput = req.body?.schedules;
  const notifyEmailInput = req.body?.notify_email;

  if (!containerId) {
    return res.status(400).json({ ok: false, message: "container_id is required" });
  }

  const prev = state.containers[containerId] || { pill_config: { count: 0 }, times: [], schedules: [], notify_email: "" };

  // If a client passes `times: []` just to update pill_config (e.g. ModifyScheduleScreen),
  // we preserve existing times by default. To explicitly clear times, send `replace_times: true`.
  let nextTimes = prev.times || [];
  const replaceTimes = Boolean(req.body?.replace_times);
  if (Array.isArray(timesInput)) {
    if (timesInput.length > 0 || replaceTimes) {
      nextTimes = timesInput
        .map((t) => String(t).trim())
        .filter(Boolean)
        .map((t) => normalizeHhMm(t))
        .filter(Boolean);
    }
  }

  // Date-aware schedules: preserve if not provided (or empty without replace_schedules).
  let nextSchedules = Array.isArray(prev.schedules) ? prev.schedules : [];
  const replaceSchedules = Boolean(req.body?.replace_schedules);
  if (Array.isArray(schedulesInput)) {
    if (schedulesInput.length > 0 || replaceSchedules) {
      nextSchedules = schedulesInput
        .map((s) => ({
          date: normalizeYyyyMmDd(s?.date),
          time: normalizeHhMm(s?.time),
        }))
        .filter((s) => Boolean(s.date) && Boolean(s.time));
    }
  }

  const nextPillConfig = {
    count: Number(pill_config?.count ?? prev.pill_config?.count ?? 0),
    ...(typeof pill_config?.label === "string" && pill_config.label.trim()
      ? { label: pill_config.label.trim() }
      : prev.pill_config?.label
        ? { label: prev.pill_config.label }
        : {}),
  };

  const nextNotifyEmail =
    typeof notifyEmailInput === "string" && notifyEmailInput.trim()
      ? notifyEmailInput.trim().toLowerCase()
      : prev.notify_email || "";

  state.containers[containerId] = {
    pill_config: nextPillConfig,
    times: nextTimes,
    schedules: nextSchedules,
    notify_email: nextNotifyEmail,
  };
  saveStateSoon();

  console.log(`[backend] set-schedule: ${containerId}`, state.containers[containerId]);
  return res.json({ ok: true, container_id: containerId, ...state.containers[containerId] });
});

/**
 * POST /sync-schedules-from-database
 * Syncs schedules from the database to backend state.containers for alarm firing
 * This ensures alarms work even after backend restart
 */
app.post("/sync-schedules-from-database", async (req, res) => {
  try {
    const base = "https://pillnow-database.onrender.com";
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body?.token;
    
    // Fetch all schedules from database
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Build URL with query parameters if provided (for caregivers/elders)
    let schedulesUrl = `${base}/api/medication_schedules`;
    const elderId = req.body?.elderId || req.query?.elderId;
    const userId = req.body?.userId || req.query?.userId;
    
    if (elderId) {
      schedulesUrl += `?elderId=${elderId}`;
    } else if (userId) {
      schedulesUrl += `?userId=${userId}`;
    }
    
    const response = await fetch(schedulesUrl, { headers });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[backend] Database fetch failed (${response.status}): ${errorText}`);
      return res.status(response.status).json({ ok: false, message: `Database fetch failed: ${response.status} - ${errorText}` });
    }
    
    const data = await response.json();
    const allSchedules = Array.isArray(data) ? data : (data?.data || []);
    
    console.log(`[backend] 🔄 Syncing ${allSchedules.length} schedule(s) from database to state.containers...`);
    
    // Group schedules by container and user
    const containerMap = new Map(); // containerId -> { schedules: [], pill_config: {}, notify_email: "" }
    
    for (const schedule of allSchedules) {
      // CRITICAL: normalize container field from database to a stable 1–3 index
      // Supports numeric, "container2", "morning"/"noon"/"evening", etc.
      const containerNum = normalizeContainerNumber(schedule.container);
      const containerId = `container${containerNum}`;
      
      if (!containerMap.has(containerId)) {
        // Get existing state or initialize
        const existing = state.containers[containerId] || { pill_config: { count: 0 }, times: [], schedules: [], notify_email: "" };
        containerMap.set(containerId, {
          pill_config: existing.pill_config,
          schedules: [],
          notify_email: existing.notify_email,
        });
      }
      
      const container = containerMap.get(containerId);
      
      // Add schedule if it has date and time
      if (schedule.date && schedule.time) {
        container.schedules.push({
          date: normalizeYyyyMmDd(schedule.date),
          time: normalizeHhMm(schedule.time),
        });
      }
      
      // Update pill_config from medication if available
      if (schedule.medication) {
        // Try to fetch medication details
        try {
          const medResponse = await fetch(`${base}/api/medications/${schedule.medication}`, { headers });
          if (medResponse.ok) {
            const med = await medResponse.json();
            if (med?.name) {
              container.pill_config = {
                count: container.pill_config?.count || 1,
                label: med.name,
              };
            }
          }
        } catch (e) {
          // Ignore medication fetch errors
        }
      }
    }
    
    // Update state.containers with synced data
    let syncedCount = 0;
    for (const [containerId, data] of containerMap.entries()) {
      state.containers[containerId] = {
        pill_config: data.pill_config,
        times: [], // Legacy format - not used if schedules are present
        schedules: data.schedules,
        notify_email: data.notify_email,
      };
      syncedCount++;
      console.log(`[backend] ✅ Synced ${data.schedules.length} schedule(s) for ${containerId}`);
    }
    
    saveStateSoon();
    
    return res.json({ 
      ok: true, 
      synced_containers: syncedCount,
      total_schedules: allSchedules.length,
      containers: Object.keys(state.containers),
    });
  } catch (e) {
    console.error('[backend] Error syncing schedules from database:', e);
    return res.status(500).json({ ok: false, message: String(e?.message || e) });
  }
});

/**
 * Get stored pill config for a container (used by AlarmModal + MonitorManageScreen).
 */
app.get("/get-pill-config/:containerId", (req, res) => {
  const containerId = normalizeContainerId(req.params.containerId);
  
  // Validate container ID (must be container1, container2, or container3)
  if (!containerId || !containerId.startsWith('container') || !['container1', 'container2', 'container3'].includes(containerId)) {
    return res.status(400).json({ ok: false, message: `Invalid container ID: ${containerId}. Must be container1, container2, or container3.` });
  }
  
  const cfg = state.containers[containerId];
  if (!cfg) return res.status(404).json({ ok: false, message: "No config for container" });
  return res.json({
    ok: true,
    container_id: containerId,
    pill_config: cfg.pill_config,
    times: cfg.times,
    schedules: cfg.schedules || [],
    notify_email: cfg.notify_email || "",
  });
});

/**
 * Trigger capture for a container.
 * POST /trigger-capture/:containerId
 * Body: { expected?: {count,label?}, deviceId?: string }
 */
app.post("/trigger-capture/:containerId", triggerLimiter, (req, res) => {
  const containerId = normalizeContainerId(req.params.containerId);
  const deviceId = req.body?.deviceId ? normalizeContainerId(req.body.deviceId) : resolveDeviceId(containerId);

  const expectedFromBody = req.body?.expected;
  const expectedFromState = state.containers?.[containerId]?.pill_config;
  const expected = expectedFromBody || expectedFromState || { count: 0 };

  const published = publishCmd(deviceId, {
    action: "capture",
    container: containerId,
    expected,
  });
  metrics.triggerRequests = (metrics.triggerRequests || 0) + 1;

  console.log(`[backend] trigger-capture: device=${deviceId} container=${containerId} expected=${JSON.stringify(expected)} publish_ok=${Boolean(published)}`);

  if (!published) {
    const note = { type: 'error', message: `MQTT not connected - failed to request capture for ${containerId}`, container: containerId, timestamp: new Date().toISOString() };
    state.notifications.push(note);
    saveStateSoon();
    return res.status(502).json({ ok: false, message: 'MQTT not connected' });
  }

  return res.json({ ok: true, message: "Capture requested", deviceId, container: containerId });
});

/**
 * Record a schedule notification (used by MonitorManageScreen for logging).
 * Body: { type, container, message, scheduleId }
 */
app.post("/notifications/schedule", (req, res) => {
  const notif = {
    ...req.body,
    timestamp: new Date().toISOString(),
  };
  state.notifications.push(notif);
  // keep last 200
  if (state.notifications.length > 200) state.notifications = state.notifications.slice(-200);
  saveStateSoon();
  return res.json({ ok: true });
});

/**
 * Latest verification result for a container.
 */
app.get("/containers/:containerId/verification", (req, res) => {
  const containerId = normalizeContainerId(req.params.containerId);
  const v = state.verifications?.[containerId];
  if (!v) return res.status(404).json({ success: false, message: "No verification found" });
  return res.json(v);
});

// --- Ingest (ESP32-CAM upload) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024, // 6MB
  },
});

function parseExpectedFromMeta(metaString) {
  if (!metaString) return {};
  try {
    const obj = JSON.parse(metaString);
    // Support meta wrapping: { expected: {...} }
    if (obj && typeof obj === "object" && obj.expected && typeof obj.expected === "object") {
      return obj.expected;
    }
    return obj;
  } catch {
    return {};
  }
}

/**
 * ESP32-CAM POST /ingest/:deviceId/:container
 * multipart fields:
 * - image: file
 * - meta: JSON string (usually the expected object)
 */
app.post("/ingest/:deviceId/:container", upload.single("image"), async (req, res) => {
  const deviceId = normalizeContainerId(req.params.deviceId);
  const containerId = normalizeContainerId(req.params.container);
  
  // Validate container ID (must be container1, container2, or container3)
  if (!containerId || !containerId.startsWith('container') || !['container1', 'container2', 'container3'].includes(containerId)) {
    return res.status(400).json({ ok: false, message: `Invalid container ID: ${containerId}. Must be container1, container2, or container3.` });
  }
  
  const meta = req.body?.meta;

  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, message: "Missing image file field 'image'" });
  }

  const expectedFromMeta = parseExpectedFromMeta(meta);
  const expectedFromState = state.containers?.[containerId]?.pill_config;
  const expected = Object.keys(expectedFromMeta || {}).length ? expectedFromMeta : expectedFromState || {};

  // Log what we're expecting for this verification
  console.log(`[backend] 📸 Ingest received for ${containerId}`);
  console.log(`[backend] 📊 Expected pill config: count=${expected?.count || 0}, label="${expected?.label || 'none'}"`);
  
  // Save raw capture (optional but useful)
  const ts = Date.now();
  const rawName = `${deviceId}_${containerId}_${ts}.jpg`;
  const rawPath = path.join(CAPTURES_DIR, rawName);
  try {
    fs.writeFileSync(rawPath, req.file.buffer);
    console.log(`[backend] ✅ Raw capture saved to: ${rawPath}`);
  } catch (e) {
    console.warn("[backend] Failed to save raw capture:", e?.message || e);
  }

  // Call FastAPI verifier
  let verifierRespText = "";
  let verifierJson = null;
  try {
    // IMPORTANT: Node's built-in `fetch` expects WHATWG `FormData` from `undici`, not the npm `form-data` package.
    // Using the wrong FormData breaks multipart parsing on FastAPI (400 "error parsing body").
    const form = new FormData();
    const mime = req.file.mimetype || "image/jpeg";
    // undici FormData accepts Blob or File. Convert Buffer to Blob for compatibility.
    // Ensure we have a proper Buffer
    const buffer = Buffer.isBuffer(req.file.buffer) ? req.file.buffer : Buffer.from(req.file.buffer);
    const imageBlob = new Blob([buffer], { type: mime });
    form.append("image", imageBlob, rawName);
    form.append("expected", JSON.stringify(expected || {}));

    const vr = await fetch(VERIFIER_URL, { method: "POST", body: form });
    verifierRespText = await vr.text();
    if (!vr.ok) {
      console.warn("[backend] verifier error:", vr.status, verifierRespText);
      return res.status(502).json({ ok: false, message: `Verifier error ${vr.status}` });
    }
    verifierJson = JSON.parse(verifierRespText);
  } catch (e) {
    console.warn("[backend] verifier request failed:", e?.message || e);
    return res.status(502).json({ ok: false, message: "Verifier unreachable", detail: String(e?.message || e) });
  }

  const pass_ = Boolean(verifierJson?.pass_);
  const detectedCount = Number(verifierJson?.count || 0);
  const detectedClasses = Array.isArray(verifierJson?.classesDetected) ? verifierJson.classesDetected : [];
  
  // Log verification results
  console.log(`[backend] 🔍 Verification result for ${containerId}:`);
  console.log(`[backend]    Pass: ${pass_ ? '✅ YES' : '❌ NO'}`);
  console.log(`[backend]    Expected: count=${expected?.count || 0}, label="${expected?.label || 'none'}"`);
  console.log(`[backend]    Detected: count=${detectedCount}, classes=[${detectedClasses.map(c => `${c.label}(${c.n})`).join(', ')}]`);
  console.log(`[backend]    Confidence: ${(Number(verifierJson?.confidence || 0) * 100).toFixed(1)}%`);
  
  const resultPayload = {
    pass_,
    count: detectedCount,
    classesDetected: detectedClasses,
    confidence: Number(verifierJson?.confidence || 0),
    annotatedImagePath: verifierJson?.annotatedImagePath || null,
    knnVerification: verifierJson?.knnVerification || null,
    // extra fields used by the RN app for display fallbacks
    expected,
    expectedLabel: expected?.label || expected?.pill || expected?.pillType || expected?.pill_name || null,
  };

  // If the verifier returned an annotated image path, make sure it is available under CAPTURES_DIR and expose a web path
  try {
    if (verifierJson?.annotatedImagePath) {
      const annPath = String(verifierJson.annotatedImagePath);
      const annBase = path.basename(annPath);
      const target = path.join(CAPTURES_DIR, annBase);
      if (!fs.existsSync(target) && fs.existsSync(annPath)) {
        fs.copyFileSync(annPath, target);
        console.log(`[backend] Copied annotated image to captures dir: ${target}`);
      }
      // Prefer web-accessible path
      resultPayload.annotatedImagePath = fs.existsSync(target) ? `/captures/${encodeURIComponent(annBase)}` : `/captures/${encodeURIComponent(path.basename(String(verifierJson.annotatedImagePath)))}`;
    }
  } catch (e) {
    console.warn('[backend] Failed to ensure annotated image is in captures dir:', e?.message || e);
  }

  const payload = {
    success: true,
    deviceId,
    container: containerId,
    expected,
    result: resultPayload,
    timestamp: new Date().toISOString(),
    message: "Verified",
  };
  state.verifications[containerId] = payload;
  saveStateSoon();

  // If mismatch (pass_ === false), publish alert so Arduino buzzes (bridge -> PILLALERT)
  if (!pass_) {
    // Store mismatch notification for HTTP polling fallback
    const mismatchNote = {
      type: 'pill_mismatch',
      message: `Pill mismatch detected in ${containerId}. Expected: ${expected?.count || 0} x "${expected?.label || 'none'}", Detected: ${detectedCount} x "${detectedClasses.map(c => c.label).join(', ') || 'none'}"`,
      container: containerId,
      timestamp: new Date().toISOString(),
      data: {
        expected,
        detected: detectedClasses,
        count: detectedCount,
        annotatedImagePath: resultPayload.annotatedImagePath,
      }
    };
    state.notifications.push(mismatchNote);
    // Keep only last 50 notifications to prevent memory bloat
    if (state.notifications.length > 50) {
      state.notifications = state.notifications.slice(-50);
    }
    saveStateSoon();
    
    const expectedLabel = expected?.label || 'unknown';
    const detectedLabels = resultPayload.classesDetected.map(c => c.label).join(', ') || 'none';
    
    console.log(`[backend] 🚨🚨🚨 PILL MISMATCH DETECTED for ${containerId} 🚨🚨🚨`);
    console.log(`[backend]    Expected: ${expected?.count || 0} x "${expectedLabel}"`);
    console.log(`[backend]    Detected: ${resultPayload.count} x "${detectedLabels}"`);
    console.log(`[backend]    Reason: ${expected?.count !== resultPayload.count ? 'COUNT mismatch' : 'TYPE mismatch'}`);
    
    publishCmd(deviceId, {
      action: "alert",
      reason: "pill_mismatch",
      container: containerId,
      expected,
      detected: resultPayload.classesDetected,
      count: resultPayload.count,
      annotatedImagePath: resultPayload.annotatedImagePath,
    });
    console.log(`[backend] 📤 PILLALERT published for ${containerId}`);

    // Optional email alert
    const to = state.containers?.[containerId]?.notify_email || EMAIL_TO;
    sendEmail({
      to,
      subject: `PillNow ALERT: Pill mismatch in ${containerId}`,
      text: `Mismatch detected in ${containerId}\n\nExpected: ${JSON.stringify(expected)}\nDetected: ${JSON.stringify(resultPayload.classesDetected)}\nCount: ${resultPayload.count}\n\nAnnotated: ${resultPayload.annotatedImagePath || "N/A"}`,
    }).catch(() => {});
  }

  return res.json({ ok: true, ...payload });
});

/**
 * Debug: Fire schedule for a container immediately (testing only)
 * POST /debug/fire-schedule/:containerId
 * Body: { auto_capture?: boolean }
 */
app.post("/debug/fire-schedule/:containerId", (req, res) => {
  const containerId = normalizeContainerId(req.params.containerId);
  if (!containerId || !state.containers?.[containerId]) {
    return res.status(400).json({ ok: false, message: 'Invalid or missing container_id' });
  }
  const cfg = state.containers[containerId];
  const hhmm = hhmmNowLocal();
  const date = yyyyMmDdLocal();
  console.log(`[backend][debug] Firing schedule for ${containerId} at ${date} ${hhmm}`);

  const alarmPublished = publishCmd(resolveDeviceId(containerId), {
    action: "alarm_triggered",
    container: containerId,
    date,
    time: hhmm,
  });
  if (alarmPublished) metrics.alarmTriggers = (metrics.alarmTriggers || 0) + 1;

  const autoCapture = typeof req.body?.auto_capture === 'boolean' ? req.body.auto_capture : (String(process.env.AUTO_CAPTURE_ON_ALARM || "").toLowerCase() === "true");
  if (autoCapture) {
    const expected = cfg?.pill_config || { count: 0 };
    const capturePublished = publishCmd(resolveDeviceId(containerId), {
      action: "capture",
      container: containerId,
      expected,
    });
    console.log(`[backend][debug] AUTO_CAPTURE requested for ${containerId} (published=${Boolean(capturePublished)})`);
  } else {
    console.log(`[backend][debug] AUTO_CAPTURE not requested for ${containerId}`);
  }

  return res.json({ ok: true, alarmPublished });
});

// --- Alarm scheduler (per container) ---
// IMPROVED: Supports multiple containers at the same time with staggered firing
const firedKeys = new Map(); // key -> timestamp
const lastScheduleLog = new Map(); // key -> lastLogTimestamp (throttle schedule logs)
setInterval(() => {
  const hhmm = hhmmNowLocal();
  const date = yyyyMmDdLocal();

  // Cleanup old keys occasionally (keep map small)
  const keyPruneCutoff = Date.now() - 6 * 60 * 60 * 1000; // 6 hours
  for (const [k, ts] of firedKeys.entries()) {
    if (ts < keyPruneCutoff) firedKeys.delete(k);
  }
  if (firedKeys.size > 500) {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const [k, ts] of firedKeys.entries()) {
      if (ts < cutoff) firedKeys.delete(k);
    }
  }
  // Also prune lastScheduleLog entries older than 6 hours to avoid growth
  const scheduleLogPruneCutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [k, ts] of lastScheduleLog.entries()) {
    if (ts < scheduleLogPruneCutoff) lastScheduleLog.delete(k);
  }

  // Collect all containers that need to fire at this time
  // IMPORTANT: Works for ALL containers (container1, container2, container3)
  const containersToFire = [];
  for (const [containerId, cfg] of Object.entries(state.containers || {})) {
    // Validate container ID format (container1, container2, container3)
    if (!containerId || !containerId.startsWith('container')) {
      console.warn(`[backend] ⚠️ Skipping invalid container ID: ${containerId}`);
      continue;
    }

    const times = getTimesForToday(cfg, date);

    // Enhanced logging for debugging (throttled: once per minute per unique schedule)
    if (times.length > 0) {
      const schedLogKey = `${containerId}|${date}|${times.join(',')}`;
      const last = lastScheduleLog.get(schedLogKey) || 0;
      if (Date.now() - last > 60_000) { // log at most once per minute per schedule
        console.log(`[backend] 📅 Container ${containerId} has ${times.length} schedule(s) for ${date}: ${times.join(', ')}`);
        lastScheduleLog.set(schedLogKey, Date.now());
      }
      // Only print a light check message (avoid noisy logs each second)
      // console.log(`[backend] 🔍 Checking if ${hhmm} matches any schedule...`);
    }

    if (!times.includes(hhmm)) continue;

    const key = `${containerId}|${date}|${hhmm}`;
    const firedAt = firedKeys.get(key);
    const now = Date.now();

    // If we've fired recently (within 2 minutes), skip silently to avoid log spam
    if (firedAt && now - firedAt < 2 * 60 * 1000) {
      // Still within suppression window — skip
      continue;
    }

    // If firedAt exists but is expired, allow firing again (informational log)
    if (firedAt && now - firedAt >= 2 * 60 * 1000) {
      console.log(`[backend] ♻️ Previous alarm ${key} expired after ${Math.round((now - firedAt)/1000)}s — re-firing`);
      firedKeys.delete(key);
    }

    console.log(`[backend] ✅ Container ${containerId} scheduled for ${hhmm} - adding to fire list`);
    containersToFire.push({ containerId, cfg, key });
  }

  // If multiple containers fire at the same time, stagger them by 500ms each
  // This helps Arduino and app handle them properly in queue order
  // EXAMPLE: If 3 containers (container1, container2, container3) all fire at 14:00:
  //   - container1 fires at 0ms (immediate)
  //   - container2 fires at 500ms (0.5s delay)
  //   - container3 fires at 1000ms (1s delay)
  // This prevents overwhelming the MQTT bridge and allows the app to queue alarms properly
  if (containersToFire.length > 1) {
    console.log(`[backend] 🔔 MULTIPLE CONTAINERS FIRING AT SAME TIME: ${containersToFire.length} containers scheduled for ${hhmm}`);
    console.log(`[backend] 📋 Containers: ${containersToFire.map(c => c.containerId).join(', ')}`);
    console.log(`[backend] ⏱️ Staggering alarms by 500ms each to prevent overwhelming...`);
  }

  // Optional: environment toggle to request an automatic capture when an alarm fires
  const AUTO_CAPTURE_ON_ALARM = String(process.env.AUTO_CAPTURE_ON_ALARM || "").toLowerCase() === "true";
  const AUTO_CAPTURE_DELAY_MS = Number(process.env.AUTO_CAPTURE_DELAY_MS || 5000);

  containersToFire.forEach(({ containerId, cfg, key }, index) => {
    const delay = index * 500; // 0ms, 500ms, 1000ms, etc.

    setTimeout(() => {
      firedKeys.set(key, Date.now());

      // PRE-ALARM CAPTURE: Trigger BEFORE alarm fires (if configured)
      // This captures the state BEFORE user takes the pill
      if (AUTO_CAPTURE_ON_ALARM) {
        const expected = cfg?.pill_config || { count: 0 };
        const preCapturePublished = publishCmd(resolveDeviceId(containerId), {
          action: "capture",
          container: containerId,
          expected,
        });
        console.log(`[backend] 📸 PRE-ALARM capture requested for ${containerId} (before alarm fires), published=${Boolean(preCapturePublished)}`);
        if (!preCapturePublished) {
          const note = { type: 'error', message: `PRE-ALARM capture failed (MQTT) for ${containerId}`, container: containerId, timestamp: new Date().toISOString() };
          state.notifications.push(note);
          saveStateSoon();
        }
        // Small delay before alarm to ensure capture completes
        setTimeout(() => {
      // Publish alarm trigger (bridge will forward to Arduino, app will show AlarmModal)
      const alarmPublished = publishCmd(resolveDeviceId(containerId), {
        action: "alarm_triggered",
        container: containerId,
        date,
        time: hhmm,
      });
      console.log(`[backend] ⏰ alarm_triggered published for ${containerId} at ${hhmm} (published=${Boolean(alarmPublished)}) (${containersToFire.length} containers at same time, delay=${delay}ms, position ${index + 1}/${containersToFire.length})`);
        }, 1000); // 1 second delay after pre-capture before alarm fires
      } else {
        // No pre-capture: publish alarm immediately
        const alarmPublished = publishCmd(resolveDeviceId(containerId), {
          action: "alarm_triggered",
            container: containerId,
          date,
          time: hhmm,
          });
        console.log(`[backend] ⏰ alarm_triggered published for ${containerId} at ${hhmm} (published=${Boolean(alarmPublished)}) (${containersToFire.length} containers at same time, delay=${delay}ms, position ${index + 1}/${containersToFire.length})`);
      }

      // Optional email reminder
      const to = cfg?.notify_email || EMAIL_TO;
      sendEmail({
        to,
        subject: `PillNow Reminder: Alarm for ${containerId} (${hhmm})`,
        text: `Medication reminder.\n\nContainer: ${containerId}\nDate: ${date}\nTime: ${hhmm}`,
      }).catch(() => {});
    }, delay);
  });

  // Log if multiple alarms fired together
  if (containersToFire.length > 1) {
    console.log(`[backend] 📊 ${containersToFire.length} containers scheduled for ${hhmm}: ${containersToFire.map(c => c.containerId).join(', ')}`);
  }
}, 1000);

/**
 * POST /alarm/stopped/:containerId
 * Notify backend that an alarm was stopped (e.g., hardware button pressed).
 * Body: { capture?: true|false }
 * If capture not provided, BACKEND's AUTO_CAPTURE_POST_ON_STOP (env) or default true will be used.
 */
app.post('/alarm/stopped/:containerId', async (req, res) => {
  try {
    const containerId = normalizeContainerId(req.params.containerId);
    if (!containerId || !state.containers?.[containerId]) {
      return res.status(400).json({ ok: false, message: 'Invalid container or no config' });
    }

    // Rate-limit repeated stop-triggered captures per container (5s)
    const lastStopKey = `stop|${containerId}`;
    const last = firedKeys.get(lastStopKey);
    const now = Date.now();
    if (last && now - last < 5000) {
      return res.status(429).json({ ok: false, message: 'Too many stop events, throttled' });
    }
    firedKeys.set(lastStopKey, now);

    // Decide whether to capture after stop
    const envPref = String(process.env.AUTO_CAPTURE_POST_ON_STOP || "").toLowerCase();
    const defaultPost = envPref === "true" || envPref === "1" || envPref === "yes";
    const doCapture = typeof req.body?.capture === 'boolean' ? req.body.capture : defaultPost;

    console.log(`[backend] 🛑 Alarm stopped for ${containerId} — post-capture requested=${doCapture}`);

    if (doCapture) {
      const expected = state.containers?.[containerId]?.pill_config || { count: 0 };
      const capturePublished = publishCmd(resolveDeviceId(containerId), {
        action: 'capture',
        container: containerId,
        expected,
      });
      metrics.postStops = (metrics.postStops || 0) + 1;

      if (!capturePublished) {
        const note = { type: 'error', message: `Post-stop capture failed (MQTT) for ${containerId}`, container: containerId, timestamp: new Date().toISOString() };
        state.notifications.push(note);
        saveStateSoon();
        return res.status(502).json({ ok: false, message: 'MQTT not connected' });
      }

      console.log(`[backend] 🤖 Post-stop capture requested for ${containerId}, published=${Boolean(capturePublished)}`);
    }

    return res.json({ ok: true, container: containerId, captureRequested: doCapture });
  } catch (e) {
    console.warn('[backend] /alarm/stopped error:', e?.message || e);
    return res.status(500).json({ ok: false, message: String(e?.message || e) });
  }
});

// Auto-sync schedules from database on startup (non-blocking)
// Note: This will fail without auth, but that's OK - app will sync when it loads schedules
const syncSchedulesOnStartup = async () => {
  try {
    console.log('[backend] 🔄 Auto-syncing schedules from database on startup...');
    const response = await fetch(`http://localhost:${PORT}/sync-schedules-from-database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      const data = await response.json();
      console.log(`[backend] ✅ Auto-sync completed: ${data.synced_containers} container(s), ${data.total_schedules} schedule(s)`);
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      console.warn(`[backend] ⚠️ Auto-sync failed: ${response.status} - ${errorData.message} (app will sync when schedules are loaded)`);
    }
  } catch (e) {
    console.warn('[backend] ⚠️ Auto-sync error (non-critical, app will sync when schedules are loaded):', e?.message || e);
  }
};

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[backend] listening on http://0.0.0.0:${PORT}`);
  console.log(`[backend] MQTT_BROKER_URL=${MQTT_BROKER_URL}`);
  console.log(`[backend] VERIFIER_URL=${VERIFIER_URL}`);
  console.log(`[backend] AUTO_CAPTURE_ON_ALARM=${AUTO_CAPTURE_ON_ALARM}`);
  console.log(`[backend] AUTO_CAPTURE_DELAY_MS=${AUTO_CAPTURE_DELAY_MS}`);
  const singleCam = String(process.env.SINGLE_CAMERA_DEVICE_ID || "").trim();
  if (singleCam) {
    console.log(`[backend] SINGLE_CAMERA_DEVICE_ID=${singleCam}`);
  } else {
    console.log(`[backend] SINGLE_CAMERA_DEVICE_ID not set`);
  }
  
  // Start auto-sync after a short delay to ensure server is ready
  setTimeout(syncSchedulesOnStartup, 2000);
});


