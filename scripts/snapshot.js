// ============================================================
// snapshot.js — the forecast tool's snapshot robot.
// Runs in GitHub Actions (Node 20). Performs the SAME load the tool's
// "Login & Load All Data" button does — item ledger entries from
// 01/05/2026, item list, vendor mappings — via the shared
// bc-fetchers.js, then gzips + encrypts the result for the Fast
// lookup menu.
//
// Env (from GitHub secrets):
//   BC_CLIENT_ID, BC_TENANT, BC_REFRESH_TOKEN  — token exchange
//   SNAPSHOT_PASSPHRASE                        — AES key material
//   SLOT                                       — "0700" | "1200" | "1630"
//                                                (empty = auto-detect from
//                                                 Melbourne wall clock)
//
// Output (./snapshot-out/):
//   <slot>.bin        salt(16) | iv(12) | AES-256-GCM ciphertext||tag
//                     of gzip(JSON payload) — tag last so browser
//                     WebCrypto can decrypt the ct||tag block directly
//   <slot>.meta.json  { slot, fetchedAtUtc, fetchedAtMelbourne, from,
//                       to, bytes, formatVersion } (plaintext, no data)
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const TENANT = process.env.BC_TENANT;
const CLIENT_ID = process.env.BC_CLIENT_ID;
const REFRESH_TOKEN = process.env.BC_REFRESH_TOKEN;
const PASSPHRASE = process.env.SNAPSHOT_PASSPHRASE;
if (!TENANT || !CLIENT_ID || !REFRESH_TOKEN || !PASSPHRASE) {
    console.error("Missing env: need BC_TENANT, BC_CLIENT_ID, BC_REFRESH_TOKEN, SNAPSHOT_PASSPHRASE");
    process.exit(1);
}

// ---------- Globals contract required by bc-fetchers.js ----------
global.updateBCStatus = (msg) => console.log("  [status] " + msg);
global.updateBCProgress = (label, detail) => console.log("  [" + label + "] " + detail);

let _tok = null, _tokExp = 0;
global.bcGetToken = async function bcGetToken() {
    if (_tok && Date.now() < _tokExp - 300000) return _tok;
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: REFRESH_TOKEN,
        scope: "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
    });
    const resp = await fetch("https://login.microsoftonline.com/" + TENANT + "/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    const tok = await resp.json();
    if (!tok.access_token) {
        throw new Error("Token exchange failed: " + JSON.stringify(tok).slice(0, 400));
    }
    _tok = tok.access_token;
    _tokExp = Date.now() + (tok.expires_in || 3600) * 1000;
    return _tok;
};
global.bcClearToken = function bcClearToken() { _tok = null; };

const F = require(path.join(__dirname, "..", "bc-fetchers.js"));

// ---------- Melbourne wall clock + slot detection ----------
function melbourneNow() {
    const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Melbourne",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const g = (t) => parts.find(p => p.type === t).value;
    return { date: g("year") + "-" + g("month") + "-" + g("day"),
             minutes: parseInt(g("hour"), 10) * 60 + parseInt(g("minute"), 10),
             hhmm: g("hour") + ":" + g("minute") };
}
const SLOTS = { "0700": 7 * 60, "1200": 12 * 60, "1630": 16 * 60 + 30 };
// Every firing publishes — no run is wasted. GitHub crons run hours late
// (the noon ones were landing ~15:00 Melbourne, and nearest-slot logic filed
// them into the 1630 bin, starving 1200 for days). Rule: file the capture
// into the most recent slot of the day. The menu always shows the REAL
// capture time, so late captures are honestly labeled.
//   06:00-10:59 → 0700 · 11:00-15:29 → 1200 · 15:30 onward → 1630
//   00:00-05:59 → 1630 (overnight straggler = freshest data for the arvo bin)
function detectSlot(mel) {
    const m = mel.minutes;
    if (m >= 15 * 60 + 30) return "1630";
    if (m >= 11 * 60) return "1200";
    if (m >= 6 * 60) return "0700";
    return "1630";
}

(async () => {
    const mel = melbourneNow();
    let slot = (process.env.SLOT || "").trim();
    if (!slot) {
        slot = detectSlot(mel);
        if (!slot) {
            console.log("Melbourne time " + mel.hhmm + " is not near any slot — DST-offset cron firing, skipping.");
            return;
        }
    }
    if (!SLOTS[slot]) { console.error("Unknown slot '" + slot + "'"); process.exit(1); }

    const from = F.WIISE_LEDGER_FROM;
    const to = mel.date;
    console.log("Snapshot slot " + slot + " · Melbourne " + mel.date + " " + mel.hhmm + " · ledger from " + from);

    const t0 = Date.now();
    // Same three fetches, same shared code, as index.html connectToWiise().
    const [ledger, items, vendors] = await Promise.all([
        F.bcFetchLedgerEntries(),
        F.bcFetchItems(),
        F.bcFetchVendors(),
    ]);
    console.log("Fetched in " + ((Date.now() - t0) / 1000).toFixed(1) + "s: "
        + ledger.rows.length + " ledger rows · " + items.rows.length + " items · "
        + vendors.rows.length + " vendor links");

    // ---- Integrity checks (fail loudly rather than snapshot bad data) ----
    if (ledger.rows.length === 0) { console.error("0 ledger rows — aborting snapshot"); process.exit(1); }
    if (items.rows.length === 0) { console.error("0 items — aborting snapshot"); process.exit(1); }
    let dMin = "9999", dMax = "0000", outOfRange = 0;
    for (const r of ledger.rows) {
        const d = String(r["Posting Date"] || "").slice(0, 10);
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
        if (d < from) outOfRange++;
    }
    console.log("[ledger check] postingDate " + dMin + " … " + dMax + " · beforeRangeStart=" + outOfRange);
    if (outOfRange > 0) {
        console.error("[ledger check] " + outOfRange + " rows before " + from + " — server date filter ignored?! Aborting.");
        process.exit(1);
    }

    const payload = {
        meta: {
            formatVersion: 1,
            slot,
            fetchedAtUtc: new Date().toISOString(),
            fetchedAtMelbourne: mel.date + " " + mel.hhmm,
            from, to,
        },
        data: { ledger, items, vendors },
    };

    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const gz = zlib.gzipSync(json, { level: 9 });
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(PASSPHRASE, salt, 150000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(gz), cipher.final(), cipher.getAuthTag()]);
    const bin = Buffer.concat([salt, iv, ct]);

    const outDir = path.join(__dirname, "..", "snapshot-out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, slot + ".bin"), bin);
    fs.writeFileSync(path.join(outDir, slot + ".meta.json"), JSON.stringify({
        slot,
        fetchedAtUtc: payload.meta.fetchedAtUtc,
        fetchedAtMelbourne: payload.meta.fetchedAtMelbourne,
        from, to,
        bytes: bin.length,
        formatVersion: 1,
    }, null, 2));
    console.log("Wrote " + slot + ".bin (" + (bin.length / 1048576).toFixed(2) + " MB, "
        + (json.length / 1048576).toFixed(1) + " MB raw JSON)");
})().catch(e => {
    console.error("SNAPSHOT FAILED:", e.message);
    process.exit(1);
});
