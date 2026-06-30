"""Deploy mfj-merch-orders Worker via Cloudflare REST API.

Workaround for Windows ARM64 where wrangler/workerd has no native binary.
Reads MFJ_CLOUDFLARE_API_TOKEN from env. Bindings/vars come from wrangler.merch.toml;
secrets are preserved via 'inherit'.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT_ID = "f5af5b92e5434fcbf9234cf922778f07"
SCRIPT_NAME = "mfj-merch-orders"
WORKER_DIR = Path(__file__).resolve().parent.parent
MAIN_MODULE = "merch-order-worker.js"
EXTRA_MODULES = ["merch-catalog.js"]

token = os.environ.get("MFJ_CLOUDFLARE_API_TOKEN")
if not token:
    sys.exit("MFJ_CLOUDFLARE_API_TOKEN not set")

plain_vars = {
    "SITE_URL": "https://marchforjesus.ie",
    "PROFILE_NAME": "mfj-dublin-merch",
    "MICROSOFT_PROFILE_NAME": "mfj-dublin-merch",
    "MICROSOFT_TENANT_DOMAIN": "allnations.ie",
    "MICROSOFT_GRAPH_TENANT_ID": "ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3",
    "MICROSOFT_GRAPH_SITE_ID": "allnationschurchdub.sharepoint.com,903073eb-ef59-4b83-98d5-9b60617b02d3,cea9f057-7036-4b9d-b068-5fbea158e064",
    "MICROSOFT_GRAPH_LIST_ID": "ad2bcfae-77ca-47fb-b6a0-abb88bb4877c",
    "MERCH_CONFIRMATION_SENDER": "information@marchforjesus.ie",
    "STRIPE_KEY_MODE": "live",
}
secret_names = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "MICROSOFT_GRAPH_CLIENT_ID",
    "MICROSOFT_GRAPH_CLIENT_SECRET",
    "ADMIN_API_TOKEN",
]

bindings = [{"type": "plain_text", "name": k, "text": v} for k, v in plain_vars.items()]
bindings.append({"type": "d1", "name": "MERCH_DB", "id": "dcaaac7c-72da-46fa-a46a-553929bad39f"})
bindings.extend({"type": "inherit", "name": n, "old_name": n} for n in secret_names)

metadata = {
    "main_module": MAIN_MODULE,
    "compatibility_date": "2024-01-01",
    "bindings": bindings,
    "keep_assets": True,
}

boundary = "----DeployMfjMerchBoundary"
parts = []

def add_part(name, content, filename, content_type):
    headers = (
        f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    )
    parts.append(b"--" + boundary.encode() + b"\r\n" + headers.encode() + content + b"\r\n")

add_part("metadata", json.dumps(metadata).encode(), "metadata.json", "application/json")
add_part(MAIN_MODULE, (WORKER_DIR / MAIN_MODULE).read_bytes(), MAIN_MODULE, "application/javascript+module")
for mod in EXTRA_MODULES:
    add_part(mod, (WORKER_DIR / mod).read_bytes(), mod, "application/javascript+module")

body = b"".join(parts) + b"--" + boundary.encode() + b"--\r\n"

url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}"
req = urllib.request.Request(
    url,
    data=body,
    method="PUT",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    },
)
try:
    with urllib.request.urlopen(req) as resp:
        print("HTTP", resp.status)
        print(resp.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP ERROR", e.code)
    print(e.read().decode())
    sys.exit(1)
