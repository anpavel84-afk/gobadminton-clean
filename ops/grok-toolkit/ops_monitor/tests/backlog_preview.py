"""Local preview of the backlog card with sample data (claim #98 like on the server). Usage: backlog_preview.py out.png"""
import datetime, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import fixtures as F, test_server as TS
from opsmon import writer
uid = os.geteuid(); NOW = datetime.datetime.now(datetime.timezone.utc)
here = os.path.dirname(os.path.abspath(__file__))
bl = writer.load_backlog_strict(os.path.join(here, '..', '..', 'backlog', 'backlog_ru.json'), {uid})
titles = {98: {'title_ru': 'M0c: ядро стабильности карты на iPhone', 'meaning_ru': 'Карта не должна мигать и пропадать.', 'closed': False, 'queued': False}}
sd = F.make_state('dev_wait', done=(82, 84, 92), parked={'parked': [{'issue': 96, 'attempt': 3, 'reason': 'QA FAIL', 'allow_successors': True}]}, issue=98, pr=99)
s, _ = writer.build(sd, F.receipt(), {}, NOW, lambda: {'ActiveState': 'active', 'SubState': 'running'}, checkpoint_owner=uid, receipt_owner=uid, titles=titles, backlog=bl)
app, srv, sp = TS.start(s)
base = 'http://127.0.0.1:%d/ops-monitor/' % srv.server_address[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2).new_page()
    pg.goto(base); pg.wait_for_selector('#login:not([hidden])'); pg.fill('#pin', TS.PIN); pg.click('button[type=submit]')
    pg.wait_for_selector('#backlog .bl')
    out = sys.argv[1]
    pg.locator('main#app').screenshot(path=out.replace('.png', '_full.png'))
    # main preview: top of page down to end of backlog card
    h = pg.evaluate("document.getElementById('backlog').getBoundingClientRect().bottom + scrollY")
    pg.evaluate("scrollTo(0,0)")
    pg.screenshot(path=out, full_page=True, clip={'x': 0, 'y': 0, 'width': 390, 'height': h + 12})
    print('rows', pg.locator('#backlog .bl').count(), 'text-first:', pg.inner_text('#backlog')[:300].replace('\n', ' | '))
    b.close()
