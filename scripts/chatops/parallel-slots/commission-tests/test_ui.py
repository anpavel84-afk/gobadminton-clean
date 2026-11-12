"""Offline rendering of the actual ES5 app.js when a Node executable is unavailable."""
import ctypes
import ctypes.util
import json
from pathlib import Path
import unittest

LIBRARY = ctypes.util.find_library('duktape')
SOURCE = (Path(__file__).resolve().parents[1] / 'monitor-src/app.js').read_text()
DOM = r"""
function Element(tag) { this.tagName=tag; this.children=[]; this.style={}; this._text=''; }
Element.prototype.appendChild=function(n) { this.children.push(n); n.parentNode=this; return n; };
Element.prototype.removeChild=function(n) { this.children.splice(this.children.indexOf(n),1); };
Element.prototype.addEventListener=function() {};
Object.defineProperty(Element.prototype,'firstChild',{get:function(){return this.children[0] || null;}});
Object.defineProperty(Element.prototype,'textContent',{
 get:function(){return this._text+this.children.map(function(n){return n.textContent;}).join(' ');},
 set:function(v){this._text=String(v);this.children=[];}
});
var ids={};
['now','backlog','infra','paused','next','done','doneall','outside','fresh','banner','pipeline',
 'updated','pinform','logout','login','app'].forEach(function(id){ids[id]=new Element('section');});
var Node=Element;
var document={hidden:false,getElementById:function(id){return ids[id] || null;},
 createElement:function(tag){return new Element(tag);},createTextNode:function(t){var n=new Element('#text');n.textContent=t;return n;},
 addEventListener:function(){}};
function setTimeout(){return 1;}
function clearTimeout(){}
// Only delivery timing is synchronous; the real poll/render/DOM code executes unchanged.
function resolved(value) {return {then:function(f){return resolved(f(value));},'catch':function(){return this;}};}
function fetch(){return resolved({status:200,json:function(){return snapshot;}});}
function flatten(n) { var all=[n];n.children.forEach(function(c){all=all.concat(flatten(c));});return all; }
"""


@unittest.skipUnless(LIBRARY, 'local libduktape unavailable; use the supplied Node UI fixtures')
class BrowserRendering(unittest.TestCase):
    def render(self, **extra):
        snapshot = dict(available=True, stale=False, age_s=16, source_ok=True, source_mode='legacy',
                        server_utc='2026-10-21T15:35:00Z', changed_utc='2026-10-21T12:35:00Z',
                        executor=dict(running=True), pipeline=dict(available=True, runs=[]))
        snapshot.update(extra)
        script = ('var snapshot=' + json.dumps(snapshot) + ';\n' + DOM + SOURCE + r"""
JSON.stringify({text:ids.now.textContent,fresh:ids.fresh.textContent,
 bars:flatten(ids.now).filter(function(n){return n.className==='steps';}).map(function(bar){
 return bar.children.map(function(n){return {label:n.textContent,state:n.className || ''};});})});
""")
        lib = ctypes.CDLL(LIBRARY)
        lib.duk_create_heap.argtypes = [ctypes.c_void_p]*5
        lib.duk_create_heap.restype = ctypes.c_void_p
        lib.duk_get_global_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        lib.duk_push_lstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
        lib.duk_pcall.argtypes = [ctypes.c_void_p, ctypes.c_int]
        lib.duk_safe_to_lstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
        lib.duk_safe_to_lstring.restype = ctypes.c_char_p
        lib.duk_destroy_heap.argtypes = [ctypes.c_void_p]
        context = lib.duk_create_heap(None, None, None, None, None)
        self.assertTrue(context)
        try:
            lib.duk_get_global_string(context, b'eval')
            raw = script.encode()
            lib.duk_push_lstring(context, raw, len(raw))
            result = lib.duk_pcall(context, 1)
            output = lib.duk_safe_to_lstring(context, -1, None).decode()
            self.assertEqual(result, 0, output)
            return json.loads(output)
        finally:
            lib.duk_destroy_heap(context)

    def test_legacy_completed_active_and_idle(self):
        done = self.render(claim=dict(issue=147, phase='done', attempt=3, max_attempts=3))
        self.assertIn('Активной задачи нет', done['text'])
        self.assertNotIn('Сейчас выполняется', done['text'])
        self.assertIn('Снимок обновлён', done['fresh'])
        active = self.render(claim=dict(issue=151, phase='developing', attempt=1, max_attempts=3))
        self.assertIn('Сейчас выполняется', active['text'])
        self.assertIn('Исполнитель свободен', self.render(claim=None)['text'])

    def test_slot_ci_blocked_idle_stale_and_done(self):
        def slot(claim=None, status='FRESH'):
            return self.render(source_mode='slots', slots=[dict(slot='slot1', status=status,
                process=dict(active='active', sub='running', pid=123), claim=claim)])
        ci = slot(dict(issue=151, phase='ci', qa=dict(verdict='PASS'),
                       ci=dict(result='PASS', passed=7, total=7, sha='a'*40)))
        self.assertIn('PASS · 7/7', ci['text'])
        self.assertEqual(len(ci['bars'][0]), 7)
        self.assertEqual([s['state'] for s in ci['bars'][0]], ['done']*4+['cur','',''])
        blocked = slot(dict(issue=151, phase='blocked', resume_phase='ci'))
        self.assertEqual(blocked['bars'][0][4]['state'], 'fail')
        self.assertIn('Исполнитель запущен; активной задачи нет', slot()['text'])
        self.assertIn('последнее наблюдение', slot(status='STALE')['text'])
        self.assertNotIn('Исполнитель запущен; активной задачи нет', slot(status='STALE')['text'])
        self.assertIn('Последний завершённый результат', slot(dict(issue=147, phase='done'))['text'])

    def test_integrating_uses_seven_stages_without_new_qa_ci_pass(self):
        result = self.render(source_mode='slots', slots=[dict(slot='slot1', status='FRESH',
            claim=dict(issue=151, phase='integrating', qa=dict(verdict=None, reviewed_sha=None), ci=None))])
        self.assertIn('интеграция с текущим DEV', result['text'])
        self.assertIn('новые QA и CI ожидаются', result['text'])
        self.assertNotIn('PASS', result['text'])
        self.assertEqual([s['label'] for s in result['bars'][0]], ['Задача','Код','PR','QA','CI','DEV','Принято'])
        self.assertEqual([s['state'] for s in result['bars'][0]], ['done','done','cur','','','',''])


if __name__ == '__main__':
    unittest.main()
