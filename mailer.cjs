/*
 * A deliberately small SMTP client for the accounts edition's two emails
 * (confirm your address, reset your password). Zero dependencies, like the
 * rest of the server: plain `net`/`tls`, one message per connection.
 *
 * Supports what any mail provider offers:
 *   • implicit TLS (port 465, or SMTP_SECURE=true)
 *   • STARTTLS on 587/25 when the server advertises it (and refuses to send
 *     credentials over a connection that didn't upgrade)
 *   • AUTH PLAIN / AUTH LOGIN
 *
 * Configured from the environment — see createMailerFromEnv. With no
 * SMTP_HOST there is no mailer, and the accounts edition runs without email
 * (new accounts are confirmed immediately; see auth-accounts.cjs).
 */

const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

const TIMEOUT_MS = 20000;

// "Subject: Réinitialiser" must be encoded; plain ASCII is left alone.
function encodeHeader(value) {
  const s = String(value);
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function noNewlines(v, what) {
  if (/[\r\n]/.test(String(v))) throw new Error(`${what} contains a line break`);
  return String(v);
}

function buildMessage({ from, to, subject, text, host }) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n");
  const domain = String(from).split("@")[1]?.replace(/[>\s]/g, "") || host || "localhost";
  return [
    `From: ${noNewlines(from, "From")}`,
    `To: ${noNewlines(to, "To")}`,
    `Subject: ${encodeHeader(noNewlines(subject, "Subject"))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    "",
    body,
  ].join("\r\n");
}

// Reads SMTP replies ("250-first\r\n250 last\r\n") off a socket, one per call.
function replyReader(getSocket) {
  let buf = "";
  let waiting = null;
  const replies = [];
  function onData(chunk) {
    buf += chunk.toString("utf8");
    let m;
    // a complete reply ends with a line "NNN text" (space, not dash)
    while ((m = buf.match(/^((?:\d{3}-[^\r\n]*\r?\n)*\d{3}(?: [^\r\n]*)?\r?\n)/))) {
      buf = buf.slice(m[1].length);
      const lines = m[1].trim().split(/\r?\n/);
      const reply = { code: Number(lines[lines.length - 1].slice(0, 3)), lines };
      if (waiting) {
        const w = waiting;
        waiting = null;
        w(reply);
      } else replies.push(reply);
    }
  }
  return {
    attach(sock) {
      sock.on("data", onData);
    },
    detach(sock) {
      sock.removeListener("data", onData);
    },
    next() {
      if (replies.length) return Promise.resolve(replies.shift());
      return new Promise((resolve) => (waiting = resolve));
    },
  };
}

function createMailer(cfg) {
  if (!cfg || !cfg.host) return null;
  if (!cfg.from) throw new Error("SMTP_FROM is required when SMTP_HOST is set");
  const port = Number(cfg.port) || (cfg.secure ? 465 : 587);
  const implicitTls = cfg.secure === true || (cfg.secure === undefined && port === 465);

  async function send({ to, subject, text }) {
    const message = buildMessage({ from: cfg.from, to, subject, text, host: cfg.host });
    let sock = await new Promise((resolve, reject) => {
      const opts = { host: cfg.host, port, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized !== false };
      const s = implicitTls ? tls.connect(opts, () => resolve(s)) : net.connect(opts, () => resolve(s));
      s.once("error", reject);
    });
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error("SMTP timed out")));
    let reader = replyReader();
    reader.attach(sock);
    let failed = null;
    sock.on("error", (e) => (failed = e));
    const expect = async (codes, what) => {
      const r = await Promise.race([
        reader.next(),
        new Promise((_, rej) => sock.once("close", () => rej(failed || new Error(`SMTP connection closed during ${what}`)))),
      ]);
      if (!codes.includes(r.code)) throw new Error(`SMTP ${what} refused: ${r.lines.join(" | ")}`);
      return r;
    };
    const cmd = (line) => sock.write(`${line}\r\n`);
    const ehloName = cfg.ehloName || "binderwyrm.local";
    try {
      await expect([220], "greeting");
      cmd(`EHLO ${ehloName}`);
      let ehlo = await expect([250], "EHLO");
      let secure = implicitTls;
      if (!secure && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        cmd("STARTTLS");
        await expect([220], "STARTTLS");
        reader.detach(sock);
        sock = await new Promise((resolve, reject) => {
          const s = tls.connect(
            { socket: sock, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized !== false },
            () => resolve(s)
          );
          s.once("error", reject);
        });
        sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error("SMTP timed out")));
        sock.on("error", (e) => (failed = e));
        reader = replyReader();
        reader.attach(sock);
        secure = true;
        cmd(`EHLO ${ehloName}`);
        ehlo = await expect([250], "EHLO after STARTTLS");
      }
      if (cfg.user) {
        if (!secure && !cfg.allowInsecureAuth) throw new Error("SMTP server offered no TLS; refusing to send the password in the clear");
        const caps = ehlo.lines.join(" ").toUpperCase();
        if (/AUTH[ =][^\r\n]*PLAIN/.test(caps) || !/AUTH[ =][^\r\n]*LOGIN/.test(caps)) {
          cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass || ""}`).toString("base64")}`);
          await expect([235], "AUTH PLAIN");
        } else {
          cmd("AUTH LOGIN");
          await expect([334], "AUTH LOGIN");
          cmd(Buffer.from(cfg.user).toString("base64"));
          await expect([334], "AUTH LOGIN user");
          cmd(Buffer.from(cfg.pass || "").toString("base64"));
          await expect([235], "AUTH LOGIN password");
        }
      }
      const addr = (s) => (String(s).match(/<([^>]+)>/) || [null, String(s).trim()])[1];
      cmd(`MAIL FROM:<${noNewlines(addr(cfg.from), "From")}>`);
      await expect([250], "MAIL FROM");
      cmd(`RCPT TO:<${noNewlines(addr(to), "To")}>`);
      await expect([250, 251], "RCPT TO");
      cmd("DATA");
      await expect([354], "DATA");
      // dot-stuffing: a line starting with "." gets a second one
      sock.write(`${message.replace(/\r\n\./g, "\r\n..")}\r\n.\r\n`);
      await expect([250], "message");
      cmd("QUIT");
    } finally {
      setTimeout(() => sock.destroy(), 200).unref();
    }
  }

  return { send, describe: `${cfg.host}:${port}${implicitTls ? " (TLS)" : ""}` };
}

function createMailerFromEnv(env = process.env) {
  const secure = env.SMTP_SECURE === undefined ? undefined : /^(1|true|yes)$/i.test(env.SMTP_SECURE);
  return createMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
    rejectUnauthorized: !/^(0|false|no)$/i.test(env.SMTP_TLS_VERIFY || ""),
    allowInsecureAuth: /^(1|true|yes)$/i.test(env.SMTP_ALLOW_INSECURE_AUTH || ""),
  });
}

module.exports = { createMailer, createMailerFromEnv, buildMessage, encodeHeader };
