# Run with the Hermes venv interpreter inside the production image.
#
# hermes-agent 0.21.5 (source archive v2026.9.24) asks for
# PyJWT[crypto]==2.13.0; the image overlay installs 2.15.1 (API-compatible,
# patched). This script proves that interpreter:
#   1. still imports Hermes at 0.21.x
#   2. can RS256-encode/decode a JWT (the [crypto] extra: cryptography)
#   3. can call Hermes' own JWT verifier with that token
#
# Hermes JWT call sites searched in v2026.9.24 (not invented):
#   plugins/cron_providers/chronos/verify.py  verify_nas_fire_token
#     (RS256/ES256 verify, inline PEM; used below)
#   tools/skills_hub_github.py  GitHubAuth._try_github_app
#     (jwt.encode RS256, then POST to api.github.com — not called here)
#   plugins/dashboard_auth/_shared.py  verify_jwt (needs a live JWKS URL)
#   tools/skills_sync_client.py  jwt.decode(..., verify_signature=False)
#     (unverified payload only; does not exercise [crypto])
import subprocess
import sys
import time
from importlib.metadata import version
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

jwt_version = version("PyJWT")
if jwt_version != "2.15.1":
    raise SystemExit(f"expected PyJWT 2.15.1 in the Hermes venv, got {jwt_version}")
if jwt.__version__ != "2.15.1":
    raise SystemExit(f"jwt.__version__ is {jwt.__version__}")

try:
    import cryptography as cryptography_mod
except ImportError as exc:
    raise SystemExit("PyJWT[crypto] extra missing: cryptography is not importable") from exc

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
priv_pem = key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
).decode()
pub_pem = key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode()

now = int(time.time())
claims = {
    "sub": "overlay-smoke",
    "aud": "sagax-overlay-smoke",
    "iss": "https://overlay.example.test",
    "purpose": "cron_fire",
    "iat": now,
    "nbf": now - 5,
    "exp": now + 300,
}
token = jwt.encode(claims, priv_pem, algorithm="RS256")
roundtrip = jwt.decode(
    token,
    pub_pem,
    algorithms=["RS256"],
    audience="sagax-overlay-smoke",
    issuer="https://overlay.example.test",
)
if roundtrip.get("sub") != "overlay-smoke":
    raise SystemExit(f"RS256 round-trip failed: {roundtrip!r}")

from plugins.cron_providers.chronos.verify import verify_nas_fire_token

verified = verify_nas_fire_token(
    token=token,
    expected_audience="sagax-overlay-smoke",
    jwks_or_key=pub_pem,
    issuer="https://overlay.example.test",
)
if verified is None or verified.get("sub") != "overlay-smoke" or verified.get("purpose") != "cron_fire":
    raise SystemExit(f"Hermes verify_nas_fire_token failed: {verified!r}")

rejected = verify_nas_fire_token(
    token=token,
    expected_audience="someone-else",
    jwks_or_key=pub_pem,
    issuer="https://overlay.example.test",
)
if rejected is not None:
    raise SystemExit(f"Hermes verify_nas_fire_token accepted a wrong audience: {rejected!r}")

header, payload, signature = token.split(".")
sig_bytes = bytearray(jwt.utils.base64url_decode(signature))
sig_bytes[0] ^= 0x01
tampered = f"{header}.{payload}.{jwt.utils.base64url_encode(bytes(sig_bytes)).decode()}"
if verify_nas_fire_token(
    token=tampered,
    expected_audience="sagax-overlay-smoke",
    jwks_or_key=pub_pem,
    issuer="https://overlay.example.test",
) is not None:
    raise SystemExit("Hermes verify_nas_fire_token accepted a tampered RS256 signature")

other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
other_priv = other_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
).decode()
wrong_key_token = jwt.encode(claims, other_priv, algorithm="RS256")
if verify_nas_fire_token(
    token=wrong_key_token,
    expected_audience="sagax-overlay-smoke",
    jwks_or_key=pub_pem,
    issuer="https://overlay.example.test",
) is not None:
    raise SystemExit("Hermes verify_nas_fire_token accepted a token signed by a second RSA key")

hermes_version = version("hermes-agent")
if not hermes_version.startswith("0.21"):
    raise SystemExit(f"expected hermes-agent 0.21.x, got {hermes_version}")

hermes = Path(sys.executable).with_name("hermes")
probe = subprocess.run(
    [str(hermes), "--version"],
    check=True,
    capture_output=True,
    text=True,
)
print(
    "ok jwt="
    f"{jwt_version} cryptography={cryptography_mod.__version__} "
    f"hermes-agent={hermes_version} alg=RS256 hermes-verify=chronos "
    f"hermes --version={probe.stdout.strip() or probe.stderr.strip()}"
)
