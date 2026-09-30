"use strict";
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/sim_test_loc.js", "utf8");
let head = src.substring(0, src.indexOf("const checks = []"));
head = head.replace("global.document = {", "global.document = { documentElement: { className: '' }, ");
head = head.replace("globalThis.__test = {",
    "globalThis.__test = { openP() { openOrderPlanner(); }, tab(t) { setPlannerTab(t); }, grp(v) { setPlannerOpt('group', v); }, lvt(v) { lanesVendorTyped(v); }, tlv(k) { toggleLaneVendor(k); }, "
    + "pContent() { return document.getElementById('plannerContent').innerHTML; }, pSummary() { return document.getElementById('plannerSummary').innerHTML; }, closeP() { closePlanner(); }, ");
eval(head);
global.document.getElementById("pageSize").value = "50";
const checks = [];
__test.openP();
__test.tab("lanes");
checks.push(["vendor search input rendered", __test.pSummary().indexOf("lanesVendorTyped") !== -1 && __test.pSummary().indexOf("lanesVendorDD") !== -1]);
checks.push(["lanes Export CSV button rendered", __test.pSummary().indexOf("lanesExportCSV()") !== -1]);
// Group by = Vendor (planner default) -> collapsed vendor tiles
let gc = __test.pContent();
checks.push(["group=vendor shows vendor tiles", gc.indexOf("toggleLaneVendor") !== -1]);
checks.push(["tiles start collapsed (items hidden)", (gc.match(/showItemDetail/g) || []).length === 0]);
const m = gc.match(/toggleLaneVendor\('([^']+)'\)/);
if (m) __test.tlv(m[1]);
gc = __test.pContent();
checks.push(["clicking a tile expands its items", (gc.match(/showItemDetail/g) || []).length > 0]);
// Group by = Item -> flat cards
__test.grp("item");
const flatCards = (__test.pContent().match(/showItemDetail/g) || []).length;
checks.push(["group=item shows flat item cards", flatCards >= 2]);
__test.lvt("2124 - Grandaire");  // typed filter, real vendor: some items remain
const filtered = (__test.pContent().match(/showItemDetail/g) || []).length;
checks.push(["vendor filter keeps that vendor's items", filtered > 0 && filtered <= flatCards]);
checks.push(["clear x appears when vendor filtered", __test.pSummary().indexOf("vendor-clear") !== -1]);
__test.lvt("");
checks.push(["clearing filter restores all", (__test.pContent().match(/showItemDetail/g) || []).length === flatCards]);
checks.push(["no Group-by-vendor button anywhere", __test.pSummary().indexOf("Group by vendor") === -1]);
__test.closeP();
let ok = true;
for (const [n, p] of checks) { console.log((p ? "PASS" : "FAIL") + " - " + n); if (!p) ok = false; }
process.exit(ok ? 0 : 1);
