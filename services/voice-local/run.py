"""Single-process startup. Use the Python runtime selected by the operator."""
import os
from pathlib import Path

import uvicorn

for name in (".env.local", ".env"):
    file = Path(__file__).parent / name
    if file.exists():
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))

if __name__ == "__main__":
    # No host/workers CLI override: MLX and reference data stay on this machine.
    uvicorn.run("server:create_app", factory=True, host="127.0.0.1", port=int(os.environ.get("VOICE_LOCAL_PORT", "8810")), workers=1)
