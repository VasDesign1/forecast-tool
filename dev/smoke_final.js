"use strict";
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/sim_test_loc.js", "utf8");
let head = src.substring(0, src.indexOf("const checks = []"));
head = head.replace("global.document = {", "global.document = { documentElement: { className: '' }, ");
head = head.replace("globalThis.__test = {",
    "globalThis.__test = { spec(n) { return isSpecialItem(n); }, rp(n) { return hiddenByReorderPolicy(n); }, so(n) { return getScopedOrderData(n).salesQty || 0; }, injectPol(n) { const m = locData.sku && locData.sku[n]; if (m) for (const l in m) { m[l].pol = 1; break; } }, pcg(g) { togglePlannerColGroup(g); }, otm(od,mm) { return orderToMin(od,mm); }, "
    + "render() { renderTable(); }, openP() { openOrderPlanner(); }, closeP() { closePlanner(); }, setPOpt(k,v) { setPlannerOpt(k,v); }, tab(t) { setPlannerTab(t); }, pExtra(k) { togglePlannerExtra(k); }, tExtra(k) { toggleTableExtra(k); }, "
    + "theme(t) { applyForecastTheme(t); return document.documentElement.className; }, openPicker() { openThemePicker(); return document.getElementById('themePickerGrid').innerHTML.length; }, "
    + "pContent() { return document.getElementById('plannerContent').innerHTML; }, pSummary() { return document.getElementById('plannerSummary').innerHTML; }, "
    + "pTabs() { return document.getElementById('plannerTabs').innerHTML; }, chips() { return document.getElementById('extrasChips').innerHTML; }, "
    + "tBody() { return document.getElementById('tableBody').innerHTML; }, tHead() { return document.getElementById('tableHead').innerHTML; }, ");
eval(head);
global.document.getElementById("pageSize").value = "50";

const checks = [];
// Main table: groups default expanded, extras chips, ON-by-default toggles
__test.render();
checks.push(["groups default EXPANDED (12M sub-header visible)", __test.tHead().indexOf("12M") !== -1]);
checks.push(["extras chips rendered in header row", __test.chips().indexOf("Stock gauge") !== -1 && __test.chips().indexOf("Status") !== -1]);
checks.push(["status column ON by default", __test.tHead().indexOf("Status") !== -1 && /ORDER NOW|WATCH|OK|OVER/.test(__test.tBody())]);
checks.push(["gauge ON by default", __test.tBody().indexOf("width:64px") !== -1]);
__test.tExtra("status"); __test.tExtra("gauge");
checks.push(["status/gauge toggle OFF", __test.tHead().indexOf("Status") === -1 && __test.tBody().indexOf("width:64px") === -1]);
__test.tExtra("status"); __test.tExtra("gauge");
__test.tExtra("minorder");
checks.push(["Order to Min column renders", __test.tHead().indexOf("Order Qty") !== -1 && __test.tHead().indexOf("to Min") !== -1]);
checks.push(["orderToMin math (min20 inv10 so2 po5 -> 7)", __test.otm({availInv:10,salesQty:2,purchQty:5},{min:20,max:0,mult:0}).buy === 7]);
checks.push(["orderToMin multiple rounds up (need->2304)", __test.otm({availInv:0,salesQty:50,purchQty:0},{min:0.5,max:0,mult:2304}).buy === 2304]);
__test.tExtra("minorder");
checks.push(["Reorder policy chip renders ON by default", __test.chips().indexOf("Reorder policy") !== -1 && __test.chips().indexOf("toggleReorderPolicy()") !== -1]);
checks.push(["no pol data -> nothing hidden", __test.rp("ITEM-A") === false]);
__test.injectPol("ITEM-A");
checks.push(["policy item hides exactly when no scoped SO", __test.rp("ITEM-A") === !(__test.so("ITEM-A") > 0)]);
checks.push(["main table item links clickable", __test.tBody().indexOf("showItemDetail") !== -1]);

// Planner: tabs, coloured group header, ON-by-default extras, min-order, collapse, lanes
__test.openP();
checks.push(["planner tabs rendered", __test.pTabs().indexOf("Priority Lanes") !== -1]);
__test.setPOpt('group','item');
let pc = __test.pContent();
checks.push(["planner grouped colour header present", pc.indexOf("STOCK &amp; ORDERS") !== -1 || pc.indexOf("STOCK & ORDERS") !== -1]);
checks.push(["planner items clickable", pc.indexOf("showItemDetail") !== -1]);
checks.push(["isSpecialItem patterns incl SMQ/SPQ", __test.spec("TD335862") && __test.spec("TDQ55") && __test.spec("SPUQ154262") && __test.spec("SM1234") && __test.spec("SP1234") && __test.spec("SMQ77") && __test.spec("SPQ88") && __test.spec("100012X") && !__test.spec("TDHE") && !__test.spec("TDIB4000") && !__test.spec("DB")]);
__test.pcg("stock");
pc = __test.pContent();
checks.push(["planner stock group collapses to On Hand", pc.indexOf("On PO") === -1 && pc.indexOf("On Hand") !== -1]);
__test.pcg("stock");
pc = __test.pContent();
checks.push(["planner stock group re-expands", pc.indexOf("On PO") !== -1]);
checks.push(["planner status badges ON by default", /ORDER NOW|WATCH|OK|OVER/.test(pc)]);
checks.push(["planner gauge ON by default", pc.indexOf("width:64px") !== -1]);
__test.pExtra("status"); __test.pExtra("gauge");
pc = __test.pContent();
checks.push(["planner extras toggle OFF", pc.indexOf("width:64px") === -1]);
__test.pExtra("status"); __test.pExtra("gauge");
__test.pExtra("minorder");
pc = __test.pContent();
checks.push(["planner Order-to-Min column renders", pc.indexOf("Order Qty") !== -1 && pc.indexOf("TO MIN") !== -1]);
checks.push(["planner Multiple column present", pc.indexOf("Multiple") !== -1]);
__test.pExtra("minorder");

__test.tab("lanes");
pc = __test.pContent();
checks.push(["lanes tab renders four lanes", pc.indexOf("ORDER NOW") !== -1 && pc.indexOf("OVERSTOCKED") !== -1]);
checks.push(["lanes summary tiles render", __test.pSummary().indexOf("Order Now") !== -1]);
checks.push(["lane cards clickable", pc.indexOf("showItemDetail") !== -1]);
__test.tab("planner");
checks.push(["back to planner tab restores schedule (item table view)", __test.pContent().indexOf("<table") !== -1 && __test.pContent().indexOf("OVERSTOCKED") === -1]);
__test.closeP();

// Themes
checks.push(["theme applies class", __test.theme("velvet") === "theme-velvet"]);
checks.push(["classic clears class", __test.theme("classic") === ""]);
checks.push(["picker grid builds 10 cards", __test.openPicker() > 2000]);

let ok = true;
for (const [name, pass] of checks) { console.log((pass ? "PASS" : "FAIL") + " - " + name); if (!pass) ok = false; }
process.exit(ok ? 0 : 1);
