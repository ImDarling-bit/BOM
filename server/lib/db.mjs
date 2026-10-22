// Base SQLite : comptes administrateurs et journal d'audit de l'administration.
// Les données de la manif (positions, messages, signalements) ne sont JAMAIS
// écrites ici : elles restent en mémoire.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export const DB_PATH = resolve(process.env.DB_PATH || './data/bom.db');

let db;

export function openDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      totp_secret   TEXT,
      totp_pending  TEXT,
      totp_enabled  INTEGER NOT NULL DEFAULT 0,
      totp_last_step INTEGER NOT NULL DEFAULT -1,
      created_at    INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id       INTEGER PRIMARY KEY,
      ts       INTEGER NOT NULL,
      username TEXT,
      action   TEXT NOT NULL,
      detail   TEXT
    );
  `);
  return db;
}

// --- Mots de passe (scrypt) -------------------------------------------------

function scryptAsync(password, salt) {
  return new Promise((ok, ko) =>
    scrypt(password, salt, KEYLEN, SCRYPT, (err, key) => (err ? ko(err) : ok(key))),
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password, stored) {
  const [algo, , , , saltB64, keyB64] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  const expected = Buffer.from(keyB64, 'base64');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Mot de passe acceptable : 12 caractères minimum. */
export const passwordOk = (p) => typeof p === 'string' && p.length >= 12 && p.length <= 200;
export const usernameOk = (u) => typeof u === 'string' && /^[\w.-]{3,32}$/.test(u);

// --- Comptes -----------------------------------------------------------------

export const findAdmin = (username) =>
  openDb().prepare('SELECT * FROM admins WHERE username = ?').get(username);
export const getAdmin = (id) => openDb().prepare('SELECT * FROM admins WHERE id = ?').get(id);
export const listAdmins = () =>
  openDb()
    .prepare('SELECT id, username, totp_enabled, created_at, last_login_at FROM admins ORDER BY id')
    .all();

export async function createAdmin(username, password) {
  const hash = await hashPassword(password);
  return openDb()
    .prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now()).lastInsertRowid;
}

export async function setPassword(id, password) {
  const hash = await hashPassword(password);
  openDb().prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
}

export const removeAdmin = (username) =>
  openDb().prepare('DELETE FROM admins WHERE username = ?').run(username).changes;

export const setTotpPending = (id, secret) =>
  openDb().prepare('UPDATE admins SET totp_pending = ? WHERE id = ?').run(secret, id);
export const enableTotp = (id, step) =>
  openDb()
    .prepare(
      'UPDATE admins SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ?',
    )
    .run(step, id);
export const disableTotp = (id) =>
  openDb()
    .prepare(
      'UPDATE admins SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = -1 WHERE id = ?',
    )
    .run(id);
export const setTotpLastStep = (id, step) =>
  openDb().prepare('UPDATE admins SET totp_last_step = ? WHERE id = ?').run(step, id);
export const touchLogin = (id) =>
  openDb().prepare('UPDATE admins SET last_login_at = ? WHERE id = ?').run(Date.now(), id);

// --- Audit ---------------------------------------------------------------------

export function audit(username, action, detail = null) {
  openDb()
    .prepare('INSERT INTO admin_audit (ts, username, action, detail) VALUES (?, ?, ?, ?)')
    .run(Date.now(), username, action, detail);
}

export const recentAudit = (limit = 100) =>
  openDb()
    .prepare('SELECT ts, username, action, detail FROM admin_audit ORDER BY id DESC LIMIT ?')
    .all(limit);
