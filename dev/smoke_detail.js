"use strict";
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/sim_test_loc.js", "utf8");
let head = src.substring(0, src.indexOf("const checks = []"));
head = head.replace("global.document = {", "global.document = { documentElement: { className: '' }, ");
head = head.replace("globalThis.__test = {",
    "globalThis.__test = { openItem(n) { showItemDetail(n); }, dContent() { return document.getElementById('detailContent').innerHTML; }, "
    + "dList() { return document.getElementById('detailListPane').innerHTML; }, dSearch(v) { detailListQuery = v; buildDetailList(detailItemNo); }, "
    + "advOpen() { openAdvModal(); return document.getElementById('advModalContent').innerHTML; }, advBuf() { return detailAdvHtml.length; }, ");
eval(head);
global.document.getElementById("pageSize").value = "50";

const checks = [];
__test.openItem("ITEM-A");
const c = __test.dContent();
checks.push(["detail renders", c.length > 3000]);
checks.push(["Advanced button present (popup opener)", c.indexOf("openAdvModal()") !== -1]);
checks.push(["no inline advanced panel left behind", c.indexOf("advForecastPanel") === -1]);
checks.push(["advanced markup captured to buffer", __test.advBuf() > 2000]);
const adv = __test.advOpen();
checks.push(["advanced popup fills with methods", adv.indexOf("Weighted Moving Average") !== -1 || adv.indexOf("WMA") !== -1]);
checks.push(["side-by-side inv/net wrapper present", c.indexOf("gap:36px") !== -1]);
checks.push(["side-by-side usage/monthly wrapper present", c.indexOf("gap:30px") !== -1]);
checks.push(["monthly chart present", c.indexOf("Monthly usage (last") !== -1]);
checks.push(["custom forecast pane intact", c.indexOf("Custom Forecast") !== -1]);
checks.push(["monthly breakdown intact", c.indexOf("Monthly Breakdown") !== -1]);
const l0 = __test.dList();
checks.push(["item list rendered", (l0.match(/showItemDetail/g) || []).length >= 2]);
__test.dSearch("item-b");
const l1 = __test.dList();
checks.push(["list search filters", (l1.match(/showItemDetail/g) || []).length === 1]);
__test.dSearch("zzz-nope");
checks.push(["list search empty-state", __test.dList().indexOf("No items match") !== -1]);
__test.dSearch("");

let ok = true;
for (const [name, pass] of checks) { console.log((pass ? "PASS" : "FAIL") + " — " + name); if (!pass) ok = false; }
process.exit(ok ? 0 : 1);
