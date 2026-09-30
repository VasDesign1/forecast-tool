// Verify branch-aware inventory/SO/PO: scoping helper, main-table filter,
// per-branch forecasts, planner location filter, container sync, fallbacks.
"use strict";
const fs = require("fs");
const elements = {};
function makeEl(id) {
    return { id, value: "", textContent: "", innerHTML: "", checked: false, style: {}, dataset: {}, files: [],
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
        addEventListener() {}, querySelectorAll: () => [], querySelector: () => makeEl(id + ">q"), appendChild() {}, closest: () => null, click() {}, remove() {}, insertBefore() {},
        setAttribute(k, v) { this["attr_" + k] = v; }, parentNode: { insertBefore() {} }, nextSibling: null };
}
global.window = global;
global.location = { hostname: "vasdesign1.github.io" };
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.document = { getElementById: (id) => elements[id] || (elements[id] = makeEl(id)),
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => makeEl("q"), createElement: (t) => makeEl("new:" + t), body: makeEl("body") };
global.alert = (m) => console.log("  [alert]", m);
global.prompt = () => ""; global.confirm = () => true;
global.msal = { PublicClientApplication: function () { return {}; } };
global.XLSX = {}; global.requestAnimationFrame = (fn) => fn();
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
global.Blob = function (parts) { this.text = parts.join(""); };

const html = fs.readFileSync("C:/Users/61481/repos/forecast-tool/index.html", "utf8");
const inline = html.substring(html.indexOf("    <script>") + 12, html.lastIndexOf("    </script>"));
const fetchers = fs.readFileSync("C:/Users/61481/repos/forecast-tool/bc-fetchers.js", "utf8");
const hook = `
globalThis.__test = {
    loadLedger(rows) { processLedgerWithMapping(rows, CANON_LEDGER_MAPPING); },
    loadItems(rows) { processOrderWithMapping(rows, { itemNo: "No.", salesQty: "Qty on Sales Order", purchQty: "Qty on Purch. Order", availInv: "Inventory", desc: "Description" }); },
    loadVendors(rows) { vendorMapping = {}; processVendorWithMapping(rows, { itemNo: "No.", vendorNo: "Vendor No.", vendorName: "Vendor Name" }); },
    setLocData(d) { locData = d; },
    scoped(itemNo, locs) { return getScopedOrderData(itemNo, locs); },
    dv(itemNo, method, locs) { return getDisplayValues(allData.find(x => x.item_no === itemNo), method, locs); },
    setMainLocs(locs) { selectedLocations = locs; applyFilters(); },
    filteredItems() { return filteredData.map(d => d.item_no); },
    openPlanner() { openOrderPlanner(); },
    closePlanner() { closePlanner(); },
    setPlanner(k, v) { setPlannerOpt(k, v); },
    toggleLoc(l) { togglePlannerLoc(encodeURIComponent(l)); },
    plannerLocsNow() { return plannerState.locations.slice(); },
    sku(itemNo, locs) { return getSkuMinMax(itemNo, locs); },
    plannerRows() { return computePlannerRows(); },
    plannerLocation() { return plannerState.locations.join('+'); },
    controls() { return document.getElementById("plannerControls").innerHTML; },
    openVendor(k) { openPlannerVendor(encodeURIComponent(k)); },
    toggleContainer() { toggleVendorContainerPlanner(); },
    closeVendor() { closePlannerVendor(); },
    mainLocs() { return selectedLocations.slice(); },
    locList() { return allLocationsList.slice(); },
};`;
(0, eval)(fetchers + "\n" + inline + "\n" + hook);

function sale(item, qty, loc, month) {
    return { "Posting Date": "2026-0" + month + "-15", "Item No.": item, "Quantity": qty, "Description": item,
             "Location Code": loc, "Entry Type": "Sale", "Document Type": "Sales Shipment" };
}
// ITEM-A: 100/mo at Loc 10 and 50/mo at Loc 20, Jan-Jun 2026. ITEM-B: Loc 10 only.
const ledger = [];
for (let m = 1; m <= 6; m++) {
    ledger.push(sale("ITEM-A", -100, "10", m));
    ledger.push(sale("ITEM-A", -50, "20", m));
    ledger.push(sale("ITEM-B", -10, "10", m));
}
__test.loadLedger(ledger);
__test.loadItems([
    { "No.": "ITEM-A", "Inventory": 100, "Qty on Sales Order": 30, "Qty on Purch. Order": 50, "Description": "A" },
    { "No.": "ITEM-B", "Inventory": 20, "Qty on Sales Order": 0, "Qty on Purch. Order": 0, "Description": "B" },
]);
__test.loadVendors([{ "No.": "ITEM-A", "Vendor No.": "2124", "Vendor Name": "Grandaire" }, { "No.": "ITEM-B", "Vendor No.": "2124", "Vendor Name": "Grandaire" }]);
__test.setLocData({
    inv: { "ITEM-A": { "10": 60, "20": 40 }, "ITEM-B": { "10": 15, "30": 5 } },
    so:  { "ITEM-A": { "10": 25, "20": 5 } },
    po:  { "ITEM-A": { "10": 50 } },
    sku: { "ITEM-A": { "10": { min: 20, max: 80 }, "20": { min: 10, max: 30 } } },
    diagnostics: {},
});

const checks = [];
// SKU min/max
const sAll = __test.sku("ITEM-A", []);
checks.push(["SKU All = summed band (30/110)", sAll && sAll.min === 30 && sAll.max === 110]);
const s10 = __test.sku("ITEM-A", ["10"]);
checks.push(["SKU Loc 10 = 20/80", s10 && s10.min === 20 && s10.max === 80]);
checks.push(["SKU for uncovered branch = null", __test.sku("ITEM-A", ["30"]) === null]);
checks.push(["no SKU anywhere = null", __test.sku("ITEM-B", []) === null]);
// Scoping helper
const all = __test.scoped("ITEM-A", []);
checks.push(["All = company card figures", all.availInv === 100 && all.salesQty === 30 && all.purchQty === 50 && all.exact.inv]);
const l10 = __test.scoped("ITEM-A", ["10"]);
checks.push(["Loc 10 = branch figures (60/25/50)", l10.availInv === 60 && l10.salesQty === 25 && l10.purchQty === 50 && l10.exact.inv && l10.exact.so]);
const b30 = __test.scoped("ITEM-B", ["30"]);
checks.push(["Item absent from a map = 0, not fallback", b30.availInv === 5 && b30.salesQty === 0 && b30.purchQty === 0]);
__test.setLocData({ inv: { "ITEM-A": { "10": 60 } }, so: null, po: null, diagnostics: {} });
const fb = __test.scoped("ITEM-A", ["10"]);
checks.push(["missing SO/PO maps fall back to company-wide", fb.salesQty === 30 && fb.purchQty === 50 && fb.exact.so === false]);
__test.setLocData({
    inv: { "ITEM-A": { "10": 60, "20": 40 }, "ITEM-B": { "10": 15, "30": 5 } },
    so:  { "ITEM-A": { "10": 25, "20": 5 } },
    po:  { "ITEM-A": { "10": 50 } },
    sku: { "ITEM-A": { "10": { min: 20, max: 80 }, "20": { min: 10, max: 30 } } },
    diagnostics: {},
});

// Per-branch forecast via override
checks.push(["Loc 10 monthly avg = 100", __test.dv("ITEM-A", "standard", ["10"]).monthly_avg === 100]);
checks.push(["Loc 20 monthly avg = 50", __test.dv("ITEM-A", "standard", ["20"]).monthly_avg === 50]);

// Main filter: stocked-but-never-sold appears
__test.setMainLocs(["30"]);
checks.push(["Loc 30 shows ITEM-B (stock only), hides ITEM-A", JSON.stringify(__test.filteredItems()) === '["ITEM-B"]']);
__test.setMainLocs([]);

// Planner location filter, independent of main page
__test.setMainLocs(["20"]);
__test.openPlanner();
// NOTE: esc()/escAttr() are blank in this stub, so count chip handlers rather than labels.
const chipCount = (__test.controls().match(/togglePlannerLoc\(/g) || []).length;
checks.push(["location chips rendered (All + one per location)", __test.controls().indexOf("Location:") !== -1 && chipCount === __test.locList().length + 1 && __test.locList().length === 2]);
__test.toggleLoc("10");
const pa = __test.plannerRows().find(r => r.itemNo === "ITEM-A");
console.log("ITEM-A planner @Loc10:", JSON.stringify(pa));
// forecast 6M @Loc10 = 600; net = 600 + 25 - 60 - 50 = 515; 26 wks -> 20/wk
checks.push(["planner Loc 10 net = 515 (ignores main-page Loc 20)", pa && pa.forecast === 600 && pa.net === 515]);
checks.push(["per week = ceil(515/26) = 20", pa && pa.perWeek === 20]);
checks.push(["planner row carries SKU 20/80", pa && pa.skuMin === 20 && pa.skuMax === 80]);

// Multi-select: Loc 10 + 20 sums everything
__test.toggleLoc("20");
checks.push(["two locations selected", JSON.stringify(__test.plannerLocsNow()) === '["10","20"]']);
const pab = __test.plannerRows().find(r => r.itemNo === "ITEM-A");
// forecast 900 (600+300); net = 900 + 30 - 100 - 50 = 780
checks.push(["Loc 10+20 sums: forecast 900, net 780", pab && pab.forecast === 900 && pab.net === 780]);
checks.push(["Loc 10+20 SKU band 30/110", pab && pab.skuMin === 30 && pab.skuMax === 110]);
__test.toggleLoc("20");   // untoggle back to Loc 10 for container test
checks.push(["untoggle works", JSON.stringify(__test.plannerLocsNow()) === '["10"]']);

// Container adoption carries planner location; restore brings main back
__test.openVendor("2124");
__test.toggleContainer();
checks.push(["container gets planner's Loc 10", JSON.stringify(__test.mainLocs()) === '["10"]']);
__test.closeVendor();
checks.push(["main page restored to Loc 20 after leaving", JSON.stringify(__test.mainLocs()) === '["20"]']);

__test.closePlanner();
checks.push(["planner location resets on close", __test.plannerLocation() === ""]);

let ok = true;
for (const [name, pass] of checks) { console.log((pass ? "PASS" : "FAIL") + " — " + name); if (!pass) ok = false; }
process.exit(ok ? 0 : 1);
