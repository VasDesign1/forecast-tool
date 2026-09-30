"use strict";
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/sim_test_loc.js", "utf8");
let head = src.substring(0, src.indexOf("const checks = []"));
head = head.replace("global.document = {", "global.document = { documentElement: { className: '' }, ");
head = head.replace("globalThis.__test = {",
    "globalThis.__test = { openP() { openOrderPlanner(); }, openV(k) { openPlannerVendor(encodeURIComponent(k)); }, "
    + "cont() { toggleVendorContainerPlanner(); }, ");
eval(head);
global.document.getElementById("pageSize").value = "50";
try {
    __test.openP();
    __test.openV("2124");
    console.log("vendor popup rendered OK");
    __test.cont();
    console.log("container toggle OK");
} catch (e) {
    console.log("ERROR:", e.message);
    console.log(e.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
}
