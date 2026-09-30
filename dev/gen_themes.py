# -*- coding: utf-8 -*-
# Faithful port of the bc-sales-tool themes. Two layers per theme:
#  1) classed-surface rules (body/header/panels/tables/buttons/modals/sign-in)
#  2) an inline-style remap engine using [style*=...] attribute selectors,
#     which is what lets the popups' inline-styled content take the theme.
import io

T = {
 "onyx":        dict(dark=1, page="#0a0a0b", ink="#f5f4f1", tdInk="#c8c4bb", mut="#88837a", acc="#d4af7a", accInk="#0a0a0b",
                     panel="#141416", panel2="#1c1b18", line="#2a2820", th="#1c1b18", thInk="#d4af7a",
                     hdrBg="#0a0a0b", hdrInk="#d4af7a", disp="'Cormorant Garamond', Georgia, serif", it=0),
 "linen":       dict(dark=0, page="#f4f1eb", ink="#1a1a1a", tdInk="#1a1a1a", mut="#6e6a60", acc="#5b6e3f", accInk="#f4f1eb",
                     panel="#faf8f2", panel2="#ebe7df", line="rgba(45,42,36,0.18)", th="#ebe7df", thInk="#6e6a60",
                     hdrBg="#efebe1", hdrInk="#1a1a1a", disp="'Fraunces', Georgia, serif", it=0),
 "aurora":      dict(dark=1, page="#08081b", ink="#eaeaf2", tdInk="#eaeaf2", mut="#9d99c8", acc="#b57bff", accInk="#08081b",
                     panel="#14142a", panel2="#1b1b36", line="rgba(255,255,255,0.12)", th="#0d0d24", thInk="#d4baff",
                     hdrBg="#0b0b22", hdrInk="#d4baff", disp="'Space Grotesk', sans-serif", it=0,
                     valFont="'JetBrains Mono', monospace"),
 "atelier":     dict(dark=0, page="#ffffff", ink="#000000", tdInk="#000000", mut="#555555", acc="#ff4400", accInk="#ffffff",
                     panel="#ffffff", panel2="#f2f2f2", line="#000000", th="#000000", thInk="#ffffff",
                     hdrBg="#000000", hdrInk="#ffffff", disp="'Space Grotesk', sans-serif", it=0,
                     extra=("html.theme-atelier .header h1 { text-transform: uppercase; letter-spacing: -1px; font-weight: 700; }\n"
                            "html.theme-atelier .upload-section, html.theme-atelier .stats-bar, html.theme-atelier .controls, html.theme-atelier .table-container { border: 2px solid #000; box-shadow: 4px 4px 0 #000; border-radius: 0; }\n"
                            "html.theme-atelier .btn-primary { border-radius: 0 !important; text-transform: uppercase; font-weight: 700; }\n"
                            "html.theme-atelier .btn-outline { border: 2px solid #000 !important; color: #000 !important; border-radius: 0 !important; text-transform: uppercase; font-weight: 700; }\n"
                            "html.theme-atelier .fgroup { border: 2px solid #000; border-radius: 0; }\n"
                            # Brutalism: no rounded corners anywhere, including inline-styled chips/cards in popups
                            "html.theme-atelier [style*=\"border-radius\"] { border-radius: 0 !important; }\n"
                            "html.theme-atelier .loc-btn, html.theme-atelier .method-btn, html.theme-atelier .page-btn { border: 2px solid #000; border-radius: 0; font-weight: 700; text-transform: uppercase; }\n"
                            "html.theme-atelier .loc-btn.active, html.theme-atelier .method-btn.active { border-color: #000 !important; }\n"
                            "html.theme-atelier th { font-family: 'Space Grotesk', sans-serif; text-transform: uppercase; letter-spacing: -0.2px; }\n"
                            "html.theme-atelier .stat .value { font-weight: 900; letter-spacing: -1px; }\n"
                            "html.theme-atelier .stat .label { color: #000; }\n"
                            "html.theme-atelier .modal-overlay > div { border: 2px solid #000 !important; box-shadow: 8px 8px 0 #000; border-radius: 0; }\n"
                            "html.theme-atelier .signin-card { border: 2px solid #000; box-shadow: 8px 8px 0 #000; border-radius: 0; }\n"
                            "TILESEL { background: #ffffff !important; border: 2px solid #000 !important; box-shadow: 3px 3px 0 #000; }")),
 "concierge":   dict(dark=0, page="#e8e1d5", ink="#2c2a26", tdInk="#2c2a26", mut="#8a8474", acc="#0e4d3f", accInk="#f3eee5",
                     panel="#f3eee5", panel2="#e3dccf", line="rgba(44,42,38,0.14)", th="#e3dccf", thInk="#0e4d3f",
                     hdrBg="linear-gradient(135deg,#0e4d3f,#17604f)", hdrInk="#f3eee5", disp="'Fraunces', Georgia, serif", it=1),
 "marble":      dict(dark=0, page="#f1f2f4", ink="#1c2833", tdInk="#1c2833", mut="#7c8797", acc="#1e3a5f", accInk="#f9fafb",
                     panel="#ffffff", panel2="#eef1f4", line="rgba(28,40,51,0.10)", th="#eef1f4", thInk="#1e3a5f",
                     hdrBg="#ffffff", hdrInk="#1e3a5f", disp="'Cormorant Garamond', Georgia, serif", it=0,
                     extra="html.theme-marble .header { box-shadow: 0 1px 0 rgba(28,40,51,0.12); }"),
 "velvet":      dict(dark=1, page="#1a0a0f", ink="#f0e6d2", tdInk="#f0e6d2", mut="#a08a76", acc="#c9a04a", accInk="#1a0a0f",
                     panel="#2a1014", panel2="#33161c", line="rgba(201,160,74,0.18)", th="#1f0c11", thInk="#c9a04a",
                     hdrBg="linear-gradient(135deg,#14070a,#331218)", hdrInk="#c9a04a", disp="'Cormorant Garamond', Georgia, serif", it=0),
 "glacier":     dict(dark=0, page="#e8eef3", ink="#1a2738", tdInk="#1a2738", mut="#7d92ab", acc="#1b4f7e", accInk="#f6f9fb",
                     panel="#f6f9fb", panel2="#dde7ef", line="rgba(26,39,56,0.10)", th="#dde7ef", thInk="#1b4f7e",
                     hdrBg="linear-gradient(135deg,#dde9f2,#f2f8fd)", hdrInk="#1b4f7e", disp="'Fraunces', Georgia, serif", it=0),
 "bibliotheque":dict(dark=0, page="#ede4d2", ink="#2a1c0e", tdInk="#2a1c0e", mut="#8d7f68", acc="#7a1f2b", accInk="#f6efdd",
                     panel="#f6efdd", panel2="#e3d8bf", line="rgba(42,28,14,0.14)", th="#e3d8bf", thInk="#7a1f2b",
                     hdrBg="linear-gradient(135deg,#4a1d22,#6b2830)", hdrInk="#e8d8b8", disp="'Cormorant Garamond', Georgia, serif", it=1,
                     extra="html.theme-bibliotheque th { font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; text-transform: none; font-size: 13px; letter-spacing: 0.3px; }"),
 "pavilion":    dict(dark=0, page="#efeae0", ink="#2e3329", tdInk="#2e3329", mut="#84887a", acc="#6e7d5e", accInk="#f9f5ec",
                     panel="#f9f5ec", panel2="#efeae0", line="rgba(46,51,41,0.12)", th="#f9f5ec", thInk="#2e3329",
                     hdrBg="linear-gradient(135deg,#66705c,#7f8a73)", hdrInk="#f2f0e8", disp="'Fraunces', Georgia, serif", it=0),
}

NAVY = ["#1a237e", "#0d47a1", "#283593", "#3949ab"]
MUTED = ["color:#555", "color:#666", "color:#777", "color:#888", "color:#999", "color:#444"]
SOFT_BG = ["#f8f9ff", "#fafbfe", "#f4f5fb", "#eef0f7", "#f5f7ff", "#eef0fb", "#eef1fb"]
TILE_BG = ["#e8eaf6", "#e3f2fd", "#e8f5e9", "#fff3e0", "#ffebee", "#f3e5f5", "#bbdefb", "#b2dfdb", "#e0f2f1", "#fff8e1", "#dfe3f5", "#e0f2f1", "#f5f5ff", "#e0e0e0"]
LINE_BORDERS = ["1px solid #eee", "1px solid #f0f0f0", "1px solid #e0e0e0", "1px solid #eceef6", "1px solid #e3e6f2", "1px solid #e0e3f0", "1px solid #e8eaf2", "1px solid #f4f4f4", "1px solid #e8eaf2"]
GROUPS_BRIGHT = { "usage": "#4dd0c2", "forecast": "#6fb1f5", "stock": "#c98ae8", "net": "#ffa062" }

def sel_list(X, styles, prop_frag):
    return ", ".join('html.theme-%s [style*="%s"]' % (X, s if prop_frag is None else prop_frag % s) for s in styles)

def block(X, t):
    L = []
    A = lambda s: L.append(s)
    A("/* ---- Theme: %s (ported from bc-sales-tool) ---- */" % X)
    A("html.theme-%s body { background: %s; color: %s; font-family: 'Inter', 'Segoe UI', sans-serif; }" % (X, t["page"], t["ink"]))
    A("html.theme-%s .header { background: %s; color: %s; box-shadow: none; border-bottom: 1px solid %s; }" % (X, t["hdrBg"], t["hdrInk"], t["line"]))
    A("html.theme-%s .header h1 { font-family: %s; font-weight: 500; %s }" % (X, t["disp"], "font-style: italic;" if t["it"] else ""))
    A("html.theme-%s .header .subtitle { color: %s; opacity: 1; }" % (X, t["mut"]))
    A("html.theme-%s .upload-section, html.theme-%s .stats-bar, html.theme-%s .controls, html.theme-%s .table-container { background: %s; border: 1px solid %s; box-shadow: none; }" % (X, X, X, X, t["panel"], t["line"]))
    A("html.theme-%s .fgroup { background: %s; border-color: %s; }" % (X, t["panel2"], t["line"]))
    A("html.theme-%s .controls label, html.theme-%s .stat .label { color: %s; }" % (X, X, t["mut"]))
    A("html.theme-%s .stat .label { text-transform: uppercase; letter-spacing: 0.8px; font-size: 10.5px; font-weight: 700; }" % X)
    A("html.theme-%s .stat .value { color: %s; font-family: %s; font-size: 26px; letter-spacing: -0.3px; }" % (X, t["acc"], t.get("valFont", t["disp"])))
    A("html.theme-%s th { background: %s; color: %s; border-bottom: 1px solid %s; }" % (X, t["th"], t["thInk"], t["line"]))
    A("html.theme-%s th:hover { background: %s; filter: none; }" % (X, t["panel2"]))
    A("html.theme-%s td { color: %s; border-bottom: 1px solid %s; }" % (X, t["tdInk"], t["line"]))
    A("html.theme-%s #tableContainer tbody td:nth-child(1), html.theme-%s #tableContainer tbody td:nth-child(2), html.theme-%s #tableContainer thead tr:first-child th:nth-child(1), html.theme-%s #tableContainer thead tr:first-child th:nth-child(2) { background: %s; }" % (X, X, X, X, t["panel"]))
    A("html.theme-%s tr:nth-child(even) { background: %s; }" % (X, "rgba(255,255,255,0.02)" if t["dark"] else "rgba(0,0,0,0.015)"))
    A("html.theme-%s tr:hover, html.theme-%s tr:nth-child(even):hover, html.theme-%s #tableContainer tbody tr:hover td { background: %s; }" % (X, X, X, t["panel2"]))
    A("html.theme-%s .btn-primary { background: %s !important; color: %s !important; box-shadow: none; }" % (X, t["acc"], t["accInk"]))
    A("html.theme-%s .btn-outline { background: %s !important; color: %s !important; border-color: %s !important; }" % (X, t["panel"], t["acc"], t["acc"]))
    A("html.theme-%s .loc-btn, html.theme-%s .method-btn, html.theme-%s .page-btn { background: %s; color: %s; border-color: %s; }" % (X, X, X, t["panel"], t["tdInk"], t["line"]))
    A("html.theme-%s .loc-btn.active, html.theme-%s .method-btn.active { background: %s !important; color: %s !important; border-color: %s !important; }" % (X, X, t["acc"], t["accInk"], t["acc"]))
    A("html.theme-%s input, html.theme-%s select { background: %s; color: %s; border-color: %s; }" % (X, X, t["panel"], t["ink"], t["line"]))
    A("html.theme-%s .pagination { background: %s; border-top: 1px solid %s; }" % (X, t["panel"], t["line"]))
    A("html.theme-%s .vendor-dropdown { background: %s; color: %s; border-color: %s; }" % (X, t["panel"], t["ink"], t["line"]))
    A("html.theme-%s .no-data h3, html.theme-%s .no-data p, html.theme-%s .count { color: %s; }" % (X, X, X, t["mut"]))
    A("html.theme-%s .table-header-bar { border-bottom-color: %s; }" % (X, t["line"]))
    A("html.theme-%s .table-header-bar h2 { color: %s; font-family: %s; }" % (X, t["acc"], t["disp"]))
    # Modals & popups: card surfaces
    A("html.theme-%s .modal-overlay { background: %s; }" % (X, "rgba(0,0,0,0.72)" if t["dark"] else "rgba(30,28,24,0.45)"))
    A("html.theme-%s .modal-overlay > div { background: %s !important; color: %s; border: 1px solid %s; }" % (X, t["panel"], t["ink"], t["line"]))
    A("html.theme-%s .signin-overlay { background: %s; }" % (X, "rgba(6,6,8,0.96)" if t["dark"] else "rgba(38,35,30,0.90)"))
    A("html.theme-%s .signin-card { background: %s; color: %s; border: 1px solid %s; }" % (X, t["panel"], t["ink"], t["line"]))
    A("html.theme-%s .signin-card h2 { color: %s; font-family: %s; }" % (X, t["acc"], t["disp"]))
    A("html.theme-%s .signin-card p { color: %s; }" % (X, t["mut"]))
    A("html.theme-%s .signin-card .big-btn, html.theme-%s #themeBtn { background: %s; color: %s; border-color: %s; }" % (X, X, t["acc"], t["accInk"], t["acc"]))
    A("html.theme-%s .import-badge { background: %s; color: %s; }" % (X, t["acc"], t["accInk"]))
    A("html.theme-%s .pv-tile:hover { box-shadow: 0 3px 10px rgba(0,0,0,%s); }" % (X, "0.55" if t["dark"] else "0.18"))
    A("html.theme-%s .import-badge:hover, html.theme-%s .import-badge.order-badge { background: %s; filter: brightness(1.1); }" % (X, X, t["acc"]))
    # Inline-style remap engine
    A(sel_list(X, NAVY, "color:%s") + " { color: %s !important; }" % t["acc"])
    A(sel_list(X, NAVY, "color: %s") + " { color: %s !important; }" % t["acc"])
    # Navy BACKGROUNDS too (active planner chips, progress bar, vendor header rows)
    A(sel_list(X, NAVY, "background:%s") + " { background: %s !important; color: %s !important; border-color: %s !important; }" % (t["acc"], t["accInk"], t["acc"]))
    A('html.theme-%s [style*="background:linear-gradient(180deg,#5c6bc0,#1a237e)"] { background: %s !important; }' % (X, t["acc"]))
    A(sel_list(X, MUTED, None) + " { color: %s !important; }" % t["mut"])
    A('html.theme-%s [style*="color:#333"] { color: %s !important; }' % (X, t["ink"]))
    A('html.theme-%s [style*="background:white"], html.theme-%s [style*="background:#fff"] { background: %s !important; color: %s; }' % (X, X, t["panel"], t["ink"]))
    A(sel_list(X, SOFT_BG, "background:%s") + " { background: %s !important; }" % t["panel2"])
    A(sel_list(X, LINE_BORDERS, None) + " { border-color: %s !important; }" % t["line"])
    # Tiles (summary/stat cards in popups & panels): every theme reskins them, not just dark ones
    A(sel_list(X, TILE_BG, "background:%s") + " { background: %s !important; border: 1px solid %s; }" % (t["panel2"], t["line"]))
    A('html.theme-%s [style*="background:#e0f2f1"] { background: %s !important; }' % (X, t["panel2"]))
    # Big bold figures (tile values, modal stats) take the theme's display font — the popups change with the theme
    A(", ".join('html.theme-%s [style*="font-size:%dpx;font-weight:700"]' % (X, n) for n in (16, 17, 18, 20, 22, 24, 26))
      + " { font-family: %s; }" % t.get("valFont", t["disp"]))
    if t["dark"]:
        # ribbon sub-headers & column tints, dark-adapted (group bars stay)
        for g, bright in GROUPS_BRIGHT.items():
            A('html.theme-%s tr.col-sub th[data-g="%s"] { background: %s; color: %s; }' % (X, g, t["panel2"], bright))
            A('html.theme-%s #tableContainer td[data-g="%s"] { background: rgba(255,255,255,0.025); }' % (X, g))
    if t.get("extra"):
        A(t["extra"].replace("TILESEL", sel_list(X, TILE_BG, "background:%s")))
    return "\n        ".join(L)

out = "\n        /* ================= THEMES (full ports of the bc-sales-tool visual systems) ================= */\n        "
out += "\n\n        ".join(block(k, v) for k, v in T.items())
out += "\n"

path = r"C:\Users\61481\repos\forecast-tool\index.html"
with io.open(path, "r", encoding="utf-8", newline="") as f:
    src = f.read()
start = src.index("        /* ================= THEMES (")
end = src.index("    </style>")
new = src[:start] + out + src[end:]
with io.open(path, "w", encoding="utf-8", newline="") as f:
    f.write(new)
print("old theme css:", src[start:end].count("\n"), "lines -> new:", out.count("\n"), "lines")
