"""Read-only, size-bounded product projection envelope; no model or queue writes."""
from pathlib import Path
import base64,gzip,json
PUBLIC=Path('/srv/gobadminton-product-backlog/state/public.json')

def attach(payload: bytes) -> bytes:
 try:
  if not PUBLIC.is_file() or PUBLIC.stat().st_size>2_000_000:return payload
  projection=json.loads(PUBLIC.read_text())
  if projection.get('project')!='GoBadminton' or projection.get('schema')!='gobadminton.product-backlog.v1' or not projection.get('tasks'):return payload
  raw=json.dumps(projection,ensure_ascii=False,separators=(',',':')).encode()
  if len(raw)>900_000:return payload
  encoded=base64.b64encode(gzip.compress(raw,compresslevel=6,mtime=0)).decode()
  if len(encoded)>200_000:return payload
  original=json.loads(payload)
  if not isinstance(original,dict):return payload
  original['product_backlog_gzip']={'encoding':'gzip-base64','data':encoded}
  result=json.dumps(original,ensure_ascii=False,separators=(',',':')).encode()
  return result if len(result)<1_950_000 else payload
 except (OSError,TypeError,ValueError):return payload
