from pathlib import Path
import sys

import uvicorn


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=9000, reload=False)
