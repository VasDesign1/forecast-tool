// ============================================================
// procure.js — procurement tabs for the forecast tool (Tab view).
//   Purchase Orders · Buy List · Back Orders · Stock Runway ·
//   Branch Transfers · Min/Max Review · Vendors · Slow & Dead Stock ·
//   Forecast Accuracy
// Reads the purchasing payload built by bcFetchProcurement()
// (bc-fetchers.js) plus the tables index.html already holds. Nothing in
// here changes the existing tabs or their maths.
// TRIAL: shown only to the accounts in OWNERS (and on localhost).
// ============================================================
"use strict";
const PROC = (function () {
    const OWNERS = ["faiko@vicair.com.au"];
    const TABS = [
        { key: "p_po", label: "Purchase Orders" },
        { key: "p_buy", label: "Buy List" },
        { key: "p_back", label: "Back Orders" },
        { key: "p_runway", label: "Stock Runway" },
        { key: "p_transfer", label: "Branch Transfers" },
        { key: "p_minmax", label: "Min/Max Review" },
        { key: "p_vendors", label: "Vendors" },
        { key: "p_slow", label: "Slow & Dead Stock" },
        { key: "p_accuracy", label: "Forecast Accuracy" },
    ];
    const DEFAULT_LEAD = 30;     // days, when nothing was measured or typed in
    const SAFETY_DAYS = 14;      // buffer on top of the lead time

    let D = null;                // purchasing payload
    let asOf = "";               // "as of" text for the payload
    let loading = false;
    const S = {
        sort: {}, pages: {}, last: null,
        poFilter: "all", buyWindow: 14, runwayAll: false, runwayWeeks: 12,
        trNoMin: false, mmAll: false, slowMonths: 6, slowCat: "all", vendor: null, backFilter: "all",
    };
    let leadOv = {};
    try { leadOv = JSON.parse(localStorage.getItem("forecastProcLead") || "{}") || {}; } catch (e) { leadOv = {}; }

    // ---------- who sees it ----------
    function isLocal() { return location.hostname === "localhost" || location.hostname === "127.0.0.1"; }
    function enabled() {
        if (isLocal()) return true;
        try {
            const a = bcMsalInstance && bcMsalInstance.getAllAccounts();
            return !!(a && a[0] && OWNERS.indexOf(String(a[0].username || "").toLowerCase()) !== -1);
        } catch (e) { return false; }
    }
    function isTab(t) { return typeof t === "string" && t.indexOf("p_") === 0; }
    function tabs() { return enabled() ? TABS : []; }

    // ---------- small helpers ----------
    function isoToday() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
    function dnum(s) { const p = String(s).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
    function dDiff(a, b) { return Math.round(dnum(a) - dnum(b)); }
    function addDays(s, n) { return new Date((dnum(s) + Math.round(n)) * 86400000).toISOString().slice(0, 10); }
    function dmy(s) { return s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(2, 4) : "-"; }
    function money(n) { return "$" + Math.round(n || 0).toLocaleString(); }
    function qty(n) { return (n == null || !isFinite(n)) ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }); }
    function median(a) { if (!a.length) return null; const b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
    function H(title, text) { return ' data-help="' + escAttr("<strong>" + title + "</strong>" + text) + '"'; }
    function badge(text, color) { return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:700;color:white;background:' + color + ';white-space:nowrap;">' + esc(text) + "</span>"; }
    function locs() { return (typeof selectedLocations !== "undefined" && selectedLocations) ? selectedLocations : []; }
    function inLoc(l) { const L = locs(); return L.length === 0 || L.indexOf(l) !== -1; }
    function vendorOK(v) { return !selectedVendor || v === selectedVendor; }
    function itemVendor(item) { return (vendorMapping[item] || [])[0] || ""; }
    function itemVendorOK(item) { return !selectedVendor || (vendorMapping[item] || []).indexOf(selectedVendor) !== -1; }
    function vname(v) { return (D && D.vn && D.vn[v]) || vendorNames[v] || ""; }
    function vlabel(v) { if (!v) return "No vendor"; const n = vname(v); return n ? v + " · " + n : v; }
    function cost(item) { return (D && D.cost && D.cost[item]) || 0; }
    function special(item) { return !includeSpecialItems && isSpecialItem(item); }

    let Q = { s: "", exact: false };
    let itemIdx = {};
    let TODAY = isoToday();
    function prep() {
        TODAY = isoToday();
        if (typeof wsSyncPlanner === "function") wsSyncPlanner();
        Q = { s: plannerState.search || "", exact: !!plannerState.searchExact };
        itemIdx = {};
        for (const d of allData) itemIdx[d.item_no] = d;
    }
    function desc(item) { return (itemIdx[item] && itemIdx[item].description) || (orderData[item] && orderData[item].description) || ""; }
    function match(item, d, extra) {
        if (!Q.s) return true;
        if (Q.exact) return String(item).toLowerCase() === Q.s;
        return (item + " " + (d || "") + " " + (extra || "")).toLowerCase().indexOf(Q.s) !== -1;
    }
    let _base = null;
    function baseRows() {
        if (_base) return _base;
        _base = plannerAllRows().filter(function (r) { return match(r.itemNo, r.description); });
        return _base;
    }
    function itemLink(item) {
        const known = !!itemIdx[item];
        return known ? '<a href="#" onclick="showItemDetail(\'' + escAttr(String(item).replace(/\\/g, "\\\\").replace(/'/g, "\\'")) + '\');return false;" style="color:#1a237e;font-weight:600;text-decoration:none;">' + esc(item) + "</a>"
            : '<span style="font-weight:600;">' + esc(item) + "</span>";
    }
    function descCell(t) { return '<span style="display:inline-block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;" title="' + escAttr(t || "") + '">' + esc(t || "") + "</span>"; }

    // ---------- lead times ----------
    let _lead = null;
    function buildLead() {
        _lead = { vi: {}, v: {} };
        if (!D || !D.rc) return;
        const vi = {}, v = {};
        for (const r of D.rc) {
            const start = (D.poHead && D.poHead[r[2]] && D.poHead[r[2]].od) || r[3];
            if (!r[0] || !start) continue;
            const d = dDiff(r[0], start);
            if (d < 0 || d > 400) continue;
            (vi[r[1] + "|" + r[4]] = vi[r[1] + "|" + r[4]] || []).push(d);
            (v[r[1]] = v[r[1]] || []).push(d);
        }
        for (const k in vi) if (vi[k].length >= 2) _lead.vi[k] = { d: median(vi[k]), n: vi[k].length };
        for (const k in v) _lead.v[k] = { d: median(v[k]), n: v[k].length };
    }
    function leadDays(vendor, item) {
        if (!_lead) buildLead();
        if (vendor && leadOv[vendor] > 0) return { d: leadOv[vendor], src: "typed in" };
        const a = _lead.vi[vendor + "|" + item];
        if (a && a.d > 0) return { d: a.d, src: "measured (this item)" };
        const b = _lead.v[vendor];
        if (b && b.d > 0) return { d: b.d, src: "measured (vendor)" };
        return { d: DEFAULT_LEAD, src: "default" };
    }
    function setLead(vendor, val) {
        const n = parseFloat(val);
        if (n > 0) leadOv[vendor] = Math.round(n); else delete leadOv[vendor];
        try { localStorage.setItem("forecastProcLead", JSON.stringify(leadOv)); } catch (e) {}
        render();
    }

    // ---------- generic pieces ----------
    function tiles(list) {
        return '<div style="padding:12px 18px 4px;display:flex;gap:10px;flex-wrap:wrap;">' + list.map(function (t) {
            return '<div style="background:#e8eaf6;border-radius:8px;padding:10px 16px;min-width:128px;"' + (t.h ? H(t.l, t.h) : "") + ">"
                + '<div style="font-size:20px;font-weight:700;color:' + (t.c || "#1a237e") + ';">' + t.v + "</div>"
                + '<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">' + esc(t.l) + "</div></div>";
        }).join("") + "</div>";
    }
    function chip(active, call, label) { return plannerChip(active, "PROC." + call, label); }
    function note(text, warn) {
        return '<div style="margin:8px 18px;padding:8px 12px;border-radius:6px;font-size:12px;'
            + (warn ? "background:#fff8e1;color:#8d6e00;border:1px solid #ffe082;" : "background:#f8f9ff;color:#666;") + '">' + text + "</div>";
    }
    function shell(title, sub, controls, body) {
        return '<div class="table-container" style="margin-top:0;">'
            + '<div class="table-header-bar" style="flex-wrap:wrap;gap:10px;"><h2>' + esc(title) + '</h2><span class="count">' + sub + "</span>"
            + '<span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' + (controls || "") + "</span></div>" + body + "</div>";
    }
    function missing(part, what) {
        if (!D) return note(loading ? "Loading purchasing data…" : "Purchasing data is not loaded yet. It arrives with the next snapshot, or straight away with <strong>Login &amp; Load All Data</strong>.", true);
        if (part && !D[part]) return note("<strong>" + what + " not available from Wiise.</strong> " + esc((D.diagnostics && D.diagnostics[part]) || ""), true);
        return "";
    }
    // cols: { k, t, n (numeric), f(row) → html, v(row) → sort value, h help, csv(row) }
    function table(id, cols, rows, defSort) {
        const st = S.sort[id] || (S.sort[id] = defSort || { k: cols[0].k, d: 1 });
        const col = cols.find(function (c) { return c.k === st.k; }) || cols[0];
        const val = function (r) { const x = col.v ? col.v(r) : r[col.k]; return x == null ? (col.n ? -Infinity : "") : x; };
        rows.sort(function (a, b) {
            const x = val(a), y = val(b);
            if (typeof x === "number" && typeof y === "number") return (x - y) * st.d;
            return String(x).localeCompare(String(y)) * st.d;
        });
        S.last = { id: id, cols: cols, rows: rows };
        const lim = viewBase() * (S.pages[id] || 1);
        let h = '<div class="table-scroll"><table><thead><tr>';
        for (const c of cols) {
            const cls = "sortable" + (st.k === c.k ? (st.d > 0 ? " sorted-asc" : " sorted-desc") : "");
            h += '<th class="' + cls + '" style="padding:9px 10px;' + (c.n ? "text-align:right;" : "") + '" onclick="PROC.sortBy(\'' + id + "','" + c.k + "'," + (c.n ? 1 : 0) + ')"'
                + (c.h ? H(c.t, c.h) : "") + ">" + esc(c.t) + "</th>";
        }
        h += "</tr></thead><tbody>";
        const n = Math.min(rows.length, lim);
        for (let i = 0; i < n; i++) {
            const r = rows[i];
            h += "<tr>";
            for (const c of cols) {
                const raw = c.f ? c.f(r) : (c.n ? qty(r[c.k]) : esc(r[c.k] == null ? "" : r[c.k]));
                h += '<td style="padding:6px 10px;' + (c.n ? "text-align:right;" : "") + 'white-space:nowrap;">' + raw + "</td>";
            }
            h += "</tr>";
        }
        if (rows.length === 0) h += '<tr><td colspan="' + cols.length + '" style="padding:26px;text-align:center;color:#888;">Nothing to show for the current filters.</td></tr>';
        if (rows.length > lim) h += '<tr><td colspan="' + cols.length + '" style="padding:10px;text-align:center;color:#3f51b5;cursor:pointer;font-weight:600;" onclick="PROC.more(\'' + id + '\')">+' + (rows.length - lim).toLocaleString() + " more — click to show</td></tr>";
        return h + "</tbody></table></div>";
    }
    function sortBy(id, k, numeric) {
        const st = S.sort[id];
        if (st && st.k === k) st.d = -st.d; else S.sort[id] = { k: k, d: numeric ? -1 : 1 };
        render();
    }
    function more(id) { S.pages[id] = (S.pages[id] || 1) + 1; render(); }
    function set(key, value) { S[key] = value; S.pages = {}; render(); }

    // ---------- 1. Purchase Orders ----------
    function poRows(vendorOnly) {
        const rows = [];
        for (const r of (D.po || [])) {
            if (vendorOnly ? r[1] !== vendorOnly : (!inLoc(r[3]) || !vendorOK(r[1]))) continue;
            const d = r[9] || desc(r[2]);
            if (!vendorOnly && !match(r[2], d, r[0] + " " + vname(r[1]))) continue;
            const head = (D.poHead && D.poHead[r[0]]) || {};
            const late = r[8] ? dDiff(TODAY, r[8]) : null;
            rows.push({ doc: r[0], vendor: r[1], vl: vlabel(r[1]), od: head.od || "", item: r[2], desc: d, loc: r[3],
                qty: r[4], rec: r[6], out: r[5], exp: r[8], late: late, val: r[10] || r[5] * r[7] });
        }
        return rows;
    }
    function dueCell(r) {
        if (r.late == null) return badge("NO DATE", "#757575");
        if (r.late > 0) return badge(r.late + " d late", "#c62828");
        if (r.late >= -7) return badge(r.late === 0 ? "due today" : "due in " + (-r.late) + " d", "#e65100");
        return '<span style="color:#888;">in ' + (-r.late) + " d</span>";
    }
    const PO_COLS = [
        { k: "doc", t: "PO No.", h: "The purchase order number in Wiise." },
        { k: "vl", t: "Vendor", h: "Who the order was placed with.", f: function (r) { return '<a href="#" onclick="PROC.openVendor(\'' + escAttr(r.vendor) + '\');return false;" style="color:#1a237e;text-decoration:none;">' + esc(r.vl) + "</a>"; } },
        { k: "od", t: "Ordered", h: "The date on the purchase order.", f: function (r) { return dmy(r.od); } },
        { k: "item", t: "Item", h: "Item code. Click to open the item window.", f: function (r) { return itemLink(r.item); } },
        { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
        { k: "loc", t: "Branch", h: "The branch the stock is coming in to.", f: function (r) { return esc(locShort(r.loc)); } },
        { k: "qty", t: "Ordered Qty", n: 1, h: "Quantity on the order line." },
        { k: "rec", t: "Received", n: 1, h: "Quantity already received against this line." },
        { k: "out", t: "Outstanding", n: 1, h: "Quantity still to arrive.", f: function (r) { return "<strong>" + qty(r.out) + "</strong>"; } },
        { k: "exp", t: "Expected", h: "Expected receipt date on the order line in Wiise.", f: function (r) { return dmy(r.exp); } },
        { k: "late", t: "Due", n: 1, h: "Days past (or until) the expected receipt date. Red means the line is overdue.", f: dueCell },
        { k: "val", t: "Value Outstanding", n: 1, h: "Cost of the quantity still to arrive, in Australian dollars, before GST.", f: function (r) { return money(r.val); } },
    ];
    function tabPO() {
        const miss = missing("po", "Open purchase orders");
        if (miss) return shell("Purchase Orders", "", "", miss);
        const all = poRows();
        const f = S.poFilter;
        const rows = all.filter(function (r) {
            if (f === "overdue") return r.late > 0;
            if (f === "week") return r.late != null && r.late <= 0 && r.late >= -7;
            return true;
        });
        const docs = {}; let val = 0, od = 0, odVal = 0, wk = 0;
        for (const r of all) { docs[r.doc] = 1; val += r.val; if (r.late > 0) { od++; odVal += r.val; } if (r.late != null && r.late <= 0 && r.late >= -7) wk++; }
        const controls = chip(f === "all", "set('poFilter','all')", "All") + chip(f === "overdue", "set('poFilter','overdue')", "Overdue") + chip(f === "week", "set('poFilter','week')", "Due in 7 days");
        return shell("Purchase Orders", rows.length.toLocaleString() + " open lines" + (asOf ? " · " + esc(asOf) : ""), controls,
            tiles([
                { l: "Open orders", v: Object.keys(docs).length.toLocaleString(), h: "Purchase orders with something still to arrive." },
                { l: "Open lines", v: all.length.toLocaleString(), h: "Order lines with a quantity still outstanding." },
                { l: "On order", v: money(val), h: "Cost of everything still to arrive, before GST." },
                { l: "Overdue lines", v: od.toLocaleString(), c: od ? "#c62828" : "#2e7d32", h: "Lines whose expected receipt date has passed. Worth " + money(odVal) + "." },
                { l: "Due in 7 days", v: wk.toLocaleString(), c: "#e65100", h: "Lines expected within the next week." },
            ]) + table("po", PO_COLS, rows, { k: "late", d: -1 }));
    }

    // ---------- 2. Buy List ----------
    function buyRows(windowDays) {
        const pct = 1 + increasePct() / 100;
        const rows = [];
        for (const r of baseRows()) {
            const monthly = (r.monthlyAvg || 0) * pct, daily = monthly / 30.4;
            const pos = r.availInv - r.salesQty + r.purchQty;
            const floor = r.skuMin || 0;
            const ld = leadDays(r.vendorNo, r.itemNo);
            const daysToFloor = daily > 0 ? (pos - floor) / daily : (pos < floor ? 0 : Infinity);
            const orderIn = daysToFloor - ld.d;
            let need = Math.max(r.net, floor - pos);
            if (!(need > 0) || orderIn > windowDays) continue;
            need = Math.ceil(need);
            const mult = r.skuMult > 1 ? r.skuMult : 0;
            const buy = mult ? Math.ceil(need / mult) * mult : need;
            rows.push({ item: r.itemNo, desc: r.description, vendor: r.vendorNo, vl: vlabel(r.vendorNo), inv: r.availInv, so: r.salesQty, po: r.purchQty,
                min: r.skuMin, monthly: monthly, cover: daily > 0 ? pos / monthly : null, lead: ld.d, leadSrc: ld.src,
                orderIn: isFinite(orderIn) ? Math.floor(orderIn) : 9999, buy: buy, mult: mult, unit: cost(r.itemNo), val: buy * cost(r.itemNo) });
        }
        return rows;
    }
    const BUY_COLS = [
        { k: "vl", t: "Vendor", h: "The item's vendor in Wiise.", f: function (r) { return r.vendor ? '<a href="#" onclick="PROC.openVendor(\'' + escAttr(r.vendor) + '\');return false;" style="color:#1a237e;text-decoration:none;">' + esc(r.vl) + "</a>" : '<span style="color:#888;">No vendor</span>'; } },
        { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
        { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
        { k: "orderIn", t: "Order By", n: 1, h: "The latest day to place the order so stock arrives before it drops to the Min level (or to zero when no Min is set). Stock position less the lead time.",
            f: function (r) { return r.orderIn <= 0 ? badge("ORDER NOW", "#c62828") : badge(dmy(addDays(TODAY, r.orderIn)), r.orderIn <= 7 ? "#e65100" : "#1565c0"); },
            csv: function (r) { return r.orderIn <= 0 ? "Now" : dmy(addDays(TODAY, r.orderIn)); } },
        { k: "buy", t: "Order Qty", n: 1, h: "Suggested quantity: what the Forecast Period needs after stock, sales orders and purchase orders, and at least enough to reach the Min. Rounded up to the order multiple.", f: function (r) { return "<strong>" + qty(r.buy) + "</strong>" + (r.mult ? ' <span style="color:#888;font-size:10.5px;">lots of ' + qty(r.mult) + "</span>" : ""); } },
        { k: "inv", t: "On Hand", n: 1, h: "Stock on hand for the selected branches." },
        { k: "so", t: "On SO", n: 1, h: "Quantity on open sales orders." },
        { k: "po", t: "On PO", n: 1, h: "Quantity already on open purchase orders." },
        { k: "min", t: "Min", n: 1, h: "Reorder point from the stockkeeping unit in Wiise." },
        { k: "monthly", t: "Use / Month", n: 1, h: "Average monthly usage under the selected forecast method, including the Increase %." },
        { k: "cover", t: "Cover (Months)", n: 1, h: "How long stock on hand plus purchase orders, less sales orders, lasts at the monthly usage.", f: function (r) { return r.cover == null ? "-" : r.cover.toFixed(1); } },
        { k: "lead", t: "Lead (Days)", n: 1, h: "Days from order to arrival: typed in on the Vendors tab, else measured from past receipts, else " + DEFAULT_LEAD + " days.", f: function (r) { return r.lead + ' <span style="color:#888;font-size:10.5px;">' + esc(r.leadSrc) + "</span>"; }, csv: function (r) { return r.lead; } },
        { k: "val", t: "Est. Value", n: 1, h: "Order quantity at the item's unit cost.", f: function (r) { return r.unit ? money(r.val) : "-"; } },
    ];
    function tabBuy() {
        if (!D) return shell("Buy List", "", "", missing());
        const w = S.buyWindow;
        const rows = buyRows(w);
        const vs = {}; let now = 0, val = 0;
        for (const r of rows) { vs[r.vendor] = 1; if (r.orderIn <= 0) now++; val += r.val; }
        const controls = chip(w === 0, "set('buyWindow',0)", "Order now") + chip(w === 14, "set('buyWindow',14)", "Next 2 weeks") + chip(w === 30, "set('buyWindow',30)", "Next month") + chip(w === Infinity, "set('buyWindow',Infinity)", "Everything needed");
        return shell("Buy List", rows.length.toLocaleString() + " items to order", controls,
            tiles([
                { l: "Items to order", v: rows.length.toLocaleString(), h: "Items whose order-by date falls inside the chosen window." },
                { l: "Order now", v: now.toLocaleString(), c: now ? "#c62828" : "#2e7d32", h: "Items already at or past their order-by date." },
                { l: "Vendors", v: Object.keys(vs).length.toLocaleString(), h: "Vendors these items come from." },
                { l: "Est. value", v: money(val), h: "Suggested quantities at unit cost. Items without a cost count as zero." },
            ]) + note("An item is listed when its stock position (on hand − sales orders + purchase orders) will reach the Min before a new order could arrive. Lead time: typed in on the Vendors tab, else measured from past receipts, else " + DEFAULT_LEAD + " days. Export CSV gives a PO-ready list by vendor.")
            + table("buy", BUY_COLS, rows, { k: "orderIn", d: 1 }));
    }

    // ---------- 3. Back Orders ----------
    function backRows() {
        const useLoc = !!(locData && locData.inv);
        const key = function (item, loc) { return useLoc ? item + "|" + loc : item; };
        const groups = {};
        for (const r of (D.so || [])) (groups[key(r[2], r[3])] = groups[key(r[2], r[3])] || []).push(r);
        const supply = {};
        for (const r of (D.po || [])) (supply[key(r[2], r[3])] = supply[key(r[2], r[3])] || []).push({ doc: r[0], vendor: r[1], exp: r[8], left: r[5] });
        const rows = [];
        const far = "9999-12-31";
        for (const k in groups) {
            const lines = groups[k].slice().sort(function (a, b) { return (a[5] || far).localeCompare(b[5] || far); });
            const item = lines[0][2], loc = lines[0][3];
            let stock = useLoc ? ((locData.inv[item] || {})[loc] || 0) : ((orderData[item] || {}).availInv || 0);
            const pos = (supply[k] || []).sort(function (a, b) { return (a.exp || far).localeCompare(b.exp || far); });
            for (const l of lines) {
                const take = Math.max(0, Math.min(stock, l[4]));
                stock -= take;
                let short = l[4] - take;
                if (short <= 0.0001) continue;
                let need = short, cover = null;
                for (const p of pos) {
                    if (need <= 0) break;
                    if (p.left <= 0) continue;
                    const t = Math.min(p.left, need);
                    p.left -= t; need -= t; cover = p;
                }
                const fully = need <= 0.0001;
                let status, rank;
                if (!cover) { status = "NO PO"; rank = 0; }
                else if (!fully) { status = "PO TOO SMALL"; rank = 1; }
                else if (cover.exp && cover.exp < TODAY) { status = "PO OVERDUE"; rank = 2; }
                else if (cover.exp && l[5] && cover.exp > l[5]) { status = "LATE FOR CUSTOMER"; rank = 3; }
                else { status = "ON ORDER"; rank = 4; }
                const vendor = cover ? cover.vendor : itemVendor(item);
                if (!inLoc(loc) || !(vendorOK(vendor) || itemVendorOK(item))) continue;
                const cust = (D.soHead && D.soHead[l[0]]) || l[1];
                const d = desc(item);
                if (special(item) || !match(item, d, l[0] + " " + cust)) continue;
                rows.push({ so: l[0], cust: cust, item: item, desc: d, loc: loc, ship: l[5], out: l[4], short: short,
                    po: cover ? cover.doc : "", poExp: cover ? cover.exp : "", vl: vendor ? vlabel(vendor) : "", status: status, rank: rank,
                    wait: (cover && cover.exp && l[5]) ? dDiff(cover.exp, l[5]) : null });
            }
        }
        return rows;
    }
    const BACK_COLOR = { "NO PO": "#c62828", "PO TOO SMALL": "#c62828", "PO OVERDUE": "#ad1457", "LATE FOR CUSTOMER": "#e65100", "ON ORDER": "#2e7d32" };
    const BACK_COLS = [
        { k: "rank", t: "Status", h: "NO PO: nothing on order covers this line. PO TOO SMALL: open orders cover only part of it. PO OVERDUE: the covering order's expected date has passed. LATE FOR CUSTOMER: the order lands after the customer's shipment date. ON ORDER: covered in time.", f: function (r) { return badge(r.status, BACK_COLOR[r.status]); }, csv: function (r) { return r.status; } },
        { k: "so", t: "Sales Order", h: "The sales order waiting on stock." },
        { k: "cust", t: "Customer", f: function (r) { return descCell(r.cust); } },
        { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
        { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
        { k: "loc", t: "Branch", f: function (r) { return esc(locShort(r.loc)); } },
        { k: "ship", t: "Ship Date", h: "Shipment date on the sales order line.", f: function (r) { return dmy(r.ship); } },
        { k: "out", t: "Ordered", n: 1, h: "Quantity still to ship on this line." },
        { k: "short", t: "Short", n: 1, h: "How much of the line stock on hand cannot fill, after earlier sales orders took their share.", f: function (r) { return '<strong style="color:#c62828;">' + qty(r.short) + "</strong>"; } },
        { k: "po", t: "Covered By PO", h: "The purchase order that fills the shortfall, taking open orders in date order." },
        { k: "poExp", t: "PO Expected", f: function (r) { return dmy(r.poExp); } },
        { k: "wait", t: "Days After Ship Date", n: 1, h: "How many days after the customer's shipment date the purchase order is expected. Zero or less means it lands in time.", f: function (r) { return r.wait == null ? "-" : (r.wait > 0 ? "+" + r.wait : String(r.wait)); } },
        { k: "vl", t: "Vendor" },
    ];
    function tabBack() {
        const miss = missing("so", "Open sales order lines");
        if (miss) return shell("Back Orders", "", "", miss);
        const all = backRows();
        const f = S.backFilter;
        const rows = all.filter(function (r) { return f === "all" || (f === "nopo" ? r.rank <= 1 : r.rank >= 2 && r.rank <= 3); });
        const so = {}, cu = {}; let nopo = 0, units = 0, late = 0;
        for (const r of all) { so[r.so] = 1; cu[r.cust] = 1; if (r.rank <= 1) nopo++; if (r.rank === 2 || r.rank === 3) late++; units += r.short; }
        const controls = chip(f === "all", "set('backFilter','all')", "All") + chip(f === "nopo", "set('backFilter','nopo')", "Not covered") + chip(f === "late", "set('backFilter','late')", "Covered late");
        return shell("Back Orders", rows.length.toLocaleString() + " sales order lines short of stock", controls,
            tiles([
                { l: "Lines short", v: all.length.toLocaleString(), h: "Sales order lines stock on hand cannot fill." },
                { l: "Orders affected", v: Object.keys(so).length.toLocaleString() },
                { l: "Customers", v: Object.keys(cu).length.toLocaleString() },
                { l: "Not covered", v: nopo.toLocaleString(), c: nopo ? "#c62828" : "#2e7d32", h: "Lines with no purchase order, or one too small, behind them." },
                { l: "Covered late", v: late.toLocaleString(), c: "#e65100", h: "Lines whose purchase order is overdue or lands after the shipment date." },
                { l: "Units short", v: qty(Math.ceil(units)) },
            ]) + (D.po ? "" : note("<strong>Open purchase orders not available</strong>, so every short line shows as NO PO.", true))
            + note("Stock on hand at each branch is given to that branch's sales orders in shipment-date order. Whatever is left short is matched to open purchase orders for the same branch, earliest expected date first.")
            + table("back", BACK_COLS, rows, { k: "rank", d: 1 }));
    }

    // ---------- 4. Stock Runway ----------
    function runwayRows() {
        const W = S.runwayWeeks;
        const pct = 1 + increasePct() / 100;
        const arr = {}, due = {}, nextPo = {};
        const wk = function (d) { return d ? Math.max(0, Math.floor(dDiff(d, TODAY) / 7)) : 0; };
        if (D.po) for (const r of D.po) {
            if (!inLoc(r[3])) continue;
            const w = wk(r[8]);
            if (w < W) { (arr[r[2]] = arr[r[2]] || {})[w] = ((arr[r[2]] || {})[w] || 0) + r[5]; }
            if (!nextPo[r[2]] || (r[8] || "") < nextPo[r[2]]) nextPo[r[2]] = r[8] || TODAY;
        }
        if (D.so) for (const r of D.so) {
            if (!inLoc(r[3])) continue;
            const w = wk(r[5]);
            if (w < W) (due[r[2]] = due[r[2]] || {})[w] = ((due[r[2]] || {})[w] || 0) + r[4];
        }
        const rows = [];
        for (const r of baseRows()) {
            const weekly = (r.monthlyAvg || 0) * pct / 30.4 * 7;
            const a = D.po ? (arr[r.itemNo] || {}) : { 0: r.purchQty };
            const s = D.so ? (due[r.itemNo] || {}) : { 0: r.salesQty };
            if (!(weekly > 0) && !Object.keys(s).length) continue;
            let stock = r.availInv, out = -1, outDay = null;
            const cells = [];
            for (let w = 0; w < W; w++) {
                const open = stock + (a[w] || 0) - (s[w] || 0);
                stock = open - weekly;
                if (out < 0 && stock < 0) {
                    out = w;
                    outDay = w * 7 + (weekly > 0 ? Math.max(0, Math.min(7, Math.floor(open / weekly * 7))) : 0);
                }
                cells.push(stock);
            }
            const np = nextPo[r.itemNo] || "";
            const outDate = out >= 0 ? addDays(TODAY, outDay) : "";
            let status, rank;
            if (out < 0) { status = "OK"; rank = 3; }
            else if (!np && !(r.purchQty > 0)) { status = "NO PO"; rank = 0; }
            else {
                let later = false;
                if (D.po) for (const p of D.po) if (p[2] === r.itemNo && inLoc(p[3]) && (p[8] || "") > outDate) { later = true; break; }
                status = later ? "PO LANDS LATE" : "ORDER MORE"; rank = later ? 1 : 2;
            }
            if (!S.runwayAll && out < 0) continue;
            rows.push({ item: r.itemNo, desc: r.description, vl: vlabel(r.vendorNo), inv: r.availInv, weekly: weekly, min: r.skuMin || 0,
                cells: cells, out: out < 0 ? 999 : outDay, outDate: outDate, np: np, status: status, rank: rank });
        }
        return rows;
    }
    const RUN_COLOR = { "NO PO": "#c62828", "PO LANDS LATE": "#e65100", "ORDER MORE": "#ad1457", "OK": "#2e7d32" };
    function tabRunway() {
        if (!D) return shell("Stock Runway", "", "", missing());
        const W = S.runwayWeeks;
        const rows = runwayRows();
        const cols = [
            { k: "rank", t: "Status", h: "NO PO: stock runs out and nothing is on order. PO LANDS LATE: an order is coming but after stock runs out. ORDER MORE: the open orders arrive in time but are not enough. OK: stock lasts the whole period.", f: function (r) { return badge(r.status, RUN_COLOR[r.status]); }, csv: function (r) { return r.status; } },
            { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
            { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
            { k: "vl", t: "Vendor" },
            { k: "inv", t: "On Hand", n: 1, h: "Stock on hand today for the selected branches." },
            { k: "weekly", t: "Use / Week", n: 1, h: "Forecast usage per week under the selected method, including the Increase %." },
            { k: "out", t: "Runs Out", n: 1, h: "The day projected stock goes below zero.", f: function (r) { return r.outDate ? '<strong style="color:#c62828;">' + dmy(r.outDate) + "</strong>" : "-"; }, csv: function (r) { return dmy(r.outDate); } },
            { k: "np", t: "Next PO", h: "Earliest expected date among this item's open purchase orders. A date in the past means the order is overdue and is counted as arriving this week.", f: function (r) { return r.np ? (r.np < TODAY ? '<span style="color:#c62828;">' + dmy(r.np) + "</span>" : dmy(r.np)) : "-"; } },
        ];
        for (let w = 0; w < W; w++) {
            (function (w) {
                cols.push({ k: "w" + w, t: dmy(addDays(TODAY, w * 7)).slice(0, 5), n: 1,
                    h: "Projected stock at the end of the week starting on this date: last week's stock, plus purchase orders expected that week, less sales orders due that week, less forecast usage.",
                    v: function (r) { return r.cells[w]; },
                    f: function (r) {
                        const v = r.cells[w];
                        const bg = v < 0 ? "background:#ffcdd2;color:#b71c1c;font-weight:700;" : (r.min > 0 && v < r.min ? "background:#ffe0b2;color:#bf360c;" : "");
                        return '<span style="display:inline-block;min-width:44px;padding:1px 5px;border-radius:4px;' + bg + '">' + Math.round(v).toLocaleString() + "</span>";
                    },
                    csv: function (r) { return Math.round(r.cells[w]); } });
            })(w);
        }
        let nopo = 0, late = 0, moreN = 0;
        for (const r of rows) { if (r.rank === 0) nopo++; else if (r.rank === 1) late++; else if (r.rank === 2) moreN++; }
        const controls = chip(W === 8, "set('runwayWeeks',8)", "8 weeks") + chip(W === 12, "set('runwayWeeks',12)", "12 weeks") + chip(W === 26, "set('runwayWeeks',26)", "26 weeks")
            + '<span style="width:10px;"></span>' + chip(S.runwayAll, "set('runwayAll'," + (!S.runwayAll) + ")", "Show items that last");
        return shell("Stock Runway", rows.length.toLocaleString() + " items" + (S.runwayAll ? "" : " that run out within " + W + " weeks"), controls,
            tiles([
                { l: "Run out, no PO", v: nopo.toLocaleString(), c: nopo ? "#c62828" : "#2e7d32", h: "Items that run out with nothing on order." },
                { l: "PO lands late", v: late.toLocaleString(), c: "#e65100", h: "Items that run out before their next purchase order arrives." },
                { l: "Order more", v: moreN.toLocaleString(), c: "#ad1457", h: "Items whose open orders arrive in time but do not last the period." },
            ]) + ((D.po && D.so) ? "" : note("<strong>Dated order lines not available</strong> — open orders are counted in the first week.", true))
            + note("Week by week: stock on hand, plus purchase orders in the week they are expected, less sales orders in the week they are due, less forecast usage. Red = below zero, amber = below Min. Overdue purchase orders are counted as arriving this week.")
            + table("runway", cols, rows, { k: "out", d: 1 }));
    }

    // ---------- 5. Branch Transfers ----------
    function realLocs() {
        const skip = { DEFAULT: 1 };
        for (const t of ((D && D.transit) || [])) skip[t] = 1;
        const set = {};
        for (const map of [locData.inv, locData.sku]) if (map) for (const it in map) for (const l in map[it]) if (!skip[l]) set[l] = 1;
        return Object.keys(set).sort();
    }
    function transferRows() {
        const L = realLocs();
        const transitIn = {};
        for (const t of ((D && D.tr) || [])) transitIn[t[3] + "|" + t[2]] = (transitIn[t[3] + "|" + t[2]] || 0) + t[4];
        const rows = [];
        const months = Math.max(1, totalMonthsGlobal || 1);
        for (const item in locData.inv) {
            if (special(item) || !itemVendorOK(item)) continue;
            const d = desc(item);
            if (!match(item, d)) continue;
            const it = itemIdx[item];
            const inv = locData.inv[item] || {}, so = (locData.so && locData.so[item]) || {}, po = (locData.po && locData.po[item]) || {};
            const sku = (locData.sku && locData.sku[item]) || {};
            const shorts = [], spare = [];
            for (const l of L) {
                const avg = it ? Math.max(0, (it.location_usage && it.location_usage[l]) || 0) / months : 0;
                const mm = sku[l] || {};
                const tin = transitIn[item + "|" + l] || 0;
                const pos = (inv[l] || 0) - (so[l] || 0) + (po[l] || 0) + tin;
                if (mm.min > 0 && pos < mm.min) shorts.push({ l: l, q: Math.ceil(mm.min - pos), inv: inv[l] || 0, min: mm.min, pos: pos, tin: tin, why: "below Min" });
                else if (S.trNoMin && !(mm.min > 0) && avg > 0 && pos < avg) shorts.push({ l: l, q: Math.ceil(avg - pos), inv: inv[l] || 0, min: 0, pos: pos, tin: tin, why: "under 1 month of usage" });
                const keep = mm.max > 0 ? mm.max : Math.max(mm.min || 0, Math.ceil(avg * 6));
                const free = Math.floor((inv[l] || 0) - (so[l] || 0) - keep);
                if (free > 0) spare.push({ l: l, q: free, inv: inv[l] || 0, keep: keep });
            }
            if (!shorts.length || !spare.length) continue;
            shorts.sort(function (a, b) { return b.q - a.q; });
            for (const s of shorts) {
                spare.sort(function (a, b) { return b.q - a.q; });
                for (const p of spare) {
                    if (s.q <= 0) break;
                    if (p.l === s.l || p.q <= 0) continue;
                    const t = Math.min(s.q, p.q);
                    if (inLoc(s.l) || inLoc(p.l)) rows.push({ item: item, desc: d, from: p.l, fromInv: p.inv, fromKeep: p.keep, spare: p.q, to: s.l, toInv: s.inv, toMin: s.min,
                        short: s.q, move: t, tin: s.tin, why: s.why, val: t * cost(item) });
                    s.q -= t; p.q -= t;
                }
            }
        }
        return rows;
    }
    const TR_COLS = [
        { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
        { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
        { k: "from", t: "From", h: "The branch holding more than it needs.", f: function (r) { return "<strong>" + esc(locShort(r.from)) + "</strong>"; } },
        { k: "fromInv", t: "From On Hand", n: 1 },
        { k: "fromKeep", t: "From Keeps", n: 1, h: "What the sending branch holds on to: its Max when one is set, otherwise the larger of its Min and six months of its own usage." },
        { k: "spare", t: "Spare", n: 1, h: "Stock on hand at the sending branch, less its sales orders, less what it keeps." },
        { k: "to", t: "To", h: "The branch that is short.", f: function (r) { return "<strong>" + esc(locShort(r.to)) + "</strong>"; } },
        { k: "toInv", t: "To On Hand", n: 1 },
        { k: "toMin", t: "To Min", n: 1, h: "Reorder point at the receiving branch." },
        { k: "short", t: "Short By", n: 1, h: "How far the receiving branch's stock position (on hand − sales orders + purchase orders + transfers already coming) is below its Min." },
        { k: "tin", t: "In Transit", n: 1, h: "Already on an open transfer order to the receiving branch. This is counted before a shortage is called." },
        { k: "move", t: "Transfer Qty", n: 1, h: "Suggested quantity to move.", f: function (r) { return '<strong style="color:#1565c0;">' + qty(r.move) + "</strong>"; } },
        { k: "val", t: "Purchase Avoided", n: 1, h: "Transfer quantity at unit cost: what would otherwise be bought.", f: function (r) { return r.val ? money(r.val) : "-"; } },
        { k: "why", t: "Reason" },
    ];
    function tabTransfer() {
        if (!locData || !locData.inv) return shell("Branch Transfers", "", "", note("<strong>Branch stock is not loaded.</strong> This tab needs stock per branch, which comes with a snapshot or a live load.", true));
        const rows = transferRows();
        const items = {}; let units = 0, val = 0;
        for (const r of rows) { items[r.item] = 1; units += r.move; val += r.val; }
        const controls = chip(S.trNoMin, "set('trNoMin'," + (!S.trNoMin) + ")", "Include branches without a Min");
        return shell("Branch Transfers", rows.length.toLocaleString() + " suggested transfers", controls,
            tiles([
                { l: "Transfers", v: rows.length.toLocaleString(), h: "Suggested movements between branches." },
                { l: "Items", v: Object.keys(items).length.toLocaleString() },
                { l: "Units to move", v: qty(units) },
                { l: "Purchases avoided", v: money(val), c: "#2e7d32", h: "Value at unit cost of the stock moved instead of bought." },
            ]) + ((D && D.tr) ? "" : note("Open transfer orders are not loaded, so stock already in transit is not counted.", true))
            + note("A branch is short when its stock position is below its Min. A branch has spare stock when it holds more than its Max (or, with no Max, more than its Min and six months of its own usage). The branch filter shows transfers into or out of the chosen branches.")
            + table("transfer", TR_COLS, rows, { k: "val", d: -1 }));
    }

    // ---------- 6. Min/Max Review ----------
    const MM_COLOR = { "NO MIN SET": "#c62828", "MIN TOO LOW": "#e65100", "MAX BELOW NEED": "#e65100", "MIN TOO HIGH": "#1565c0", "NO USAGE": "#6a1b9a", "OK": "#2e7d32" };
    function minmaxRows() {
        const L = realLocs();
        const months = Math.max(1, totalMonthsGlobal || 1);
        const sku = (locData && locData.sku) || {};
        const seen = {};
        const rows = [];
        const one = function (item) {
            if (seen[item]) return; seen[item] = 1;
            if (special(item) || !itemVendorOK(item)) return;
            const it = itemIdx[item], d = desc(item);
            if (!match(item, d)) return;
            const vendor = itemVendor(item);
            const ld = leadDays(vendor, item).d;
            for (const l of L) {
                if (!inLoc(l)) continue;
                const mm = (sku[item] && sku[item][l]) || null;
                if (mm && mm.pol) continue;   // back-to-back items carry no stock levels
                const avg = it ? Math.max(0, (it.location_usage && it.location_usage[l]) || 0) / months : 0;
                const min = mm ? (mm.min || 0) : 0, max = mm ? (mm.max || 0) : 0;
                if (!(avg > 0) && !(min > 0)) continue;
                let sold = 0;
                const lm = it && it.location_months && it.location_months[l];
                if (lm) for (const ym in lm) if (lm[ym] > 0) sold++;
                const sMin = Math.ceil(avg / 30.4 * (ld + SAFETY_DAYS)), sMax = Math.ceil(sMin + avg * 2);
                let flag = "OK", rank = 9;
                if (!(avg > 0) && min > 0) { flag = "NO USAGE"; rank = 4; }
                else if (!(min > 0)) { if (sold >= 3) { flag = "NO MIN SET"; rank = 0; } else continue; }
                else if (min < 0.6 * sMin) { flag = "MIN TOO LOW"; rank = 1; }
                else if (max > 0 && max < sMin) { flag = "MAX BELOW NEED"; rank = 2; }
                else if (min > 1.6 * sMin && min - sMin >= 2) { flag = "MIN TOO HIGH"; rank = 3; }
                if (flag === "OK" && !S.mmAll) continue;
                rows.push({ item: item, desc: d, vl: vlabel(vendor), loc: l, avg: avg, sold: sold, lead: ld, min: min, max: max, sMin: sMin, sMax: sMax,
                    diff: sMin - min, flag: flag, rank: rank, val: Math.abs(sMin - min) * cost(item) });
            }
        };
        for (const d of allData) one(d.item_no);
        for (const item in sku) one(item);
        return rows;
    }
    const MM_COLS = [
        { k: "rank", t: "Flag", h: "NO MIN SET: sold in three or more months at this branch but no Min. MIN TOO LOW: under 60% of the suggested Min. MAX BELOW NEED: the Max is under the suggested Min. MIN TOO HIGH: over 160% of the suggested Min. NO USAGE: a Min is set but nothing was used in the period.", f: function (r) { return badge(r.flag, MM_COLOR[r.flag]); }, csv: function (r) { return r.flag; } },
        { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
        { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
        { k: "vl", t: "Vendor" },
        { k: "loc", t: "Branch", f: function (r) { return esc(locShort(r.loc)); } },
        { k: "avg", t: "Use / Month", n: 1, h: "Average monthly usage at this branch over the date range." },
        { k: "sold", t: "Months Used", n: 1, h: "How many months in the date range had usage at this branch." },
        { k: "lead", t: "Lead (Days)", n: 1, h: "Lead time used for the suggestion." },
        { k: "min", t: "Min Now", n: 1, h: "Reorder point on the stockkeeping unit in Wiise." },
        { k: "max", t: "Max Now", n: 1, h: "Maximum inventory on the stockkeeping unit in Wiise." },
        { k: "sMin", t: "Suggested Min", n: 1, h: "Usage during the lead time plus " + SAFETY_DAYS + " days of safety stock.", f: function (r) { return "<strong>" + qty(r.sMin) + "</strong>"; } },
        { k: "sMax", t: "Suggested Max", n: 1, h: "Suggested Min plus two months of usage.", f: function (r) { return "<strong>" + qty(r.sMax) + "</strong>"; } },
        { k: "diff", t: "Min Change", n: 1, h: "Suggested Min less the Min now.", f: function (r) { return (r.diff > 0 ? "+" : "") + qty(r.diff); } },
    ];
    function tabMinMax() {
        if (!locData || !locData.sku) return shell("Min/Max Review", "", "", note("<strong>Stockkeeping unit levels are not loaded.</strong> This tab needs Min/Max per branch, which comes with a snapshot or a live load.", true));
        const rows = minmaxRows();
        const c = {};
        for (const r of rows) c[r.flag] = (c[r.flag] || 0) + 1;
        const controls = chip(S.mmAll, "set('mmAll'," + (!S.mmAll) + ")", "Show OK rows");
        return shell("Min/Max Review", rows.length.toLocaleString() + " item × branch rows", controls,
            tiles([
                { l: "No Min set", v: (c["NO MIN SET"] || 0).toLocaleString(), c: "#c62828", h: "Regularly used at the branch, but no reorder point." },
                { l: "Min too low", v: (c["MIN TOO LOW"] || 0).toLocaleString(), c: "#e65100", h: "The Min would not cover the lead time." },
                { l: "Max below need", v: (c["MAX BELOW NEED"] || 0).toLocaleString(), c: "#e65100" },
                { l: "Min too high", v: (c["MIN TOO HIGH"] || 0).toLocaleString(), c: "#1565c0", h: "More safety stock than usage justifies." },
                { l: "No usage", v: (c["NO USAGE"] || 0).toLocaleString(), c: "#6a1b9a", h: "A Min is set but the item was not used at the branch in the date range." },
            ]) + note("Suggested Min = usage during the lead time + " + SAFETY_DAYS + " days of safety stock. Suggested Max = suggested Min + two months of usage. Usage is this branch's own, over the date range at the top. Nothing is written back to Wiise.")
            + table("minmax", MM_COLS, rows, { k: "rank", d: 1 }));
    }

    // ---------- 7. Vendors ----------
    function fyStart() { const y = +TODAY.slice(0, 4), m = +TODAY.slice(5, 7); return (m >= 7 ? y : y - 1) + "-07-01"; }
    function priceChanges(vendor) {
        const by = {};
        for (const r of (D.inv || [])) {
            if (r[1] !== vendor || !(r[3] > 0) || !(r[4] > 0)) continue;
            (by[r[2]] = by[r[2]] || []).push(r);
        }
        const out = [];
        for (const item in by) {
            const days = {};
            for (const r of by[item]) { const d = days[r[0]] = days[r[0]] || { q: 0, a: 0 }; d.q += r[3]; d.a += r[4]; }
            const ds = Object.keys(days).sort();
            if (ds.length < 2) continue;
            const last = days[ds[ds.length - 1]], prev = days[ds[ds.length - 2]];
            const p1 = last.a / last.q, p0 = prev.a / prev.q;
            if (!(p0 > 0)) continue;
            const ch = (p1 - p0) / p0 * 100;
            if (Math.abs(ch) < 1) continue;
            out.push({ item: item, desc: desc(item), d0: ds[ds.length - 2], p0: p0, d1: ds[ds.length - 1], p1: p1, ch: ch });
        }
        return out;
    }
    function vendorRows() {
        const V = {};
        const get = function (v) { return V[v] || (V[v] = { vendor: v, vl: vlabel(v), pos: {}, lines: 0, val: 0, od: 0, worst: 0, rcN: 0, onT: 0, onN: 0, fy: 0, tot: 0, items: 0, below: 0 }); };
        const fy = fyStart();
        for (const r of (D.po || [])) {
            if (!inLoc(r[3])) continue;
            const v = get(r[1]);
            v.pos[r[0]] = 1; v.lines++; v.val += r[10] || r[5] * r[7];
            const late = r[8] ? dDiff(TODAY, r[8]) : 0;
            if (late > 0) { v.od++; if (late > v.worst) v.worst = late; }
        }
        for (const r of (D.rc || [])) {
            const v = get(r[1]);
            v.rcN++;
            if (r[0] && r[6]) { v.onN++; if (r[0] <= r[6]) v.onT++; }
        }
        let total = 0;
        for (const r of (D.inv || [])) {
            const v = get(r[1]);
            v.tot += r[4];
            if (r[0] >= fy) { v.fy += r[4]; total += r[4]; }
        }
        for (const r of plannerAllRows()) {
            if (!r.vendorNo) continue;
            const v = get(r.vendorNo);
            v.items++;
            if (r.skuMin > 0 && (r.availInv - r.salesQty + r.purchQty) < r.skuMin) v.below++;
        }
        if (!_lead) buildLead();
        const rows = [];
        for (const k in V) {
            const v = V[k];
            if (!k || !vendorOK(k) || !match(k, v.vl)) continue;
            v.posN = Object.keys(v.pos).length;
            const m = _lead.v[k];
            v.lead = leadOv[k] > 0 ? leadOv[k] : (m ? m.d : null);
            v.leadTyped = leadOv[k] > 0;
            v.onPct = v.onN ? v.onT / v.onN * 100 : null;
            v.share = total > 0 ? v.fy / total * 100 : 0;
            v.pc = D.inv ? priceChanges(k).length : 0;
            rows.push(v);
        }
        return rows;
    }
    const V_COLS = [
        { k: "vl", t: "Vendor", h: "Click a vendor for their open orders, price changes and receipts.", f: function (r) { return '<a href="#" onclick="PROC.openVendor(\'' + escAttr(r.vendor) + '\');return false;" style="color:#1a237e;font-weight:600;text-decoration:none;">' + esc(r.vl) + "</a>"; } },
        { k: "posN", t: "Open POs", n: 1, h: "Purchase orders with something still to arrive." },
        { k: "lines", t: "Open Lines", n: 1 },
        { k: "val", t: "On Order", n: 1, h: "Cost of everything still to arrive from this vendor, before GST.", f: function (r) { return r.val ? money(r.val) : "-"; } },
        { k: "od", t: "Overdue Lines", n: 1, h: "Open lines past their expected receipt date.", f: function (r) { return r.od ? '<strong style="color:#c62828;">' + r.od + "</strong>" : "-"; } },
        { k: "worst", t: "Worst (Days Late)", n: 1, h: "The most overdue open line.", f: function (r) { return r.worst ? r.worst : "-"; } },
        { k: "lead", t: "Lead (Days)", n: 1, h: "Typical days from order to receipt: typed in by you, else the middle value measured from past receipts.", f: function (r) { return r.lead == null ? "-" : r.lead + (r.leadTyped ? ' <span style="color:#888;font-size:10.5px;">typed in</span>' : ""); }, csv: function (r) { return r.lead == null ? "" : r.lead; } },
        { k: "onPct", t: "On Time", n: 1, h: "Share of received lines that arrived on or before the expected receipt date on the order.", f: function (r) { return r.onPct == null ? "-" : '<span style="color:' + (r.onPct >= 80 ? "#2e7d32" : r.onPct >= 50 ? "#e65100" : "#c62828") + ';font-weight:600;">' + r.onPct.toFixed(0) + "%</span>"; } },
        { k: "rcN", t: "Receipt Lines", n: 1, h: "Item lines received since Wiise went live." },
        { k: "fy", t: "Spend FYTD", n: 1, h: "Invoiced purchases of stock items this financial year (from 1 July), in Australian dollars before GST.", f: function (r) { return r.fy ? money(r.fy) : "-"; } },
        { k: "share", t: "Share", n: 1, h: "This vendor's share of all stock purchases this financial year.", f: function (r) { return r.share ? r.share.toFixed(1) + "%" : "-"; } },
        { k: "pc", t: "Price Changes", n: 1, h: "Items whose latest invoiced unit cost differs by 1% or more from the invoice before.", f: function (r) { return r.pc ? r.pc : "-"; } },
        { k: "items", t: "Items", n: 1, h: "Items in the forecast that list this vendor first." },
        { k: "below", t: "Below Min", n: 1, h: "Of those items, how many have a stock position under their Min right now.", f: function (r) { return r.below ? '<strong style="color:#e65100;">' + r.below + "</strong>" : "-"; } },
    ];
    function openVendor(v) { S.vendor = v; S.pages = {}; if (wsTab !== "p_vendors") wsSelectTab("p_vendors"); else render(); }
    function closeVendor() { S.vendor = null; render(); }
    function vendorDetail(v) {
        if (!_lead) buildLead();
        const po = poRows(v);
        const pc = D.inv ? priceChanges(v) : [];
        const rc = [];
        for (const r of (D.rc || [])) {
            if (r[1] !== v) continue;
            const start = (D.poHead && D.poHead[r[2]] && D.poHead[r[2]].od) || r[3];
            rc.push({ date: r[0], po: r[2], item: r[4], desc: desc(r[4]), qty: r[5], lead: (r[0] && start) ? dDiff(r[0], start) : null, vs: (r[0] && r[6]) ? dDiff(r[0], r[6]) : null });
        }
        const months = {}; let fy = 0, tot = 0;
        const fys = fyStart();
        for (const r of (D.inv || [])) { if (r[1] !== v) continue; months[r[0].slice(0, 7)] = (months[r[0].slice(0, 7)] || 0) + r[4]; tot += r[4]; if (r[0] >= fys) fy += r[4]; }
        const yms = Object.keys(months).sort();
        const mx = Math.max.apply(null, yms.map(function (m) { return months[m]; }).concat([1]));
        const bars = yms.length ? '<div style="margin:6px 18px 14px;display:flex;align-items:flex-end;gap:6px;height:120px;">' + yms.map(function (m) {
            return '<div style="flex:1;max-width:60px;text-align:center;" title="' + escAttr(m + ": " + money(months[m])) + '"><div style="height:' + Math.max(2, Math.round(months[m] / mx * 92)) + 'px;background:linear-gradient(180deg,#5c6bc0,#1a237e);border-radius:3px 3px 0 0;"></div><div style="font-size:10px;color:#888;margin-top:3px;">' + m.slice(5) + "/" + m.slice(2, 4) + "</div></div>";
        }).join("") + "</div>" : note("No invoiced purchases found for this vendor.");
        let odN = 0, val = 0; for (const r of po) { if (r.late > 0) odN++; val += r.val; }
        const m = _lead.v[v];
        const onN = rc.filter(function (r) { return r.vs != null; }).length, onT = rc.filter(function (r) { return r.vs != null && r.vs <= 0; }).length;
        const sec = function (t) { return '<div style="padding:14px 18px 2px;font-weight:700;color:#1a237e;font-size:13px;">' + t + "</div>"; };
        const leadBox = '<span style="font-size:12px;color:#555;">Lead time (days): <input type="number" min="0" step="1" value="' + (leadOv[v] > 0 ? leadOv[v] : "") + '" placeholder="' + (m && m.d > 0 ? m.d : DEFAULT_LEAD) + '" onchange="PROC.setLead(\'' + escAttr(v) + '\',this.value)" style="width:70px;padding:4px 6px;border:1px solid #c5cae9;border-radius:6px;"'
            + H("Lead time", "Type the real number of days from order to arrival for this vendor. It is used by the Buy List and Min/Max Review, and is remembered on this device. Clear the box to go back to the measured figure.") + "></span>";
        return shell(vlabel(v), "vendor detail", leadBox + chip(false, "closeVendor()", "← All vendors"),
            tiles([
                { l: "Open lines", v: po.length.toLocaleString() },
                { l: "On order", v: money(val) },
                { l: "Overdue lines", v: odN.toLocaleString(), c: odN ? "#c62828" : "#2e7d32" },
                { l: "Measured lead", v: m ? m.d + " d" : "-", h: "Middle value of days from order to receipt over " + (m ? m.n : 0) + " received lines." },
                { l: "On time", v: onN ? Math.round(onT / onN * 100) + "%" : "-", h: "Received lines that arrived on or before the expected date." },
                { l: "Spend FYTD", v: money(fy) },
                { l: "Spend since go-live", v: money(tot), h: "Invoiced purchases of stock items since Wiise went live (1 May 2026)." },
            ])
            + sec("Spend by month") + bars
            + sec("Open purchase order lines") + table("vd_po", PO_COLS.filter(function (c) { return c.k !== "vl"; }), po, { k: "late", d: -1 })
            + sec("Price changes (latest invoice vs the one before)") + table("vd_pc", [
                { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
                { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
                { k: "d0", t: "Previous", f: function (r) { return dmy(r.d0); } },
                { k: "p0", t: "Previous Cost", n: 1, f: function (r) { return "$" + r.p0.toFixed(2); } },
                { k: "d1", t: "Latest", f: function (r) { return dmy(r.d1); } },
                { k: "p1", t: "Latest Cost", n: 1, f: function (r) { return "$" + r.p1.toFixed(2); } },
                { k: "ch", t: "Change", n: 1, h: "Latest invoiced unit cost against the invoice before, in Australian dollars.", f: function (r) { return '<strong style="color:' + (r.ch > 0 ? "#c62828" : "#2e7d32") + ';">' + (r.ch > 0 ? "+" : "") + r.ch.toFixed(1) + "%</strong>"; } },
            ], pc, { k: "ch", d: -1 })
            + sec("Receipts") + table("vd_rc", [
                { k: "date", t: "Received", f: function (r) { return dmy(r.date); } },
                { k: "po", t: "PO No." },
                { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
                { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
                { k: "qty", t: "Qty", n: 1 },
                { k: "lead", t: "Days From Order", n: 1, h: "Receipt date less the order date. For orders already closed in Wiise the receipt's document date stands in for the order date.", f: function (r) { return r.lead == null ? "-" : r.lead; } },
                { k: "vs", t: "Vs Expected", n: 1, h: "Days after (+) or before (−) the expected receipt date.", f: function (r) { return r.vs == null ? "-" : (r.vs > 0 ? '<span style="color:#c62828;">+' + r.vs + "</span>" : String(r.vs)); } },
            ], rc, { k: "date", d: -1 }));
    }
    function tabVendors() {
        if (!D) return shell("Vendors", "", "", missing());
        if (S.vendor) return vendorDetail(S.vendor);
        const rows = vendorRows();
        let val = 0, od = 0, fy = 0, open = 0, wk = 0;
        for (const r of rows) { val += r.val; od += r.od; fy += r.fy; if (r.posN) open++; }
        for (const r of (D.po || [])) if (inLoc(r[3]) && vendorOK(r[1]) && r[8]) { const l = dDiff(TODAY, r[8]); if (l <= 0 && l >= -7) wk++; }
        return shell("Vendors", rows.length.toLocaleString() + " vendors", "",
            tiles([
                { l: "On order", v: money(val), h: "Cost of everything still to arrive, before GST." },
                { l: "Vendors with open POs", v: open.toLocaleString() },
                { l: "Overdue lines", v: od.toLocaleString(), c: od ? "#c62828" : "#2e7d32" },
                { l: "Lines due in 7 days", v: wk.toLocaleString(), c: "#e65100" },
                { l: "Spend FYTD", v: money(fy), h: "Invoiced purchases of stock items since 1 July." },
            ]) + [missing("rc", "Purchase receipts"), missing("inv", "Invoiced purchase cost")].join("")
            + note("Spend and receipts start at Wiise go-live (1 May 2026). Lead time is measured from order date to receipt; for orders already closed in Wiise the receipt's document date stands in for the order date, so check it and type the real figure in the vendor's detail when it looks wrong.")
            + table("vendors", V_COLS, rows, { k: "val", d: -1 }));
    }

    // ---------- 8. Slow & Dead Stock ----------
    function slowRows() {
        const N = S.slowMonths > 0 ? S.slowMonths : 6;
        const cur = TODAY.slice(0, 7);
        const mdiff = function (a, b) { return (+a.slice(0, 4) - +b.slice(0, 4)) * 12 + (+a.slice(5, 7) - +b.slice(5, 7)); };
        const L = locs();
        const rows = [];
        for (const item in orderData) {
            if (special(item) || !itemVendorOK(item)) continue;
            const od = getScopedOrderData(item);
            const inv = od.availInv || 0;
            if (!(inv > 0)) continue;
            const d = desc(item);
            if (!match(item, d)) continue;
            const it = itemIdx[item];
            let last = "", monthly = 0;
            if (it) {
                let mm = it.months_data || {};
                if (L.length && it.location_months) { mm = {}; for (const l of L) { const x = it.location_months[l]; if (x) for (const ym in x) mm[ym] = (mm[ym] || 0) + x[ym]; } }
                for (const ym in mm) if (mm[ym] > 0 && ym > last) last = ym;
                monthly = getDisplayValues(it, "standard").monthly_avg || 0;
            }
            const since = last ? mdiff(cur, last) : null;
            const cover = monthly > 0 ? inv / monthly : Infinity;
            const mmx = getSkuMinMax(item);
            const over = (mmx && mmx.max > 0 && inv > mmx.max) ? inv - mmx.max : 0;
            let cat, rank, excess;
            if (since == null || since >= N) { cat = "DEAD"; rank = 0; excess = inv; }
            else if (cover > 12) { cat = "SLOW"; rank = 1; excess = inv - 12 * monthly; }
            else if (over > 0) { cat = "OVER MAX"; rank = 2; excess = over; }
            else continue;
            if (S.slowCat !== "all" && S.slowCat !== cat) continue;
            const c = cost(item);
            rows.push({ item: item, desc: d, vl: vlabel(itemVendor(item)), cat: cat, rank: rank, inv: inv, last: last, since: since == null ? 999 : since,
                monthly: monthly, cover: isFinite(cover) ? cover : 9999, max: mmx ? mmx.max : null, excess: excess, unit: c, val: inv * c, exVal: excess * c });
        }
        return rows;
    }
    const SLOW_COLOR = { "DEAD": "#c62828", "SLOW": "#e65100", "OVER MAX": "#6a1b9a" };
    const SLOW_COLS = [
        { k: "rank", t: "Type", h: "DEAD: in stock, no usage for the chosen number of months. SLOW: more than 12 months of cover. OVER MAX: stock above the Max.", f: function (r) { return badge(r.cat, SLOW_COLOR[r.cat]); }, csv: function (r) { return r.cat; } },
        { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
        { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
        { k: "vl", t: "Vendor" },
        { k: "inv", t: "On Hand", n: 1 },
        { k: "last", t: "Last Used", h: "The last month with usage in the loaded history.", f: function (r) { return r.last ? r.last.slice(5) + "/" + r.last.slice(0, 4) : '<span style="color:#888;">none in history</span>'; } },
        { k: "since", t: "Months Idle", n: 1, h: "Months since the last usage.", f: function (r) { return r.since === 999 ? "-" : r.since; }, csv: function (r) { return r.since === 999 ? "" : r.since; } },
        { k: "monthly", t: "Use / Month", n: 1 },
        { k: "cover", t: "Cover (Months)", n: 1, h: "Stock on hand divided by monthly usage.", f: function (r) { return r.cover === 9999 ? "∞" : r.cover.toFixed(1); }, csv: function (r) { return r.cover === 9999 ? "" : r.cover.toFixed(1); } },
        { k: "max", t: "Max", n: 1 },
        { k: "excess", t: "Excess Qty", n: 1, h: "DEAD: everything on hand. SLOW: stock beyond 12 months of usage. OVER MAX: stock above the Max.", f: function (r) { return qty(Math.floor(r.excess)); } },
        { k: "val", t: "Stock Value", n: 1, h: "Stock on hand at unit cost.", f: function (r) { return r.unit ? money(r.val) : "-"; } },
        { k: "exVal", t: "Excess Value", n: 1, h: "Excess quantity at unit cost.", f: function (r) { return r.unit ? "<strong>" + money(r.exVal) + "</strong>" : "-"; } },
    ];
    function tabSlow() {
        const rows = slowRows();
        const c = {}; let val = 0, ex = 0;
        for (const r of rows) { c[r.cat] = (c[r.cat] || 0) + 1; val += r.val; ex += r.exVal; }
        const k = S.slowCat;
        const controls = '<span style="font-size:12px;color:#555;">Dead after <input type="number" min="1" max="36" value="' + S.slowMonths + '" onchange="PROC.set(\'slowMonths\',parseFloat(this.value)||6)" style="width:52px;padding:4px 6px;border:1px solid #c5cae9;border-radius:6px;"'
            + H("Dead after", "An item in stock with no usage for this many months counts as dead.") + "> months</span>"
            + chip(k === "all", "set('slowCat','all')", "All") + chip(k === "DEAD", "set('slowCat','DEAD')", "Dead") + chip(k === "SLOW", "set('slowCat','SLOW')", "Slow") + chip(k === "OVER MAX", "set('slowCat','OVER MAX')", "Over Max");
        const first = (globalSortedMonths && globalSortedMonths[0]) || "";
        return shell("Slow & Dead Stock", rows.length.toLocaleString() + " items", controls,
            tiles([
                { l: "Dead", v: (c.DEAD || 0).toLocaleString(), c: "#c62828" },
                { l: "Slow", v: (c.SLOW || 0).toLocaleString(), c: "#e65100" },
                { l: "Over Max", v: (c["OVER MAX"] || 0).toLocaleString(), c: "#6a1b9a" },
                { l: "Stock value", v: money(val), h: "Value at unit cost of the stock in these rows." },
                { l: "Excess value", v: money(ex), c: "#c62828", h: "Value at unit cost of the excess quantity." },
            ]) + ((D && D.cost) ? "" : note("<strong>Unit costs not loaded</strong> — values show as a dash.", true))
            + note("Usage history on screen starts " + (first ? first.slice(5) + "/" + first.slice(0, 4) : "at the date range") + ". “None in history” means no usage since then — tick <strong>Include old NAV data</strong> and widen the date range to look further back.")
            + table("slow", SLOW_COLS, rows, { k: "exVal", d: -1 }));
    }

    // ---------- 9. Forecast Accuracy ----------
    let _acc = null;
    function accuracy() {
        const L = locs();
        const sig = L.join(",") + "|" + allData.length + "|" + globalSortedMonths.join(",") + "|" + totalMonthsGlobal;
        if (_acc && _acc.sig === sig) return _acc;
        const months = globalSortedMonths.slice();
        const cur = new Date().getUTCFullYear() + "-" + String(new Date().getUTCMonth() + 1).padStart(2, "0");
        const complete = months.filter(function (m) { return m < cur; });
        const tests = [];
        for (let i = complete.length - 1; i >= 3 && tests.length < 3; i--) tests.unshift(i);
        const methods = PLANNER_METHODS.map(function (m) { return m.key; });
        const res = { sig: sig, tests: tests.map(function (i) { return complete[i]; }), items: {}, methods: methods };
        if (!tests.length) return (_acc = res);
        const keepMonths = globalSortedMonths, keepTotal = totalMonthsGlobal;
        try {
            for (const it of allData) {
                let mm = it.months_data || {};
                if (L.length && it.location_months) { mm = {}; for (const l of L) { const x = it.location_months[l]; if (x) for (const ym in x) mm[ym] = (mm[ym] || 0) + x[ym]; } }
                const err = {}; let act = 0;
                for (const m of methods) err[m] = 0;
                for (const i of tests) {
                    const M = complete[i];
                    const train = {};
                    for (const ym in mm) if (ym < M) train[ym] = mm[ym];
                    globalSortedMonths = complete.slice(0, i);
                    totalMonthsGlobal = i;
                    const a = Math.max(0, mm[M] || 0);
                    act += a;
                    for (const m of methods) {
                        const p = calcForecastByMethod(train, i, m).monthly_avg || 0;
                        err[m] += Math.abs(p - a);
                    }
                }
                res.items[it.item_no] = { act: act, err: err };
            }
        } finally { globalSortedMonths = keepMonths; totalMonthsGlobal = keepTotal; }
        return (_acc = res);
    }
    function tabAccuracy() {
        const A = accuracy();
        if (!A.tests.length) return shell("Forecast Accuracy", "", "", note("<strong>Not enough history.</strong> This check needs at least four complete months in the date range (three to learn from, one to test).", true));
        const label = {}; for (const m of PLANNER_METHODS) label[m.key] = m.label;
        const curM = A.methods.indexOf(selectedForecastMethod) !== -1 ? selectedForecastMethod : "standard";
        const tot = {}; let totAct = 0;
        for (const m of A.methods) tot[m] = 0;
        const rows = [];
        for (const r of baseRows()) {
            const x = A.items[r.itemNo];
            if (!x || !(x.act > 0)) continue;
            totAct += x.act;
            const row = { item: r.itemNo, desc: r.description, vl: vlabel(r.vendorNo), act: x.act / A.tests.length };
            let best = null;
            for (const m of A.methods) {
                tot[m] += x.err[m];
                row[m] = Math.max(0, 1 - x.err[m] / x.act) * 100;
                if (best == null || x.err[m] < x.err[best]) best = m;
            }
            row.best = label[best]; row.bestKey = best; row.cur = row[curM]; row.gain = row[best] - row[curM];
            rows.push(row);
        }
        let bestAll = null;
        for (const m of A.methods) if (bestAll == null || tot[m] < tot[bestAll]) bestAll = m;
        const pctCell = function (k) { return function (r) { const v = r[k]; return '<span style="' + (r.bestKey === k ? "font-weight:700;color:#2e7d32;" : "color:#555;") + '">' + v.toFixed(0) + "%</span>"; }; };
        const cols = [
            { k: "item", t: "Item", f: function (r) { return itemLink(r.item); } },
            { k: "desc", t: "Description", f: function (r) { return descCell(r.desc); } },
            { k: "vl", t: "Vendor" },
            { k: "act", t: "Actual / Month", n: 1, h: "Average actual usage per month over the tested months." },
        ];
        for (const m of A.methods) cols.push({ k: m, t: label[m], n: 1, h: "How close this method came over the tested months: 100% less the total miss as a share of actual usage. Green marks the best method for the item.", f: pctCell(m), csv: (function (m) { return function (r) { return r[m].toFixed(0) + "%"; }; })(m) });
        cols.push({ k: "best", t: "Best Method", h: "The method with the smallest total miss for this item." });
        cols.push({ k: "gain", t: "Gain vs Current", n: 1, h: "How many points better the best method is than the method selected at the top (" + label[curM] + ").", f: function (r) { return r.gain > 0.5 ? '<strong style="color:#2e7d32;">+' + r.gain.toFixed(0) + " pts</strong>" : "-"; }, csv: function (r) { return r.gain.toFixed(0); } });
        const tl = A.methods.map(function (m) {
            const a = totAct > 0 ? Math.max(0, 1 - tot[m] / totAct) * 100 : 0;
            return { l: label[m] + (m === curM ? " (selected)" : ""), v: a.toFixed(0) + "%", c: m === bestAll ? "#2e7d32" : "#1a237e", h: "Accuracy of this method across every item shown, weighted by volume." + (m === bestAll ? " Best overall." : "") };
        });
        const tested = A.tests.map(function (m) { return m.slice(5) + "/" + m.slice(0, 4); }).join(", ");
        return shell("Forecast Accuracy", rows.length.toLocaleString() + " items · tested on " + tested, "",
            tiles(tl) + note("For each tested month, every method was given only the months before it and asked to predict that month; the prediction is compared with what was actually used. Tested months: <strong>" + tested + "</strong>. Accuracy = 100% − total miss ÷ actual usage. Items with no usage in the tested months are left out.")
            + table("accuracy", cols, rows, { k: "act", d: -1 }));
    }

    // ---------- render / export ----------
    const RENDER = { p_po: tabPO, p_buy: tabBuy, p_back: tabBack, p_runway: tabRunway, p_transfer: tabTransfer, p_minmax: tabMinMax, p_vendors: tabVendors, p_slow: tabSlow, p_accuracy: tabAccuracy };
    function render() {
        const host = document.getElementById("wsProcureHost");
        if (!host || !wsMode || !isTab(wsTab) || !enabled()) return;
        _base = null;
        prep();
        const sc = host.querySelector ? host.querySelector(".table-scroll") : null;
        const keep = sc ? { t: sc.scrollTop, l: sc.scrollLeft } : null;
        let html;
        try { html = (RENDER[wsTab] || tabPO)(); }
        catch (e) { console.error("Procurement tab failed:", e); html = shell("Something went wrong", "", "", note("This tab could not be built: " + esc(e.message || String(e)), true)); }
        host.innerHTML = html;
        if (keep && host.querySelector) { const s2 = host.querySelector(".table-scroll"); if (s2) { s2.scrollTop = keep.t; s2.scrollLeft = keep.l; } }
    }
    function exportCSV() {
        if (!S.last) return;
        const q = function (v) { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const strip = function (h) { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent || "").trim(); };
        const lines = [S.last.cols.map(function (c) { return q(c.t); }).join(",")];
        for (const r of S.last.rows) {
            lines.push(S.last.cols.map(function (c) {
                if (c.csv) return q(c.csv(r));
                if (c.n && !c.f) return q(r[c.k] == null ? "" : r[c.k]);
                if (c.f) return q(strip(c.f(r)).replace(/^\$/, "").replace(/(\d),(?=\d{3})/g, "$1"));
                return q(r[c.k]);
            }).join(","));
        }
        const tab = TABS.find(function (t) { return t.key === wsTab; });
        const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (tab ? tab.label : "procurement").replace(/[^A-Za-z0-9]+/g, "_") + "_" + TODAY + ".csv";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }

    // ---------- data in ----------
    function setData(payload, when) {
        D = payload || null; asOf = when || ""; _lead = null; _acc = null; loading = false;
        if (D && D.diagnostics) console.log("Purchasing data:", D.diagnostics);
        if (typeof wsRenderTabs === "function") wsRenderTabs();
        render();
    }
    // After a snapshot is on screen: fetch the purchasing file that goes with it.
    async function afterSnapshot() {
        if (!enabled() || isLocal()) return;
        loading = true;
        try {
            const p = await fetchAndDecrypt("snapshots/procure.bin", "purchasing data", { quiet: true });
            if (p && p.data) setData(p.data, "as of " + ((p.meta && p.meta.fetchedAtMelbourne) || "snapshot"));
            else { loading = false; render(); }
        } catch (e) {
            loading = false;
            console.warn("Purchasing data not loaded:", e.message || e);
            render();
        }
    }
    // During a live load: fetch straight from Wiise.
    async function liveLoad() {
        if (!enabled() || typeof bcFetchProcurement !== "function") return;
        loading = true;
        try { setData(await bcFetchProcurement(), "live"); }
        catch (e) { loading = false; console.warn("Purchasing data not loaded:", e.message || e); }
    }
    // Localhost preview: invent purchasing data on top of the demo items.
    function loadDemo() {
        if (!isLocal()) return;
        let seed = 7;
        const rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const today = isoToday();
        const p = { v: 1, po: [], poHead: {}, so: [], soHead: {}, rc: [], inv: [], cost: {}, tr: [], transit: ["IN"], vn: {}, diagnostics: { demo: "demo data" } };
        let n = 100;
        for (const d of allData) {
            const item = d.item_no, v = itemVendor(item) || "2124";
            p.vn[v] = vendorNames[v] || "Vendor " + v;
            p.cost[item] = Math.round((5 + rnd() * 80) * 100) / 100;
            const poL = (locData.po && locData.po[item]) || {};
            for (const l in poL) {
                const doc = "PO" + (n++);
                const exp = addDays(today, Math.floor(rnd() * 70) - 20);
                p.poHead[doc] = { od: addDays(exp, -40), vn: p.vn[v], st: "Open", cur: "" };
                p.po.push([doc, v, item, l, poL[l] + 10, poL[l], 10, p.cost[item], exp, d.description, Math.round(poL[l] * p.cost[item])]);
            }
            const soL = (locData.so && locData.so[item]) || {};
            for (const l in soL) {
                const doc = "SO" + (n++);
                p.soHead[doc] = "Customer " + (1 + Math.floor(rnd() * 12));
                const half = Math.ceil(soL[l] / 2);
                p.so.push([doc, "C" + n, item, l, half, addDays(today, Math.floor(rnd() * 30) - 5)]);
                if (soL[l] - half > 0) p.so.push(["SO" + (n++), "C" + n, item, l, soL[l] - half, addDays(today, Math.floor(rnd() * 40))]);
                p.soHead["SO" + (n - 1)] = "Customer " + (1 + Math.floor(rnd() * 12));
            }
            for (let k = 0; k < 4; k++) {
                const post = addDays(today, -Math.floor(rnd() * 150) - 5);
                const lead = 20 + Math.floor(rnd() * 40);
                p.rc.push([post, v, "POX" + n + k, addDays(post, -lead), item, 50 + Math.floor(rnd() * 200), addDays(post, Math.floor(rnd() * 14) - 7)]);
                const q = 50 + Math.floor(rnd() * 200);
                p.inv.push([post, v, item, q, Math.round(q * p.cost[item] * (0.9 + k * 0.04) * 100) / 100]);
            }
            if (rnd() < 0.2) p.tr.push(["TO" + (n++), "10", "20", item, 5 + Math.floor(rnd() * 20), addDays(today, 3)]);
        }
        setData(p, "demo data");
    }

    return { TABS: TABS, tabs: tabs, enabled: enabled, isTab: isTab, render: render, exportCSV: exportCSV, setData: setData,
        afterSnapshot: afterSnapshot, liveLoad: liveLoad, loadDemo: loadDemo,
        sortBy: sortBy, more: more, set: set, setLead: setLead, openVendor: openVendor, closeVendor: closeVendor,
        _state: S, _data: function () { return D; } };
})();
