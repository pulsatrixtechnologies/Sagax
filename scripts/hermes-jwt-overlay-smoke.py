# Run with the Hermes venv interpreter inside the production image.
# hermes-agent 0.21.5 asks for PyJWT[crypto]==2.13.0; the image overlay
# installs 2.15.1 (API-compatible, patched). This proves that interpreter
# still imports Hermes and can encode/decode a JWT.
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

import jwt

jwt_version = version("PyJWT")
if jwt_version != "2.15.1":
    raise SystemExit(f"expected PyJWT 2.15.1 in the Hermes venv, got {jwt_version}")
if jwt.__version__ != "2.15.1":
    raise SystemExit(f"jwt.__version__ is {jwt.__version__}")

token = jwt.encode({"sub": "overlay-smoke"}, "ci-secret", algorithm="HS256")
payload = jwt.decode(token, "ci-secret", algorithms=["HS256"])
if payload.get("sub") != "overlay-smoke":
    raise SystemExit(f"jwt round-trip failed: {payload!r}")

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
print(f"ok jwt={jwt_version} hermes-agent={hermes_version} hermes --version={probe.stdout.strip() or probe.stderr.strip()}")
