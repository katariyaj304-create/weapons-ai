"""
Uvicorn launcher for the FastAPI backend.
"""
import sys

# Windows consoles default to cp1252 — unicode symbols in pipeline logs (✓/✗/⟐)
# would otherwise raise UnicodeEncodeError inside the generation threads.
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )
