"use strict";
const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const PROD = process.env.NODE_ENV === "production";
const SECRET = process.env.JWT_SECRET || (PROD ? null : "dev-secret-a-changer");
if (!SECRET) { console.error("JWT_SECRET est obligatoire en production."); process.exit(1); }
if (PROD && !process.env.JOIN_CODE) { console.error("JOIN_CODE est obligatoire en production."); process.exit(1); }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : (PROD ? { rejectUnauthorized: false } : false)
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());

const STATUSES = ["dispo", "tournee", "pause", "absent"];
const h = fn => (req, res, next) => fn(req, res, next).catch(next);
const bad = (res, msg) => res.status(400).json({ error: msg });
const str = (v, n) => String(v || "").trim().slice(0, n);
const cleanPhone = p => String(p || "").replace(/[^\d+]/g, "").slice(0, 20);
const out = r => ({
  id: String(r.id), name: r.name, role: r.role, zone: r.zone, phone: r.phone,
  team: r.team, status: r.status, since: new Date(r.since).getTime(), note: r.note,
  backAt: r.back_at, plan: r.plan.split("")
});
const setTok = (res, id) => res.cookie("tok", jwt.sign({ id }, SECRET, { expiresIn: "30d" }), {
  httpOnly: true, sameSite: "lax", secure: PROD, maxAge: 30 * 864e5
});

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hits = new Map();
function limit(req, res, next) {
  const now = Date.now(), a = (hits.get(req.ip) || []).filter(t => now - t < 9e5);
  if (a.length >= 20) return res.status(429).json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
  a.push(now); hits.set(req.ip, a); next();
}

async function auth(req, res, next) {
  try {
    const p = jwt.verify(req.cookies.tok || "", SECRET);
    const r = await pool.query("SELECT id, is_admin FROM employees WHERE id=$1", [p.id]);
    if (!r.rows[0]) throw new Error("inconnu");
    req.uid = r.rows[0].id; req.admin = r.rows[0].is_admin; next();
  } catch (e) { res.status(401).json({ error: "Connexion requise." }); }
}

app.get("/healthz", (req, res) => res.send("ok"));

app.post("/api/register", limit, h(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 60), role = str(b.role, 40), zone = str(b.zone, 40), team = str(b.team, 40) || "Sans équipe";
  const phone = cleanPhone(b.phone), pw = String(b.password || "");
  if (process.env.JOIN_CODE && b.code !== process.env.JOIN_CODE) return bad(res, "Code d’invitation incorrect.");
  if (!name || !role || !zone || phone.length < 8 || pw.length < 6)
    return bad(res, "Renseignez tous les champs (mot de passe : 6 caractères minimum).");
  const hash = await bcrypt.hash(pw, 10);
  try {
    const n = (await pool.query("SELECT count(*)::int AS n FROM employees")).rows[0].n;
    const r = await pool.query(
      "INSERT INTO employees (name, role, zone, team, phone, password_hash, is_admin) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [name, role, zone, team, phone, hash, n === 0]);
    await pool.query("INSERT INTO status_log (employee_id, status) VALUES ($1,'dispo')", [r.rows[0].id]);
    setTok(res, r.rows[0].id); res.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return bad(res, "Ce numéro a déjà un compte.");
    throw e;
  }
}));

app.post("/api/login", limit, h(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query("SELECT id, password_hash FROM employees WHERE phone=$1", [cleanPhone(b.phone)]);
  const ok = r.rows[0] && await bcrypt.compare(String(b.password || ""), r.rows[0].password_hash);
  if (!ok) return res.status(400).json({ error: "Numéro ou mot de passe incorrect." });
  setTok(res, r.rows[0].id); res.json({ ok: true });
}));

app.post("/api/reset", limit, h(async (req, res) => {
  const b = req.body || {};
  const phone = cleanPhone(b.phone), code = String(b.code || "").trim(), pw = String(b.password || "");
  if (pw.length < 6) return bad(res, "Le mot de passe doit contenir au moins 6 caractères.");
  const e = (await pool.query("SELECT id, is_admin, reset_hash, reset_expires, reset_tries FROM employees WHERE phone=$1", [phone])).rows[0];
  let ok = false;
  if (e && code) {
    const key = process.env.ADMIN_RECOVERY_KEY;
    if (e.is_admin && key && safeEq(code, key)) ok = true;
    else if (e.reset_hash && e.reset_expires > new Date() && e.reset_tries < 5) {
      ok = await bcrypt.compare(code, e.reset_hash);
      if (!ok) await pool.query("UPDATE employees SET reset_tries = reset_tries + 1 WHERE id=$1", [e.id]);
    }
  }
  if (!ok) return bad(res, "Code invalide ou expiré. Demandez un nouveau code à votre administrateur.");
  await pool.query("UPDATE employees SET password_hash=$1, reset_hash=NULL, reset_expires=NULL, reset_tries=0 WHERE id=$2", [await bcrypt.hash(pw, 10), e.id]);
  setTok(res, e.id); res.json({ ok: true });
}));

app.post("/api/staff/:id/reset-code", auth, h(async (req, res) => {
  if (!req.admin) return res.status(403).json({ error: "Action non autorisée." });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, "Identifiant invalide.");
  const code = String(crypto.randomInt(100000, 1000000));
  const r = await pool.query("UPDATE employees SET reset_hash=$1, reset_expires=now() + interval '30 minutes', reset_tries=0 WHERE id=$2 RETURNING id", [await bcrypt.hash(code, 10), id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Employé introuvable." });
  res.json({ code });
}));

app.post("/api/logout", (req, res) => { res.clearCookie("tok"); res.json({ ok: true }); });

app.get("/api/me", auth, h(async (req, res) => {
  const r = await pool.query("SELECT id, name, is_admin FROM employees WHERE id=$1", [req.uid]);
  res.json({ id: String(r.rows[0].id), name: r.rows[0].name, isAdmin: r.rows[0].is_admin });
}));

app.get("/api/teams", h(async (req, res) => {
  const r = await pool.query("SELECT DISTINCT team FROM employees ORDER BY team");
  res.json(r.rows.map(x => x.team));
}));

app.get("/api/staff", auth, h(async (req, res) => {
  const r = await pool.query("SELECT * FROM employees ORDER BY name");
  res.json(r.rows.map(out));
}));

const update = h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, "Identifiant invalide.");
  if (id !== req.uid && !req.admin) return res.status(403).json({ error: "Action non autorisée." });
  const b = req.body || {}, sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(col + "=$" + vals.length); };
  for (const [k, n] of [["name", 60], ["role", 40], ["zone", 40]]) {
    if (b[k] !== undefined) { const v = str(b[k], n); if (!v) return bad(res, "Champ obligatoire : " + k + "."); add(k, v); }
  }
  if (b.team !== undefined) add("team", str(b.team, 40) || "Sans équipe");
  if (b.phone !== undefined) { const v = cleanPhone(b.phone); if (v.length < 8) return bad(res, "Téléphone invalide."); add("phone", v); }
  if (b.note !== undefined) add("note", str(b.note, 120));
  if (b.backAt !== undefined) add("back_at", /^\d{2}:\d{2}$/.test(b.backAt || "") ? b.backAt : "");
  if (b.plan !== undefined) {
    if (!Array.isArray(b.plan) || b.plan.length !== 7 || b.plan.some(x => typeof x !== "string" || x.length !== 1 || !"TRC".includes(x)))
      return bad(res, "Planning invalide.");
    add("plan", b.plan.join(""));
  }
  let statusChanged = false;
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return bad(res, "Statut invalide.");
    add("status", b.status); sets.push("since=now()"); statusChanged = true;
  }
  if (!sets.length) return bad(res, "Rien à modifier.");
  vals.push(id);
  try {
    const r = await pool.query("UPDATE employees SET " + sets.join(", ") + " WHERE id=$" + vals.length + " RETURNING *", vals);
    if (!r.rows[0]) return res.status(404).json({ error: "Employé introuvable." });
    if (statusChanged) await pool.query("INSERT INTO status_log (employee_id, status) VALUES ($1,$2)", [id, b.status]);
    res.json(out(r.rows[0]));
  } catch (e) {
    if (e.code === "23505") return bad(res, "Ce numéro est déjà utilisé.");
    throw e;
  }
});
app.patch("/api/staff/:id", auth, update);
app.put("/api/staff/:id", auth, update);

app.delete("/api/staff/:id", auth, h(async (req, res) => {
  const id = Number(req.params.id);
  if (!req.admin) return res.status(403).json({ error: "Action non autorisée." });
  if (id === req.uid) return bad(res, "Vous ne pouvez pas retirer votre propre compte.");
  await pool.query("DELETE FROM employees WHERE id=$1", [id]);
  res.status(204).end();
}));

app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Erreur du serveur." }); });

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("Serveur prêt sur le port " + port));
})().catch(e => { console.error("Démarrage impossible :", e.message); process.exit(1); });
