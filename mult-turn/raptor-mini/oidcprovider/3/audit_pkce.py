import base64
import hashlib
import json
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = "http://127.0.0.1:4000"
CLIENT_ID = "test-client"
CLIENT_SECRET = "test-secret"
REDIRECT_URI = "http://localhost:8080/callback"
CODE_VERIFIER = "mysecureverifier123"
CODE_CHALLENGE = base64.urlsafe_b64encode(
    hashlib.sha256(CODE_VERIFIER.encode("utf-8")).digest()
).decode("utf-8").rstrip("=")

print("PKCE challenge:", CODE_CHALLENGE)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(NoRedirect())

# GET authorize
params = urllib.parse.urlencode({
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "response_type": "code",
    "scope": "openid profile",
    "state": "abc",
    "code_challenge": CODE_CHALLENGE,
    "code_challenge_method": "S256",
})
req = Request(f"{BASE}/oauth2/authorize?{params}", method="GET")
with opener.open(req) as resp:
    print("GET authorize status", resp.status)
    print("GET Content-Type", resp.getheader("Content-Type"))
    body = resp.read().decode("utf-8")
    print("challenge field", "name=\"code_challenge\"" in body)
    print("method field", "name=\"code_challenge_method\"" in body)

# POST authorize
post_data = urllib.parse.urlencode({
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "response_type": "code",
    "scope": "openid profile",
    "state": "abc",
    "username": "testuser",
    "password": "password123",
    "code_challenge": CODE_CHALLENGE,
    "code_challenge_method": "S256",
}).encode("utf-8")
req = Request(f"{BASE}/oauth2/authorize", data=post_data, method="POST")
try:
    resp = opener.open(req)
    print("POST authorize status", resp.status)
    print("POST authorize headers", resp.getheaders())
    resp.close()
except urllib.error.HTTPError as e:
    print("POST authorize status", e.code)
    location = e.headers.get("Location")
    print("Location", location)
    code = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)["code"][0]
    print("auth code", code)

# inspect db row
conn = sqlite3.connect("data/database.sqlite")
row = conn.execute(
    "select code, code_challenge, code_challenge_method, used, expires_at from auth_codes where code=?",
    (code,),
).fetchone()
conn.close()
print("auth code row", row)

# Exchange token
post_data = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": REDIRECT_URI,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "code_verifier": CODE_VERIFIER,
}).encode("utf-8")
req = Request(f"{BASE}/oauth2/token", data=post_data, method="POST")
with opener.open(req) as resp:
    print("POST token status", resp.status)
    print("token Content-Type", resp.getheader("Content-Type"))
    print("token Cache-Control", resp.getheader("Cache-Control"))
    token_body = resp.read().decode("utf-8")
    print("token body", token_body)
    token_data = json.loads(token_body)
    access_token = token_data["access_token"]
    id_token = token_data["id_token"]
    print("access len", len(access_token), "id len", len(id_token))

for label, verifier in [("wrong", "wrongverifier"), ("missing", None)]:
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }
    if verifier is not None:
        payload["code_verifier"] = verifier
    post_data = urllib.parse.urlencode(payload).encode("utf-8")
    req = Request(f"{BASE}/oauth2/token", data=post_data, method="POST")
    try:
        with opener.open(req) as resp:
            print(label, "unexpected status", resp.status)
    except urllib.error.HTTPError as e:
        print(label, "status", e.code)
        print(label, "body", e.read().decode("utf-8"))

# Reuse same code
try:
    post_data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code_verifier": CODE_VERIFIER,
    }).encode("utf-8")
    req = Request(f"{BASE}/oauth2/token", data=post_data, method="POST")
    with opener.open(req) as resp:
        print("reuse unexpected status", resp.status)
except urllib.error.HTTPError as e:
    print("reuse status", e.code)
    print("reuse body", e.read().decode("utf-8"))

# JWKS and id_token payload

def base64url_decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)

with opener.open(f"{BASE}/.well-known/jwks.json") as resp:
    jwks = json.loads(resp.read().decode("utf-8"))
    print("jwks keys", len(jwks.get("keys", [])))
    print("jwks kid", jwks["keys"][0].get("kid"))
header = json.loads(base64url_decode(id_token.split(".")[0]).decode("utf-8"))
payload = json.loads(base64url_decode(id_token.split(".")[1]).decode("utf-8"))
print("id token header kid", header.get("kid"), "alg", header.get("alg"))
print("id token payload sub", payload.get("sub"), "iss", payload.get("iss"))

req = Request(f"{BASE}/userinfo", method="GET")
req.add_header("Authorization", f"Bearer {access_token}")
with opener.open(req) as resp:
    print("userinfo status", resp.status)
    print("userinfo Content-Type", resp.getheader("Content-Type"))
    print("userinfo body", resp.read().decode("utf-8"))

conn = sqlite3.connect("data/database.sqlite")
row2 = conn.execute("select used, expires_at from auth_codes where code=?", (code,)).fetchone()
conn.close()
print("auth_code final used/expires_at", row2)
