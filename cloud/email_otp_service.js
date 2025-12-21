/**
 * PillNow Email OTP Service (Cloud / Render)
 *
 * Purpose:
 * - Send password reset OTP to the user's EMAIL (looked up by phone from pillnow-database.onrender.com)
 * - Verify OTP and issue a short-lived resetToken
 * - Reset password by calling the cloud API /api/users/reset-password
 *
 * Notes:
 * - OTP storage is in-memory (Render dynos can restart). This is OK for short-lived OTP flows.
 * - Configure SMTP via env vars (Gmail App Password recommended).
 *
 * Env:
 * - PORT=8080
 * - CLOUD_API_BASE=https://pillnow-database.onrender.com
 * - EMAIL_ENABLED=true
 * - EMAIL_FROM, EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS
 * - CORS_ORIGIN=*   (or your app origin)
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const crypto = require("crypto");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

const PORT = Number(process.env.PORT || 8080);
const CLOUD_API_BASE = process.env.CLOUD_API_BASE || "https://pillnow-database.onrender.com";

const EMAIL_ENABLED = String(process.env.EMAIL_ENABLED || "").toLowerCase() === "true";
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER || "";
const EMAIL_HOST = process.env.EMAIL_HOST || "";
const EMAIL_PORT = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587;
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// In-memory OTP store: phone -> entry
// entry: { email, otpHash, salt, otpExp, attempts, lastSentAt, resetToken, resetTokenExp }
const otpStore = new Map();

function nowMs() {
  return Date.now();
}

function makeOtp6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function makeSalt() {
  return crypto.randomBytes(8).toString("hex");
}

function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

function makeResetToken() {
  return crypto.randomBytes(16).toString("hex");
}

function maskEmail(email) {
  const s = String(email || "");
  const [user, domain] = s.split("@");
  if (!user || !domain) return s;
  const shown =
    user.length <= 2
      ? user[0] || "*"
      : `${user[0]}${"*".repeat(Math.max(1, user.length - 2))}${user[user.length - 1]}`;
  return `${shown}@${domain}`;
}

async function sendEmail({ to, subject, text }) {
  if (!EMAIL_ENABLED) return false;
  if (!nodemailer) {
    console.warn("[email-otp] nodemailer not installed");
    return false;
  }
  if (!to || !EMAIL_FROM || !EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    console.warn("[email-otp] Email not configured (missing env vars)");
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  await transporter.sendMail({ from: EMAIL_FROM, to, subject, text });
  return true;
}

async function fetchUserEmailByPhone(phone) {
  const p = String(phone || "").trim();
  if (!p) return null;

  const candidates = [
    `${CLOUD_API_BASE}/api/users/phone/${encodeURIComponent(p)}`,
    `${CLOUD_API_BASE}/api/users/phone/${encodeURIComponent(p)}?role=2`,
    `${CLOUD_API_BASE}/api/users/elder/${encodeURIComponent(p)}`,
    `${CLOUD_API_BASE}/api/users?phone=${encodeURIComponent(p)}&role=2`,
    `${CLOUD_API_BASE}/api/users?phone=${encodeURIComponent(p)}`,
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

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/password-reset/request-otp-email", async (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    if (!phone) return res.status(400).json({ success: false, message: "phone is required" });
    if (!EMAIL_ENABLED) return res.status(400).json({ success: false, message: "EMAIL_ENABLED is false on server." });

    const email = await fetchUserEmailByPhone(phone);
    if (!email) return res.status(404).json({ success: false, message: "No user email found for that phone number." });

    const entry = otpStore.get(phone) || {};
    const now = nowMs();
    if (entry.lastSentAt && now - entry.lastSentAt < 60_000) {
      const wait = Math.ceil((60_000 - (now - entry.lastSentAt)) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${wait}s before requesting another OTP.` });
    }

    const otp = makeOtp6();
    const salt = makeSalt();
    const otpHash = hashOtp(otp, salt);
    const otpExp = now + 10 * 60_000; // 10 minutes

    otpStore.set(phone, {
      email,
      otpHash,
      salt,
      otpExp,
      attempts: 0,
      lastSentAt: now,
      resetToken: "",
      resetTokenExp: 0,
    });

    const ok = await sendEmail({
      to: email,
      subject: "PillNow Password Reset Code",
      text: `Your PillNow password reset code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you did not request this, ignore this email.`,
    });
    if (!ok) return res.status(500).json({ success: false, message: "Failed to send OTP email. Check SMTP settings." });

    return res.json({ success: true, message: "OTP sent to email.", email: maskEmail(email) });
  } catch (e) {
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
});

app.post("/api/password-reset/verify-otp-email", async (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const otp = String(req.body?.otp || "").trim();
    if (!phone || !otp) return res.status(400).json({ success: false, message: "phone and otp are required" });

    const entry = otpStore.get(phone);
    if (!entry?.otpHash || !entry?.salt || !entry?.otpExp) {
      return res.status(400).json({ success: false, message: "No OTP request found. Please request a new code." });
    }
    const now = nowMs();
    if (now > entry.otpExp) {
      otpStore.delete(phone);
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new code." });
    }

    entry.attempts = Number(entry.attempts || 0) + 1;
    if (entry.attempts > 5) {
      otpStore.delete(phone);
      return res.status(429).json({ success: false, message: "Too many attempts. Please request a new code." });
    }

    const expectedHash = hashOtp(otp, entry.salt);
    if (expectedHash !== entry.otpHash) {
      otpStore.set(phone, entry);
      return res.status(400).json({ success: false, message: "Invalid code." });
    }

    const token = makeResetToken();
    entry.resetToken = token;
    entry.resetTokenExp = now + 15 * 60_000;
    // Invalidate OTP after success
    entry.otpHash = "";
    entry.salt = "";
    entry.otpExp = 0;
    otpStore.set(phone, entry);

    return res.json({ success: true, message: "OTP verified.", resetToken: token });
  } catch (e) {
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
});

app.post("/api/password-reset/reset-with-token", async (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const resetToken = String(req.body?.resetToken || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!phone || !resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: "phone, resetToken, and newPassword are required" });
    }

    const entry = otpStore.get(phone);
    const now = nowMs();
    if (!entry?.resetToken || entry.resetToken !== resetToken || !entry.resetTokenExp || now > entry.resetTokenExp) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token. Restart forgot password." });
    }

    const cloudResp = await fetch(`${CLOUD_API_BASE}/api/users/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, newPassword }),
    });
    const text = await cloudResp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!cloudResp.ok || (json && json.success === false)) {
      return res.status(502).json({ success: false, message: json?.message || `Cloud reset-password failed (${cloudResp.status})`, detail: text });
    }

    otpStore.delete(phone);
    return res.json({ success: true, message: "Password reset successfully." });
  } catch (e) {
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[email-otp] listening on http://0.0.0.0:${PORT}`);
});


