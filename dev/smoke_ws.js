"use strict";
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/sim_test_loc.js", "utf8");
let head = src.substring(0, src.indexOf("const checks = []"));
head = head.replace("global.document = {", "global.document = { documentElement: { className: '' }, ");
head = head.replace("globalThis.__test = {",
    "globalThis.__test = { ws() { toggleWorkspace(); return wsMode; }, wsSel(t) { wsSelectTab(t); return wsTab; }, wsTabHtml() { return document.getElementById('wsTabBtns').innerHTML; }, "
    + "el(id) { return document.getElementById(id).innerHTML; }, months() { return plannerState.months; }, pMethod() { return plannerState.method; }, "
    + "setVendor(v) { selectedVendor = v; }, rowsCount() { return plannerAllRows().length; }, setMethod(k) { wsSetMethod(k); }, top() { wsToggleTop(); return topOpen; }, wsOpt(k,v) { wsSetPlannerOpt(k,v); }, opv(k) { openPlannerVendor(encodeURIComponent(k)); }, back() { wsPlannerVendorBack(); }, ");
eval(head);
global.document.getElementById("pageSize").value = "50";

const checks = [];
// Enable tab view
checks.push(["toggle turns tab view ON", __test.ws() === true]);
let th = __test.wsTabHtml();
checks.push(["five tabs render", (th.match(/ws-tab/g) || []).length >= 5 && th.indexOf("Forecast Results") !== -1 && th.indexOf("Priority Lanes") !== -1]);
checks.push(["predicted disabled without vendor", /Predicted Forecast<\/button>/.test(th) && th.indexOf("disabled") !== -1]);
checks.push(["method chips render in filters", __test.el("wsMethodChips").indexOf("wsSetMethod") !== -1]);
checks.push(["horizon chips render in filters", __test.el("wsHorizonChips").indexOf("wsSetPlannerOpt") !== -1]);
checks.push(["increase % chips in horizon cell", __test.el("wsHorizonChips").indexOf("wsSetPct") !== -1]);
checks.push(["extras bar shows table chips on results tab", __test.el("wsExtrasChips").indexOf("Reorder policy") !== -1 && __test.el("wsExtrasChips").indexOf("Round up") !== -1]);
checks.push(["period/group dimmed on results tab", __test.el("wsPeriodChips").indexOf("pointer-events:none") !== -1]);

// Custom Forecast Period swaps the results table's FORECAST columns
checks.push(["preset horizon chips dimmed on results", __test.el("wsHorizonChips").indexOf("pointer-events:none") !== -1]);
__test.wsOpt("months", "7.5");
checks.push(["custom month becomes the forecast column", __test.el("tableHead").indexOf("7.5M") !== -1 && __test.el("tableHead").indexOf("forecast_12m") === -1]);
checks.push(["preset chips reactivate with custom month", __test.el("wsHorizonChips").indexOf("pointer-events:none") === -1]);
__test.wsOpt("months", "6");
checks.push(["preset restores standard columns", __test.el("tableHead").indexOf("forecast_12m") !== -1]);

// Planner tab inline
checks.push(["planner tab selects", __test.wsSel("planner") === "planner"]);
checks.push(["planner renders inline (vendor tiles)", __test.el("plannerContent").length > 200]);
checks.push(["planner controls slimmed (no Period cell)", __test.el("plannerControls").indexOf("Period:") === -1]);
checks.push(["period/group active on planner tab", __test.el("wsPeriodChips").indexOf("pointer-events:none") === -1]);
// Horizon via global chips drives plannerState
__test.wsOpt('months', '3');
checks.push(["global horizon chip sets planner months", __test.months() === 3]);
__test.wsOpt('months', '6');
// Global method drives planner + main
__test.setMethod("wma");
checks.push(["global method syncs planner", __test.pMethod() === "wma"]);
__test.setMethod("standard");

// Lanes tab: local vendor search hidden, group chip stays
checks.push(["lanes tab selects", __test.wsSel("lanes") === "lanes"]);
checks.push(["lanes summary hides local vendor search", __test.el("plannerSummary").indexOf("lanesVendorTyped") === -1]);
checks.push(["group-by-vendor chip in extras area, not lanes summary", __test.el("wsExtrasChips").indexOf("lanesvendor") !== -1 && __test.el("plannerSummary").indexOf("toggleLanesByVendor") === -1]);
checks.push(["lanes hides local export (strip covers it)", __test.el("plannerSummary").indexOf("lanesExportCSV") === -1]);

// Inline vendor drill-down (no popup in tab view)
__test.wsSel("planner");
__test.opv("2124");
checks.push(["vendor drill renders inline with back link", __test.el("plannerSummary").indexOf("wsPlannerVendorBack") !== -1 && __test.el("plannerContent").indexOf("<table") !== -1]);
__test.back();
checks.push(["back returns to vendor tiles", __test.el("plannerSummary").indexOf("wsPlannerVendorBack") === -1]);

// Tool-wide vendor filter reaches the planner
const all = __test.rowsCount();
__test.setVendor("2124");
const fewer = __test.rowsCount();
__test.setVendor("");
checks.push(["global vendor filter narrows planner rows", fewer > 0 && fewer <= all && __test.rowsCount() === all]);

// Top panel chevron + back to classic
checks.push(["chevron toggles top panel state", typeof __test.top() === "boolean" && __test.top() !== __test.top()]);
checks.push(["results tab returns", __test.wsSel("results") === "results"]);
checks.push(["toggle back OFF", __test.ws() === false]);

let ok = true;
for (const [n, p] of checks) { console.log((p ? "PASS" : "FAIL") + " - " + n); if (!p) ok = false; }
process.exit(ok ? 0 : 1);
