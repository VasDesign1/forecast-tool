// Browser check of the procurement tabs on localhost demo data.
//   1. python -m http.server 8765        (in the repo root)
//   2. chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<tmp> about:blank
//   3. node dev/cdp_procure.mjs [screenshot-dir]
// Opens every procurement tab, clicks its chips and sorts, and fails on any
// script error or a tab that could not be built.
import fs from "node:fs";
const shotDir = process.argv[2] || "";
const target = await (await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map(a => a.value || a.description).join(" "));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(expression.slice(0, 80) + " → " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('forecastWorkspace','1')}catch(e){}" });
await send("Page.navigate", { url: "http://localhost:8765/index.html" });
await sleep(2500);
await ev("loadDemoData()");
await sleep(800);

let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? "  ok   " : "  FAIL ") + name + (extra ? " — " + extra : "")); if (!ok) fails++; };
const stat = () => ev(`(function(){var h=document.getElementById('wsProcureHost');return {shown:h.style.display,rows:h.querySelectorAll('tbody tr').length,
    bad:/Something went wrong|could not be built|undefined|NaN/.test(h.innerText),title:(h.querySelector('h2')||{}).textContent,tiles:h.querySelectorAll('[style*="font-size:20px;font-weight:700"]').length,
    ths:h.querySelectorAll('th').length, helps:h.querySelectorAll('th[data-help]').length, text:h.innerText.slice(0,160).replace(/\\s+/g,' ')};})()`);
const shot = async (name) => {
    if (!shotDir) return;
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shotDir + "/" + name + ".png", Buffer.from(r.result.data, "base64"));
};

check("procurement tabs are in the strip", await ev("document.querySelectorAll('#wsTabBtns .ws-tab').length") === 14);
check("demo purchasing data loaded", await ev("!!PROC._data() && PROC._data().po.length > 0"));
const tabs = await ev("PROC.TABS.map(t => t.key)");
for (const t of tabs) {
    await ev("wsSelectTab('" + t + "')");
    await sleep(150);
    const s = await stat();
    check(t + " renders", s.shown === "block" && !s.bad && s.ths > 3, s.title + " · " + s.rows + " rows · " + s.tiles + " tiles · " + s.text.slice(0, 70));
    check(t + " forecast table hidden", await ev("document.getElementById('tableContainer').style.display") === "none");
    await shot(t);
    // sort by every column, both directions
    const n = s.ths;
    for (let i = 0; i < n; i++) { await ev("document.querySelectorAll('#wsProcureHost th')[" + i + "].click()"); await ev("document.querySelectorAll('#wsProcureHost th')[" + i + "].click()"); }
    const s2 = await stat();
    check(t + " survives sorting every column", !s2.bad && s2.rows === s.rows);
    // every chip in the header bar
    const chips = await ev("document.querySelectorAll('#wsProcureHost .table-header-bar button').length");
    for (let i = 0; i < chips; i++) {
        await ev("(function(){var b=document.querySelectorAll('#wsProcureHost .table-header-bar button')[" + i + "]; if(b) b.click();})()");
        const s3 = await stat();
        if (s3.bad) { check(t + " chip " + i, false, s3.text); }
    }
    check(t + " survives its " + chips + " chips", !(await stat()).bad);
}
// filters reach the tabs
await ev("wsSelectTab('p_po')");
const all = (await stat()).rows;
await ev("PROC.set('poFilter','all'); document.getElementById('searchInput').value='DEMO-00'; applyFilters()");
await sleep(200);
const few = await ev("PROC._state.last.rows.length");
check("search narrows Purchase Orders", few > 0 && few < await ev("PROC._data().po.length"), few + " lines");
await ev("document.getElementById('searchInput').value=''; applyFilters()");
await ev("(function(){var b=document.querySelector('.loc-btn[data-loc=\"20\"]')||Array.from(document.querySelectorAll('.loc-btn')).find(x=>x.textContent.trim()==='20'); if(b) b.click();})()");
await sleep(200);
check("branch filter narrows Purchase Orders", await ev("PROC._state.last.rows.every(r => r.loc === '20') && PROC._state.last.rows.length > 0"), await ev("PROC._state.last.rows.length") + " lines at 20");
await ev("(function(){var b=Array.from(document.querySelectorAll('.loc-btn')).find(x=>/^all$/i.test(x.textContent.trim())); if(b) b.click();})()");
// vendor drill-in
await ev("wsSelectTab('p_vendors')");
const v = await ev("PROC._state.last.rows[0].vendor");
await ev("PROC.openVendor('" + v + "')");
await sleep(150);
const vd = await stat();
check("vendor detail opens", !vd.bad && /vendor detail/.test(vd.text), vd.text.slice(0, 60));
await shot("p_vendor_detail");
await ev("PROC.setLead('" + v + "','55')");
check("typed lead time is used", await ev("JSON.parse(localStorage.getItem('forecastProcLead'))['" + v + "']") === 55);
await ev("PROC.setLead('" + v + "','')");
await ev("PROC.closeVendor()");
// export builds a file without throwing
await ev("wsSelectTab('p_buy'); (function(){var c=URL.createObjectURL; window._csv=0; URL.createObjectURL=function(b){window._csv=b.size; return c.call(URL,b);}; wsExportCSV();})()");
check("Export CSV produces a file", await ev("window._csv") > 100, await ev("window._csv") + " bytes");
// forecast tabs still work, and classic view hides everything
await ev("wsSelectTab('results')");
check("back to Forecast Results", await ev("document.getElementById('wsProcureHost').style.display") === "none" && await ev("document.getElementById('tableContainer').style.display") === "");
await ev("wsSelectTab('p_po'); toggleWorkspace()");
check("classic view hides procurement", await ev("document.getElementById('wsProcureHost').style.display") === "none" && await ev("wsTab") === "results");
await ev("toggleWorkspace()");
// forecast accuracy must leave the tool's month tables untouched
const before = await ev("globalSortedMonths.join(',') + '|' + totalMonthsGlobal");
await ev("wsSelectTab('p_accuracy')");
check("accuracy check restores the month tables", before === await ev("globalSortedMonths.join(',') + '|' + totalMonthsGlobal"));
check("no script errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
await send("Page.close").catch(() => {});
ws.close();
process.exit(fails ? 1 : 0);
