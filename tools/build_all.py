# Rebuilds data/ from a decrypted app folder (the unzipped Payload/<name>.app).
# Usage: python3 tools/build_all.py APP_FOLDER [WEB_ROOT] [--tex TEXDIR]
# Order: textures dump, models and stages, per-stage sim data, ball and prince models, UI art, strings (six languages).
# export_play.py runs for the first six stages. Only export_core.py and export_strings.py were re-run from this
# script after the arguments were added; the rest ran earlier with the same arguments by hand (ASSUMPTIONS C4).
import os, sys, json, subprocess
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args: sys.exit(__doc__)
APP = os.path.abspath(args[0]); WEB = os.path.abspath(args[1]) if len(args) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = sys.argv[sys.argv.index('--tex') + 1] if '--tex' in sys.argv else os.path.join(WEB, '_cs', 'tex')
T = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(WEB, 'data')
def run(*a):
    print('>', ' '.join(os.path.basename(x) if x.endswith('.py') else x for x in a), flush=True); subprocess.check_call([sys.executable, *a])
os.makedirs(TEX, exist_ok=True); os.makedirs(DATA, exist_ok=True)
run(os.path.join(T, 'dump_tex.py'), APP, TEX)
run(os.path.join(T, 'export.py'), APP, DATA, TEX)
run(os.path.join(T, 'export_stage.py'), APP, DATA)
stages = json.load(open(os.path.join(DATA, 'stages.json')))
names = [s if isinstance(s, str) else s.get('id') or s.get('name') for s in stages] if isinstance(stages, list) else list(stages)
run(os.path.join(T, 'export_play.py'), APP, DATA, *names[:6])   # the first pack; stages 7 and up are not exported (ASSUMPTIONS A44)
run(os.path.join(T, 'export_core.py'), APP, DATA)
run(os.path.join(T, 'export_ouji.py'), APP, DATA)
run(os.path.join(T, 'export_ui.py'), APP, os.path.join(WEB, 'ui'))
for lang, code in [('English', 'en'), ('French', 'fr'), ('German', 'de'), ('Italian', 'it'), ('Japanese', 'ja'), ('Spanish', 'es')]:
    run(os.path.join(T, 'export_strings.py'), APP, os.path.join(DATA, 'strings_%s.json' % code), lang)
print('done. Run: node tests/bot2.js S001, node tests/game_smoke.js')
