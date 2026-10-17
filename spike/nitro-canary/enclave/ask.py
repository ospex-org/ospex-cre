"""Parent-side client: asks the enclave for one attestation and one signed score.

usage: python3 ask.py <enclave-cid> <request-json-file> <out-file>
Writes the enclave's one-line JSON answer to <out-file> and prints the time it took.
"""
import json
import socket
import sys
import time

cid, req_file, out_file = int(sys.argv[1]), sys.argv[2], sys.argv[3]
req = json.load(open(req_file))
t0 = time.time()
s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
s.settimeout(60)
s.connect((cid, 5005))
s.sendall((json.dumps(req) + "\n").encode())
buf = b""
while not buf.endswith(b"\n"):
    chunk = s.recv(65536)
    if not chunk:
        break
    buf += chunk
s.close()
ans = json.loads(buf)
if "error" in ans:
    sys.exit("enclave error: " + ans["error"])
ans["askedAt"] = t0
ans["seconds"] = round(time.time() - t0, 3)
json.dump(ans, open(out_file, "w"))
print(json.dumps({k: ans[k] for k in ("variant", "signer", "seconds")}))
