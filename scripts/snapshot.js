// ============================================================
// snapshot.js — the forecast tool's snapshot robot.
// Runs in GitHub Actions (Node 20). Performs the SAME load the tool's
// "Login & Load All Data" button does — item ledger entries from
// 01/05/2026, item list, vendor mappings, item cubage — via the shared
// bc-fetchers.js, then gzips + encrypts the result for the Fast
// lookup menu.
//
// Env (from GitHub secrets):
//   BC_CLIENT_ID, BC_TENANT, BC_REFRESH_TOKEN  — token exchange
//   SNAPSHOT_PASSPHRASE                        — AES key material
//   SLOT                                       — "0500" | "1100" | "1700"
//                                                (empty = fill whichever due
//                                                 slot is missing today)
//
// Output — uploaded to SharePoint (scripts/sp-upload.js → SP_CONFIG in
// bc-fetchers.js); local copy in ./snapshot-out/ for the Actions log.
// Key = PBKDF2-SHA256(passphrase, salt, 600,000 iters).
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
const SP = require(path.join(__dirname, "sp-upload.js"));
const PBKDF2_ITERATIONS = 600000;   // keep in sync with decryptBin() in index.html

// ---------- Melbourne wall clock + slot detection ----------
function melbourneNow() {
    const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Melbourne",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date());
    const g = (t) => parts.find(p => p.type === t).value;
    return { date: g("year") + "-" + g("month") + "-" + g("day"),
             minutes: parseInt(g("hour"), 10) * 60 + parseInt(g("minute"), 10),
             hhmm: g("hour") + ":" + g("minute") };
}
// ---------- Slots ----------
// Three fixed slots a day on the Melbourne clock. The cron fires every
// 30 minutes; each firing asks "which slot that is already due is still
// missing today's capture?" and fills ONE of them — the current slot
// first, then any earlier slot that missed — or exits in seconds. A slot
// that already holds today's capture is never overwritten by the
// schedule, so a cron GitHub runs hours late can no longer file a capture
// into the wrong bin or leave one sitting on yesterday's data.
//   deadline: once a slot is this late, a failed fill ends the run in
//   failure (→ one email); before that a failure is quiet because the
//   next firing retries anyway.
const SLOTS = [
    { slot: "0500", label: "Morning", due: 5 * 60,  deadline: 10 * 60 + 30 },
    { slot: "1100", label: "Midday",  due: 11 * 60, deadline: 16 * 60 + 30 },
    { slot: "1700", label: "Evening", due: 17 * 60, deadline: 22 * 60 + 30 },
];
// A slot holds today's capture when its meta says so and the capture
// happened after the slot came due (a 04:30 manual fill is not the
// 05:00 capture).
function filledToday(meta, s, mel) {
    if (!meta || !meta.fetchedAtMelbourne) return false;
    const [d, t] = String(meta.fetchedAtMelbourne).split(" ");
    if (d !== mel.date) return false;
    const [h, m] = (t || "0:0").split(":").map(Number);
    return ((h || 0) % 24) * 60 + (m || 0) >= s.due;
}
// Returns { s, reason } or null when there is nothing to do.
async function chooseSlot(mel) {
    const forced = (process.env.SLOT || "").trim();
    if (forced) {
        const s = SLOTS.find(x => x.slot === forced);
        if (!s) throw new Error("Unknown slot '" + forced + "' — use " + SLOTS.map(x => x.slot).join(" / "));
        return { s, reason: "forced by workflow input" };
    }
    const due = SLOTS.filter(s => s.due <= mel.minutes);
    if (!due.length) { console.log("Melbourne " + mel.hhmm + " — before the first slot of the day, nothing to do."); return null; }
    const current = due[due.length - 1];
    // A manual "Run workflow" always refreshes the most recent slot.
    if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") return { s: current, reason: "manual refresh" };
    let metas;
    try { metas = await SP.readSnapshotMetas(due.map(s => s.slot)); }
    catch (e) {
        console.warn("Cannot read slot state from SharePoint (" + e.message + ") — filling the current slot anyway");
        return { s: current, reason: "slot state unknown" };
    }
    for (const s of due) {
        const m = metas[s.slot];
        console.log("  " + s.label + " (" + s.slot + "): " + (m && m.fetchedAtMelbourne ? "captured " + m.fetchedAtMelbourne : "no snapshot")
            + (filledToday(m, s, mel) ? " ✓ today" : " — missing today"));
    }
    for (let i = due.length - 1; i >= 0; i--) {
        if (!filledToday(metas[due[i].slot], due[i], mel)) return { s: due[i], reason: i === due.length - 1 ? "current slot" : "catch-up" };
    }
    console.log("Melbourne " + mel.hhmm + " — every due slot already holds today's capture, nothing to do.");
    return null;
}

let chosen = null;   // visible to the failure handler below
(async () => {
    const mel = melbourneNow();
    chosen = await chooseSlot(mel);
    if (!chosen) return;
    const slot = chosen.s.slot;
    console.log("Filling " + chosen.s.label + " slot (" + slot + ") — " + chosen.reason);

    const from = F.WIISE_LEDGER_FROM;
    const to = mel.date;
    console.log("Snapshot slot " + slot + " · Melbourne " + mel.date + " " + mel.hhmm + " · ledger from " + from);

    const t0 = Date.now();
    // Same five fetches, same shared code, as index.html connectToWiise().
    const [ledger, items, vendors, locData, uom] = await Promise.all([
        F.bcFetchLedgerEntries(),
        F.bcFetchItems(),
        F.bcFetchVendors(),
        F.bcFetchLocationData(),
        F.bcFetchItemUom(),
    ]);
    console.log("Fetched in " + ((Date.now() - t0) / 1000).toFixed(1) + "s: "
        + ledger.rows.length + " ledger rows · " + items.rows.length + " items · "
        + vendors.rows.length + " vendor links");
    console.log("Branch data:", JSON.stringify(locData.diagnostics));
    console.log("Cubage:", uom.diagnostics);

    // ---- Integrity checks (fail loudly rather than snapshot bad data) ----
    if (ledger.rows.length === 0) throw new Error("0 ledger rows — aborting snapshot");
    if (items.rows.length === 0) throw new Error("0 items — aborting snapshot");
    let dMin = "9999", dMax = "0000", outOfRange = 0;
    for (const r of ledger.rows) {
        const d = String(r["Posting Date"] || "").slice(0, 10);
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
        if (d < from) outOfRange++;
    }
    console.log("[ledger check] postingDate " + dMin + " … " + dMax + " · beforeRangeStart=" + outOfRange);
    if (outOfRange > 0) {
        throw new Error("[ledger check] " + outOfRange + " rows before " + from + " — server date filter ignored?! Aborting.");
    }

    const payload = {
        meta: {
            formatVersion: 1,
            slot,
            fetchedAtUtc: new Date().toISOString(),
            fetchedAtMelbourne: mel.date + " " + mel.hhmm,
            from, to,
        },
        data: { ledger, items, vendors, locData, uom },
    };

    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const gz = zlib.gzipSync(json, { level: 9 });
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(PASSPHRASE, salt, PBKDF2_ITERATIONS, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(gz), cipher.final(), cipher.getAuthTag()]);
    const bin = Buffer.concat([salt, iv, ct]);

    const outDir = path.join(__dirname, "..", "snapshot-out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, slot + ".bin"), bin);
    const metaJson = JSON.stringify({
        slot,
        fetchedAtUtc: payload.meta.fetchedAtUtc,
        fetchedAtMelbourne: payload.meta.fetchedAtMelbourne,
        from, to,
        bytes: bin.length,
        formatVersion: 1,
    }, null, 2);
    fs.writeFileSync(path.join(outDir, slot + ".meta.json"), metaJson);
    console.log("Wrote " + slot + ".bin (" + (bin.length / 1048576).toFixed(2) + " MB, "
        + (json.length / 1048576).toFixed(1) + " MB raw JSON)");

    console.log("Publishing to SharePoint…");
    await SP.publishSnapshot(slot, bin, metaJson);
    console.log("Published " + slot + " to SharePoint");
})().catch(e => {
    const mel = melbourneNow();
    const manual = !!(process.env.SLOT || "").trim() || process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
    const late = chosen && mel.minutes >= chosen.s.deadline;
    if (!manual && chosen && !late) {
        // Quiet: the schedule fires again in 30 minutes and will retry this
        // slot. Only a slot that is past its deadline fails the run (→ email).
        console.warn("SNAPSHOT NOT PUBLISHED (" + chosen.s.label + "): " + e.message);
        console.warn("Next firing retries; the run ends in failure only after " + String(Math.floor(chosen.s.deadline / 60)).padStart(2, "0") + ":" + String(chosen.s.deadline % 60).padStart(2, "0") + " Melbourne.");
        return;
    }
    console.error("SNAPSHOT FAILED" + (chosen ? " (" + chosen.s.label + ")" : "") + ":", e.message);
    process.exit(1);
});
