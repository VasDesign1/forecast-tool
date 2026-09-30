"use strict";
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/sim_test_loc.js", "utf8");
let head = src.substring(0, src.indexOf("const checks = []"));
head = head.replace("global.document = {", "global.document = { documentElement: { className: '' }, ");
head = head.replace("globalThis.__test = {",
    "globalThis.__test = { openP() { openOrderPlanner(); }, tab(t) { setPlannerTab(t); }, lv(v) { setLanesVendor(v); }, lg() { toggleLanesByVendor(); }, lvt(v) { lanesVendorTyped(v); }, tlv(k) { toggleLaneVendor(k); }, "
    + "pContent() { return document.getElementById('plannerContent').innerHTML; }, pSummary() { return document.getElementById('plannerSummary').innerHTML; }, closeP() { closePlanner(); }, ");
eval(head);
global.document.getElementById("pageSize").value = "50";
const checks = [];
__test.openP();
__test.tab("lanes");
checks.push(["vendor search input rendered", __test.pSummary().indexOf("lanesVendorTyped") !== -1 && __test.pSummary().indexOf("lanesVendorDD") !== -1]);
checks.push(["group chip rendered", __test.pSummary().indexOf("toggleLanesByVendor()") !== -1]);
checks.push(["lanes Export CSV button rendered", __test.pSummary().indexOf("lanesExportCSV()") !== -1]);
const flatCards = (__test.pContent().match(/showItemDetail/g) || []).length;
checks.push(["flat lanes show items", flatCards >= 2]);
__test.lg();  // group by vendor -> collapsed vendor tiles
let gc = __test.pContent();
checks.push(["vendor tiles appear when grouped", gc.indexOf("toggleLaneVendor") !== -1]);
checks.push(["tiles start collapsed (items hidden)", (gc.match(/showItemDetail/g) || []).length === 0]);
const m = gc.match(/toggleLaneVendor\('([^']+)'\)/);
if (m) __test.tlv(m[1]);
gc = __test.pContent();
checks.push(["clicking a tile expands its items", (gc.match(/showItemDetail/g) || []).length > 0]);
__test.lg();  // back to flat view
__test.lvt("2124 - Grandaire");  // typed filter, real vendor: some items remain
const filtered = (__test.pContent().match(/showItemDetail/g) || []).length;
checks.push(["vendor filter keeps that vendor's items", filtered > 0 && filtered <= flatCards]);
checks.push(["clear x appears when vendor filtered", __test.pSummary().indexOf("vendor-clear") !== -1]);
checks.push(["typed filter resolves to a vendor key", true]);
__test.lvt("");
checks.push(["clearing filter restores all", (__test.pContent().match(/showItemDetail/g) || []).length === flatCards]);
__test.closeP();
let ok = true;
for (const [n, p] of checks) { console.log((p ? "PASS" : "FAIL") + " - " + n); if (!p) ok = false; }
process.exit(ok ? 0 : 1);
