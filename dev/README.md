# Dev tooling (not part of the app)

Node DOM-stub test suites for index.html — run `node dev/sim_test_loc.js` etc.
The harness base is sim_test_loc.js; the smokes patch and eval its head.
gen_themes.py regenerates the theme CSS block in index.html between the
'THEMES (' marker and </style> — edit the T dict / block() and re-run.
