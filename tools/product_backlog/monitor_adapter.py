#!/usr/bin/env python3
"""Prepare exact read-only monitor adapters. Never changes command/ingest handlers."""
import argparse, hashlib
from pathlib import Path

SERVER_BASE='4f87ee84a507767aad15bb50c48ea117bcfe8527f88e85732c6a9e710dad8047'
HTML_BASE='388fce7ca5e0a0a5d4545a19d3c47eabc4b6e4325c3ca611038dc5436eac6880'
ROUTES='''        # Product requirements are a separate READ-ONLY projection, not commands.
        if path in ("/backlog", "/backlog/", "/backlog/index.html",
                    "/backlog/style.css", "/backlog/app.js", "/backlog/workflow.html"):
            if path == "/backlog":
                self.send_response(302)
                self.send_header("Location", "./backlog/")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            allowed = {
                "/backlog/": ("index.html", "text/html; charset=utf-8"),
                "/backlog/index.html": ("index.html", "text/html; charset=utf-8"),
                "/backlog/style.css": ("style.css", "text/css; charset=utf-8"),
                "/backlog/app.js": ("app.js", "application/javascript; charset=utf-8"),
                "/backlog/workflow.html": ("workflow.html", "text/html; charset=utf-8"),
            }
            filename, ctype = allowed[path]
            try:
                body = (DASHBOARD_FILE.parent / "product-backlog" / filename).read_bytes()
            except OSError:
                return self.send_json(503, {"ok": False, "error": "product_backlog_assets_unavailable"})
            return self.send_body(200, body, ctype)

        if path == "/api/product-backlog":
            snapshot = read_json(STATUS_FILE, {}) or {}
            projection = snapshot.get("product_backlog")
            envelope = snapshot.get("product_backlog_gzip")
            if projection is None and isinstance(envelope, dict):
                try:
                    import base64, zlib
                    encoded = envelope.get("data", "")
                    if envelope.get("encoding") != "gzip-base64" or not isinstance(encoded, str) or len(encoded) > 200000:
                        raise ValueError("Invalid product envelope")
                    compressed = base64.b64decode(encoded, validate=True)
                    stream = zlib.decompressobj(16 + zlib.MAX_WBITS)
                    raw = stream.decompress(compressed, 900001)
                    if len(raw) > 900000 or not stream.eof or stream.unused_data:
                        raise ValueError("Oversized or incomplete product envelope")
                    projection = json.loads(raw)
                except (ValueError, TypeError, zlib.error):
                    projection = None
            if (not isinstance(projection, dict)
                    or projection.get("project") != "GoBadminton"
                    or projection.get("schema") != "gobadminton.product-backlog.v1"
                    or not isinstance(projection.get("tasks"), list)
                    or not projection.get("tasks")):
                # Never fabricate an empty registry when the source is absent.
                return self.send_json(503, {"ok": False, "error": "product_backlog_not_synced"})
            return self.send_json(200, projection)

'''
NAV='''<nav id="gb-product-nav" aria-label="Продуктовый контроль" style="max-width:1440px;margin:14px auto 0;padding:14px 20px;border:1px solid #344555;border-radius:14px;background:#14291f;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;color:#dff5e8">
<div><a href="./backlog/" style="color:#b7f4cd;font-size:18px;font-weight:700;text-decoration:none">Продуктовый бэклог →</a><div id="gb-product-summary" style="font-size:13px;color:#b7c9bf;margin-top:4px">Постоянные GB-номера · код / публикация / приёмка Owner</div></div><a href="./backlog/workflow.html" style="color:#c7dfd0;font-size:14px">Регламент работы</a></nav>'''
SCRIPT='''<script>
// A simple HTTP read; no model calls and no updates to task/queue state.
(()=>{const el=document.getElementById('gb-product-summary');if(!el)return;
async function readProductSummary(){try{const response=await fetch('./api/product-backlog',{cache:'no-store'});if(!response.ok)throw new Error('not synced');const p=await response.json();if(p.project!=='GoBadminton'||!Array.isArray(p.tasks))throw new Error('invalid');
const accepted=p.tasks.filter(t=>t.status==='confirmed').length;const pending=p.tasks.filter(t=>['owner_review','deployed'].includes(t.status)).length;
const age=Date.now()-Date.parse(p.synced_at);el.textContent=p.tasks.length+' постоянных задач · '+pending+' ждут проверки · '+accepted+' приняты Owner'+(age>600000?' · сохранённая копия устарела':'');
}catch{el.textContent='Постоянные задачи сохранены в GitHub · копия временно недоступна';}}
readProductSummary();setInterval(()=>{if(!document.hidden)readProductSummary();},60000);})();
</script>'''

def sha(data):return hashlib.sha256(data).hexdigest()
def prepare(root,out):
 root=Path(root);out=Path(out);out.mkdir(parents=True,exist_ok=True)
 old_server=(root/'server.py').read_bytes();old_html=(root/'dashboard.html').read_bytes()
 if sha(old_server)!=SERVER_BASE or sha(old_html)!=HTML_BASE:raise ValueError('Monitor baseline changed: inspect current source before patching')
 source=old_server.decode();html=old_html.decode()
 needle='        if path=="/health":\n'
 if source.count(needle)!=1:raise ValueError('Unexpected route anchor')
 after=source.replace(needle,ROUTES+needle)
 # No changes at all to mutation handlers or operational authorization.
 assert after.split('    def do_POST(self):',1)[1]==source.split('    def do_POST(self):',1)[1]
 compile(after,'server.py','exec')
 if html.count('<body>')!=1 or html.count('</body>')!=1:raise ValueError('Unexpected HTML anchors')
 updated=html.replace('<body>','<body>\n'+NAV,1).replace('</body>',SCRIPT+'\n</body>',1)
 (out/'server.py').write_text(after);(out/'dashboard.html').write_text(updated)
 print('PREPARED_READONLY_ADAPTER','server',sha(after.encode()),'dashboard',sha(updated.encode()))

def patch_push(source,out):
 source=Path(source);old=source.read_text()
 if 'product_backlog_snapshot' in old:raise ValueError('Already patched: inspect version')
 needle='        json.loads(payload)\n'
 if old.count(needle)!=1:raise ValueError('Unexpected push sender structure')
 new=old.replace(needle,needle+'        # Append validated product projection; no queue/model side effects.\n        from product_backlog_snapshot import attach\n        payload=attach(payload)\n',1)
 compile(new,'monitor_push.py','exec');Path(out).write_text(new)
 print('PREPARED_PUSH_ADAPTER',sha(old.encode()),sha(new.encode()))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path);p.add_argument('--out',type=Path,required=True);p.add_argument('--push',type=Path);a=p.parse_args()
 if a.push:patch_push(a.push,a.out)
 elif a.root:prepare(a.root,a.out)
 else:p.error('--root or --push required')
