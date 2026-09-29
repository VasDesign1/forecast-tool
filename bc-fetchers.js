// ============================================================
// bc-fetchers.js — shared Wiise / Business Central fetch layer.
// Used by BOTH:
//   - index.html in the browser (auth via MSAL popup — bcGetToken
//     defined there)
//   - scripts/snapshot.js in GitHub Actions (auth via refresh token —
//     global.bcGetToken defined there)
// Keeping one copy guarantees Fast lookup snapshots contain exactly
// what a live "Login & Load All Data" would fetch.
// ============================================================
"use strict";

const BC_CONFIG = {
    clientId:    "0f3136a8-79cd-4335-9790-7ae3fe5800be",
    tenantId:    "68c88731-a731-4307-bb12-28557affd0ca",
    environment: "Production",
    companyName: "VICAIR Pty Ltd",
};

const BC_TENANT_DOMAIN = "VicAirPtyLtd.onmicrosoft.com";
const BC_API_BASE = "https://api.businesscentral.dynamics.com/v2.0/" + BC_TENANT_DOMAIN + "/" + BC_CONFIG.environment;
const BC_API_URL = BC_API_BASE + "/api/v2.0";
const BC_ODATA_URL = BC_API_BASE + "/ODataV4";

// SharePoint home of the encrypted data files (Fast-lookup snapshots under
// snapshots/, NAV history as nav-data.bin). Written by the snapshot robot
// (scripts/sp-upload.js, delegated refresh token) and read by the browser
// through Microsoft Graph with the signed-in user's token — Files.Read.All
// on the "VicAir Forecast Tool" app registration. Knowing the path grants
// nothing: Graph enforces the folder's SharePoint ACL.
const SP_CONFIG = {
    host:   "vicairptyltd.sharepoint.com",
    folder: "Vic Air Shared Docs Folder/03.0 Corporate/3.05 IT and Communications/bc-tools/forecast-tool",
};
const GRAPH_SCOPES = ["https://graph.microsoft.com/Files.Read.All"];

// Wiise went live 2026-04-30; everything before this date comes from the
// baked-in NAV export (nav-data.bin), everything from it onward from Wiise.
const WIISE_LEDGER_FROM = "2026-05-01";

function bcStatus(msg) {
    if (typeof updateBCStatus === "function") updateBCStatus(msg);
}
function bcProgress(label, detail) {
    if (typeof updateBCProgress === "function") updateBCProgress(label, detail);
}

// ---- Universal API Caller with auto-retry on 401 ----
// bcGetToken() is supplied by the host (index.html: MSAL; snapshot.js:
// refresh-token exchange).
async function bcFetch(url) {
    const token = await bcGetToken();
    let resp = await fetch(url, {
        headers: { "Authorization": "Bearer " + token, "Accept": "application/json" }
    });
    if (resp.status === 401) {
        if (typeof bcClearToken === "function") bcClearToken();
        const newToken = await bcGetToken();
        resp = await fetch(url, {
            headers: { "Authorization": "Bearer " + newToken, "Accept": "application/json" }
        });
    }
    if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error("BC API error " + resp.status + ": " + resp.statusText + (errBody ? " — " + errBody.substring(0, 200) : ""));
    }
    return resp.json();
}

// ---- Auto-Paginate: follow @odata.nextLink until all rows fetched ----
async function bcFetchAll(url, progressLabel) {
    let allRows = [];
    let nextUrl = url;
    let page = 0;
    while (nextUrl) {
        page++;
        const data = await bcFetch(nextUrl);
        allRows = allRows.concat(data.value || []);
        bcProgress(progressLabel, allRows.length + " rows (page " + page + ")...");
        nextUrl = data["@odata.nextLink"] || null;
    }
    return allRows;
}

// ---- Discover Company ID ----
let _bcCompanyId = null;
function bcResetCompanyId() { _bcCompanyId = null; }
async function bcGetCompanyId() {
    if (_bcCompanyId) return _bcCompanyId;
    const data = await bcFetch(BC_API_URL + "/companies");
    const companies = data.value || [];
    if (companies.length === 0) {
        throw new Error("No companies found. Check your environment name: '" + BC_CONFIG.environment + "'");
    }
    let match = companies.find(function(c) {
        return (c.displayName || c.name || "").toLowerCase() === BC_CONFIG.companyName.toLowerCase();
    });
    if (!match) {
        const availableNames = companies.map(function(c) { return c.displayName || c.name; }).join(", ");
        console.warn("Company '" + BC_CONFIG.companyName + "' not found. Available: " + availableNames + ". Using first.");
        match = companies[0];
    }
    _bcCompanyId = match.id;
    return _bcCompanyId;
}

// ---- Data Fetchers ----

// 1) Item Ledger Entries (via standard API v2.0), posting date >= WIISE_LEDGER_FROM.
//    No $top: BC treats $top as a TOTAL result cap, not a page size, and
//    silently truncates — bcFetchAll pagination brings back everything.
async function bcFetchLedgerEntries() {
    const compId = await bcGetCompanyId();

    // First fetch 1 entry to discover actual field names
    bcStatus("Discovering ledger entry field names...");
    var sampleData = await bcFetch(
        BC_API_URL + "/companies(" + compId + ")/itemLedgerEntries?$top=1"
    );
    var sampleFields = (sampleData.value && sampleData.value.length > 0) ? Object.keys(sampleData.value[0]) : [];
    console.log("Available Ledger Entry fields:", sampleFields);

    function findField(candidates) {
        for (var c = 0; c < candidates.length; c++) {
            var lower = candidates[c].toLowerCase();
            for (var f = 0; f < sampleFields.length; f++) {
                if (sampleFields[f].toLowerCase() === lower) return sampleFields[f];
            }
        }
        for (var c = 0; c < candidates.length; c++) {
            var lower = candidates[c].toLowerCase();
            for (var f = 0; f < sampleFields.length; f++) {
                if (sampleFields[f].toLowerCase().indexOf(lower) !== -1) return sampleFields[f];
            }
        }
        return "";
    }

    var fDate = findField(["postingDate", "posting_date", "Posting_Date"]) || "postingDate";
    var fItem = findField(["itemNumber", "item_number", "Item_No", "itemNo"]) || "itemNumber";
    var fQty = findField(["quantity", "Quantity"]) || "quantity";
    var fDesc = findField(["description", "Description"]) || "description";
    var fLoc = findField(["locationCode", "location_code", "Location_Code"]) || "locationCode";
    var fEntry = findField(["entryType", "entry_type", "Entry_Type"]) || "entryType";
    var fDoc = findField(["documentType", "document_type", "Document_Type"]) || "documentType";

    console.log("Mapped ledger fields — Date:", fDate, "| Item:", fItem, "| Qty:", fQty, "| Desc:", fDesc, "| Loc:", fLoc, "| EntryType:", fEntry, "| DocType:", fDoc);

    const entries = await bcFetchAll(
        BC_API_URL + "/companies(" + compId + ")/itemLedgerEntries?$filter="
            + encodeURIComponent(fDate + " ge " + WIISE_LEDGER_FROM),
        "Item Ledger Entries"
    );

    // BC's API returns enum strings with XML name escapes (e.g. "Assembly_x0020_Consumption" for "Assembly Consumption", "_x0020_" for a blank). Decode so equality checks work.
    function decodeBcName(s) {
        return String(s == null ? "" : s).replace(/_x([0-9A-Fa-f]{4})_/g, function(_, hex) {
            return String.fromCharCode(parseInt(hex, 16));
        }).trim();
    }

    var rows = [];
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        rows.push({
            "Posting Date":  e[fDate],
            "Item No.":      e[fItem],
            "Quantity":       e[fQty],
            "Description":    e[fDesc] || "",
            "Location Code":  e[fLoc] || "DEFAULT",
            "Entry Type":     decodeBcName(e[fEntry]),
            "Document Type":  decodeBcName(e[fDoc]),
        });
    }

    console.log("First 3 transformed ledger rows:", JSON.stringify(rows.slice(0, 3), null, 2));

    return {
        rows: rows,
        mapping: {
            date: "Posting Date",
            itemNo: "Item No.",
            qty: "Quantity",
            desc: "Description",
            loc: "Location Code",
            entryType: "Entry Type",
            docType: "Document Type",
        }
    };
}

// 2) Items with Order Quantities (via OData — exposes Qty on Sales/Purch Order fields)
async function bcFetchItems() {
    var coName = encodeURIComponent(BC_CONFIG.companyName);
    // First fetch 1 item without $select to discover actual field names
    bcStatus("Discovering item field names...");
    var sampleData = await bcFetch(
        BC_ODATA_URL + "/Company('" + coName + "')/Items?$top=1"
    );
    var sampleFields = (sampleData.value && sampleData.value.length > 0) ? Object.keys(sampleData.value[0]) : [];
    console.log("Available Item fields:", sampleFields);

    function findField(candidates) {
        for (var c = 0; c < candidates.length; c++) {
            var lower = candidates[c].toLowerCase();
            for (var f = 0; f < sampleFields.length; f++) {
                if (sampleFields[f].toLowerCase() === lower) return sampleFields[f];
            }
        }
        for (var c = 0; c < candidates.length; c++) {
            var lower = candidates[c].toLowerCase();
            for (var f = 0; f < sampleFields.length; f++) {
                if (sampleFields[f].toLowerCase().indexOf(lower) !== -1) return sampleFields[f];
            }
        }
        return "";
    }

    var fNo = findField(["No", "No.", "Item_No", "Item_No.", "Number"]) || "No";
    var fInv = findField(["Inventory", "Qty_on_Hand", "Quantity_on_Hand", "Stock"]);
    var fSales = findField(["Qty_on_Sales_Order", "Qty._on_Sales_Order", "Qty__on_Sales_Order", "Quantity_on_Sales_Order"]);
    var fPurch = findField(["Qty_on_Purch_Order", "Qty._on_Purch._Order", "Qty__on_Purch__Order", "Qty_on_Purch__Order", "Quantity_on_Purchase_Order"]);
    // Item card name — the ledger's Description field is blank on this tenant,
    // so this is the only source of names for post-NAV items.
    var fDesc = findField(["Description"]);

    console.log("Mapped fields — No:", fNo, "| Inventory:", fInv, "| Sales:", fSales, "| Purch:", fPurch, "| Desc:", fDesc);

    var selectFields = [fNo];
    if (fInv) selectFields.push(fInv);
    if (fSales) selectFields.push(fSales);
    if (fPurch) selectFields.push(fPurch);
    if (fDesc) selectFields.push(fDesc);

    var items = await bcFetchAll(
        BC_ODATA_URL + "/Company('" + coName + "')/Items?$select=" + selectFields.join(","),
        "Items"
    );
    var rows = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        rows.push({
            "No.":                  it[fNo] || "",
            "Inventory":            fInv ? (it[fInv] || 0) : 0,
            "Qty. on Sales Order":  fSales ? (it[fSales] || 0) : 0,
            "Qty. on Purch. Order": fPurch ? (it[fPurch] || 0) : 0,
            "Description":          fDesc ? (it[fDesc] || "") : "",
        });
    }
    return {
        rows: rows,
        mapping: {
            itemNo: "No.",
            salesQty: "Qty. on Sales Order",
            purchQty: "Qty. on Purch. Order",
            availInv: "Inventory",
            desc: "Description",
        }
    };
}

// 3) Vendor Mapping (vendors via API + current vendor per item from Items master)
async function bcFetchVendors() {
    var compId = await bcGetCompanyId();
    var coName = encodeURIComponent(BC_CONFIG.companyName);

    // Discover vendor field names
    bcStatus("Discovering vendor field names...");
    var vendorSample = await bcFetch(BC_API_URL + "/companies(" + compId + ")/vendors?$top=1");
    var vendorFields = (vendorSample.value && vendorSample.value.length > 0) ? Object.keys(vendorSample.value[0]) : [];
    console.log("Available Vendor fields:", vendorFields);

    function findVField(candidates) {
        for (var c = 0; c < candidates.length; c++) {
            var lower = candidates[c].toLowerCase();
            for (var f = 0; f < vendorFields.length; f++) {
                if (vendorFields[f].toLowerCase() === lower) return vendorFields[f];
            }
        }
        return "";
    }
    var fVNo = findVField(["number", "no", "No", "No.", "vendorNumber"]) || "number";
    var fVName = findVField(["displayName", "name", "Name", "vendorName"]) || "displayName";
    console.log("Vendor fields — No:", fVNo, "| Name:", fVName);

    var vendors = await bcFetchAll(BC_API_URL + "/companies(" + compId + ")/vendors", "Vendors");
    var nameMap = {};
    for (var i = 0; i < vendors.length; i++) {
        nameMap[vendors[i][fVNo]] = vendors[i][fVName] || "";
    }

    // Fetch current vendor per item from the Items master (Item.Vendor_No),
    // not the historical Item Vendor Catalog. One row per item with a current vendor.
    var rows = [];
    try {
        var itemsForVendor = await bcFetchAll(
            BC_ODATA_URL + "/Company('" + coName + "')/Items?$select=No,Vendor_No",
            "Item Vendors"
        );
        for (var j = 0; j < itemsForVendor.length; j++) {
            var it = itemsForVendor[j];
            var vNo = it.Vendor_No;
            if (!vNo) continue;
            rows.push({
                "No.":          it.No,
                "Vendor No.":   vNo,
                "Vendor Name":  nameMap[vNo] || "",
            });
        }
        console.log("Current item-vendor mappings: " + rows.length);
        return { rows: rows, mapping: { itemNo: "No.", vendorNo: "Vendor No.", vendorName: "Vendor Name" } };
    } catch (e) {
        console.warn("Items Vendor_No fetch failed:", e.message);
    }

    console.log("No item-vendor catalog available, returning empty vendor mapping");
    return { rows: [], mapping: { itemNo: "No.", vendorNo: "Vendor No.", vendorName: "Vendor Name" } };
}

// ---- OData v4 entity discovery ($metadata) ----
// Never hardcode published page names — tenants differ. Cached per session.
let _bcODataEntities = null;
async function bcListODataEntities() {
    if (_bcODataEntities) return _bcODataEntities;
    const token = await bcGetToken();
    const resp = await fetch(BC_ODATA_URL + "/$metadata", { headers: { "Authorization": "Bearer " + token } });
    if (!resp.ok) throw new Error("$metadata HTTP " + resp.status);
    const xml = await resp.text();
    const names = [];
    const re = /<EntitySet\s+Name="([^"]+)"/g;
    let m;
    while ((m = re.exec(xml))) names.push(m[1]);
    _bcODataEntities = names;
    return names;
}

function bcPickField(fields, candidates) {
    for (var c = 0; c < candidates.length; c++) {
        var lower = candidates[c].toLowerCase();
        for (var f = 0; f < fields.length; f++) {
            if (fields[f].toLowerCase() === lower) return fields[f];
        }
    }
    for (var c = 0; c < candidates.length; c++) {
        var lower = candidates[c].toLowerCase();
        for (var f = 0; f < fields.length; f++) {
            if (fields[f].toLowerCase().indexOf(lower) !== -1) return fields[f];
        }
    }
    return "";
}

// Outstanding document-line quantities summed per item per location.
// kind: array of regexes tried in order against published entity names;
// exclude: names matching this never qualify (invoices, receipts, ...).
async function bcFetchOutstandingByLoc(kind, exclude, label) {
    const names = await bcListODataEntities();
    let entity = null;
    for (const re of kind) {
        entity = names.find(n => re.test(n) && !exclude.test(n));
        if (entity) break;
    }
    if (!entity) throw new Error("no matching entity published in OData $metadata");
    const coName = encodeURIComponent(BC_CONFIG.companyName);
    const base = BC_ODATA_URL + "/Company('" + coName + "')/" + entity;
    const sample = await bcFetch(base + "?$top=1");
    const fields = (sample.value && sample.value[0]) ? Object.keys(sample.value[0]) : [];
    const fDocType = bcPickField(fields, ["documentType", "Document_Type"]);
    const fItem = bcPickField(fields, ["number", "itemNo", "no", "Item_No"]);
    const fLoc = bcPickField(fields, ["locationCode", "Location_Code"]);
    const fOut = bcPickField(fields, ["outstandingQuantity", "Outstanding_Quantity", "Outstanding_Qty_Base"]);
    const fType = bcPickField(fields, ["lineType", "type"]);
    console.log(label + " entity:", entity, "| fields — docType:", fDocType, "item:", fItem, "loc:", fLoc, "outstanding:", fOut, "type:", fType);
    if (!fItem || !fOut) throw new Error("entity " + entity + " lacks item/outstanding fields");
    let filter = fOut + " gt 0";
    if (fDocType) filter = fDocType + " eq 'Order' and " + filter;
    const rows = await bcFetchAll(base + "?$filter=" + encodeURIComponent(filter), label);
    const map = {};
    let kept = 0;
    for (const r of rows) {
        if (fType && String(r[fType] || "").toLowerCase() !== "item") continue;
        const item = String(r[fItem] || "").trim();
        if (!item) continue;
        const loc = (fLoc ? String(r[fLoc] || "").trim() : "") || "DEFAULT";
        const q = parseFloat(r[fOut]) || 0;
        if (q === 0) continue;
        if (!map[item]) map[item] = {};
        map[item][loc] = (map[item][loc] || 0) + q;
        kept++;
    }
    return { map: map, entity: entity, rows: rows.length, kept: kept };
}

// 4) Per-location data for branch-aware inventory and ordering:
//    inv — branch stock: EVERY ledger entry's quantity summed per
//          item+location. The tenant's ledger starts at go-live with
//          opening balances, so these sums equal Wiise's Items-by-Location.
//          Slim $select, NO $filter (the filter-drop trap needs a $filter
//          to bite; a full scan with $select is safe either way).
//    so / po — outstanding sales/purchase order line quantities per
//          item+location via discovered OData entities.
// Each part fails independently: a null map means "fall back to the
// company-wide item-card figure" and the diagnostic says why.
async function bcFetchLocationData() {
    const result = { inv: null, so: null, po: null, diagnostics: { inv: "", so: "", po: "" } };

    try {
        const compId = await bcGetCompanyId();
        const sample = await bcFetch(BC_API_URL + "/companies(" + compId + ")/itemLedgerEntries?$top=1");
        const fields = (sample.value && sample.value[0]) ? Object.keys(sample.value[0]) : [];
        const fItem = bcPickField(fields, ["itemNumber", "item_number", "Item_No", "itemNo"]) || "itemNumber";
        const fLoc = bcPickField(fields, ["locationCode", "location_code", "Location_Code"]) || "locationCode";
        const fQty = bcPickField(fields, ["quantity", "Quantity"]) || "quantity";
        const rows = await bcFetchAll(
            BC_API_URL + "/companies(" + compId + ")/itemLedgerEntries?$select=" + [fItem, fLoc, fQty].join(","),
            "Branch stock");
        const inv = {};
        for (const r of rows) {
            const item = String(r[fItem] || "").trim();
            if (!item) continue;
            const loc = String(r[fLoc] || "").trim() || "DEFAULT";
            const q = parseFloat(r[fQty]) || 0;
            if (!inv[item]) inv[item] = {};
            inv[item][loc] = (inv[item][loc] || 0) + q;
        }
        result.inv = inv;
        result.diagnostics.inv = rows.length + " ledger rows summed into " + Object.keys(inv).length + " items";
    } catch (e) {
        result.diagnostics.inv = "unavailable — " + e.message;
        console.warn("Branch stock fetch failed:", e.message);
    }

    try {
        const so = await bcFetchOutstandingByLoc(
            [/^salesdocumentlines?$/i, /salesdocument.*line/i, /sales.*doc.*line/i],
            /invoice|shipment|credit|archive|quote/i, "Open SO lines");
        result.so = so.map;
        result.diagnostics.so = so.kept + " open order lines via " + so.entity;
    } catch (e) {
        result.diagnostics.so = "unavailable — " + e.message;
        console.warn("Open SO lines fetch failed:", e.message);
    }

    try {
        const po = await bcFetchOutstandingByLoc(
            [/^purchasedocumentlines?$/i, /purchasedocument.*line/i, /purch.*doc.*line/i, /purchase.*line/i],
            /invoice|receipt|credit|archive|quote/i, "Open PO lines");
        result.po = po.map;
        result.diagnostics.po = po.kept + " open order lines via " + po.entity;
    } catch (e) {
        result.diagnostics.po = "unavailable — " + e.message;
        console.warn("Open PO lines fetch failed:", e.message);
    }

    return result;
}

// Node (snapshot robot) — browsers ignore this block.
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        BC_CONFIG, BC_TENANT_DOMAIN, BC_API_BASE, BC_API_URL, BC_ODATA_URL, SP_CONFIG, GRAPH_SCOPES,
        WIISE_LEDGER_FROM,
        bcFetch, bcFetchAll, bcGetCompanyId, bcResetCompanyId,
        bcFetchLedgerEntries, bcFetchItems, bcFetchVendors, bcFetchLocationData,
    };
}
