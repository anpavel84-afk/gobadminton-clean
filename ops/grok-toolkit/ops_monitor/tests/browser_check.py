"""Headless-browser check (test-only dep: playwright + system chrome). Usage: browser_check.py [shots_dir]"""
import datetime, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import fixtures as F, test_server as TS
from opsmon import writer
shots = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'screenshots')
os.makedirs(shots, exist_ok=True)
NOW = datetime.datetime.now(datetime.timezone.utc)
uid = os.geteuid()
def mk(sd, run=True, rc=None, age=0, journal=None):
    s, _ = writer.build(sd, rc or F.receipt(), journal or {}, NOW - datetime.timedelta(seconds=age),
                        (lambda: {'ActiveState': 'active', 'SubState': 'running'}) if run else (lambda: {'ActiveState': 'inactive', 'SubState': 'dead'}),
                        checkpoint_owner=uid, receipt_owner=uid)
    return s
scen = {}
for ph in F.PHASES:
    scen[ph] = (mk(F.make_state(ph, **({'reason': 'CI failed on head', 'resume_phase': 'ci'} if ph == 'blocked' else {}))), ['#82', 'Контакты площадок'])
scen['parked'] = (mk(F.make_state(None, parked={'parked': [{'issue': 70, 'attempt': 3, 'reason': 'zero diff on retry', 'allow_successors': True}]})), ['На паузе', '#70', 'Нужно решение Owner'])
scen['idle'] = (mk(F.make_state(None)), ['Исполнитель свободен'])
scen['stale'] = (mk(F.make_state('qa'), age=900), ['Нет свежих данных', 'устарели'])
scen['stopped'] = (mk(F.make_state('qa'), run=False), ['ОСТАНОВЛЕН', 'Исполнитель остановлен'])
scen['no_checkpoint'] = (mk('/nonexistent'), ['Нет данных чекпоинта'])
sd = F.make_state('dev_wait'); _, j = writer.build(sd, F.receipt(), {}, NOW, lambda: {}, checkpoint_owner=uid, receipt_owner=uid)
s2, _ = writer.build(F.make_state(None, done=(1, 2, 3, 82)), F.receipt(), j, NOW, lambda: {'ActiveState': 'active', 'SubState': 'running'}, checkpoint_owner=uid, receipt_owner=uid)
scen['done_evidence'] = (s2, ['Недавно завершено', 'release r12-a3'])
_BL = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backlog', 'backlog_ru.json')))['items'] \
    if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backlog', 'backlog_ru.json')) else []
_XSS = [{'id': 'XSS', 'issue': None, 'title_ru': '<img src=x onerror=alert(1)><script>alert(2)</script>', 'status': 'в планах', 'priority': None, 'depends_on': []}]
_s, _ = writer.build(F.make_state('dev_wait'), F.receipt(), {}, NOW, lambda: {'ActiveState': 'active', 'SubState': 'running'},
                     checkpoint_owner=uid, receipt_owner=uid, backlog=_BL)
scen['backlog'] = (_s, ['Бэклог', 'Показать ещё', 'M0d', 'после: M0c'])
_s3, _ = writer.build(F.make_state('qa'), F.receipt(), {}, NOW, lambda: {'ActiveState': 'active', 'SubState': 'running'},
                      checkpoint_owner=uid, receipt_owner=uid, backlog=_XSS)
scen['backlog_xss'] = (_s3, ['<img src=x onerror'])
_s2, _ = writer.build(F.make_state('qa'), F.receipt(), {}, NOW, lambda: {'ActiveState': 'active', 'SubState': 'running'},
                      checkpoint_owner=uid, receipt_owner=uid, backlog=None)
scen['backlog_missing'] = (_s2, ['Бэклог недоступен'])
app, srv, sp = TS.start(None)
base = 'http://127.0.0.1:%d/ops-monitor/' % srv.server_address[1]
bad = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for w, h in ((390, 844), (430, 932)):
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, bypass_csp=True)
        pg = ctx.new_page()
        # anonymous: login screen, no data
        pg.goto(base); pg.wait_for_selector('#login:not([hidden])')
        assert pg.locator('#app').is_hidden()
        # wrong pin
        pg.fill('#pin', '1234'); pg.click('button[type=submit]'); pg.wait_for_function("document.getElementById('loginerr').textContent.length>0")
        assert 'Неверный' in pg.inner_text('#loginerr')
        pg.screenshot(path='%s/login_%d.png' % (shots, w))
        pg.fill('#pin', TS.PIN); pg.click('button[type=submit]'); pg.wait_for_selector('#app:not([hidden])')
        for name, (snap, expect) in scen.items():
            open(sp, 'w').write(json.dumps(snap, ensure_ascii=False))
            pg.reload(); pg.wait_for_selector('#app:not([hidden])'); pg.wait_for_function("document.getElementById('fresh').textContent!=='…'")
            txt = pg.inner_text('body')
            sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]')
            wide = pg.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'.'+e.className).slice(0,5)")
            ok = sw <= cw and not wide
            miss = [e for e in expect if e.lower() not in txt.lower()]
            if name in F.PHASES and name not in ('done', 'blocked'):
                cur = pg.locator('.steps li.cur').inner_text() if pg.locator('.steps li.cur').count() else None
                exp = {'claimed': 'Код', 'developing': 'Код', 'candidate': 'PR', 'pr_wait': 'PR', 'qa': 'QA', 'ci': 'CI', 'promoting': 'DEV', 'dev_wait': 'DEV'}[name]
                if cur != exp: miss.append('stage %s!=%s' % (cur, exp))
            if name == 'blocked' and pg.locator('.steps li.fail').inner_text() != 'CI': miss.append('blocked stage')
            if name in ('qa', 'stale') and 'фиктив' in txt: miss.append('fake')
            if '%' in txt: miss.append('percent shown')
            if name in ('backlog', 'backlog_xss'):
                if pg.locator('#backlog img, #backlog script').count(): miss.append('XSS rendered')
                order = pg.evaluate("[...document.querySelectorAll('main#app > section')].map(e=>e.id)")
                if order.index('backlog') != order.index('now') + 1: miss.append('backlog not next to now')
            print('%dpx %-14s scrollW=%d clientW=%d %s %s' % (w, name, sw, cw, 'OK' if ok and not miss else 'FAIL', miss or wide or ''))
            if not (ok and not miss): bad.append((w, name))
            if name in ('qa', 'blocked', 'parked', 'stale', 'done_evidence', 'ci', 'stopped', 'backlog'):
                pg.screenshot(path='%s/%s_%d.png' % (shots, name, w), full_page=True)
        # missing snapshot => honest
        os.unlink(sp); pg.reload(); pg.wait_for_selector('#app:not([hidden])'); pg.wait_for_function("document.getElementById('fresh').textContent==='нет снимка'")
        assert 'Нет свежих данных' in pg.inner_text('#banner')
        # logout -> anonymous again
        pg.click('#logout'); pg.wait_for_selector('#login:not([hidden])')
        ctx.close()
    b.close()
print('FAILED:' if bad else 'ALL BROWSER CHECKS OK', bad or '')
sys.exit(1 if bad else 0)
