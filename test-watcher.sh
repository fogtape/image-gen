#!/bin/sh
set -eu
cd /data/data/com.termux/files/home/image-gen
/usr/bin/node server.js >/tmp/image-gen-watch.log 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
sleep 3
echo '== before edit raw =='
curl -s http://127.0.0.1:3000/api/config/runtime > /tmp/runtime-before.json
head -c 500 /tmp/runtime-before.json && echo
python3 - <<'PY'
import json
obj=json.load(open('/tmp/runtime-before.json'))
print('before_apiUrl=', obj['runtime']['providerDefaults']['apiUrl'])
print('before_streamMode=', obj['runtime']['providerDefaults']['streamMode'])
print('before_storage=', obj['runtime']['storage']['enabled'])
PY
python3 - <<'PY'
from pathlib import Path
p=Path('config/.env')
text=p.read_text()
text=text.replace('IMAGE_GEN_DEFAULT_API_URL="https://example.invalid"','IMAGE_GEN_DEFAULT_API_URL="https://watcher.example"')
text=text.replace('IMAGE_GEN_DEFAULT_STREAM_MODE=true','IMAGE_GEN_DEFAULT_STREAM_MODE=false')
text=text.replace('IMAGE_GEN_STORAGE_ENABLED=false','IMAGE_GEN_STORAGE_ENABLED=true')
p.write_text(text)
print('edited .env')
PY
sleep 2
echo '== after edit raw =='
curl -s http://127.0.0.1:3000/api/config/runtime > /tmp/runtime-after.json
head -c 500 /tmp/runtime-after.json && echo
python3 - <<'PY'
import json
obj=json.load(open('/tmp/runtime-after.json'))
print('after_apiUrl=', obj['runtime']['providerDefaults']['apiUrl'])
print('after_streamMode=', obj['runtime']['providerDefaults']['streamMode'])
print('after_storage=', obj['runtime']['storage']['enabled'])
PY
echo '== watcher log =='
sed -n '1,80p' /tmp/image-gen-watch.log
