"""
Standalone script to initialize traffic_twin.db.

Run once:
    python database/init_db.py

This creates tables and inserts seed events if the DB does not exist.
Safe to run multiple times — skips seed if data already present.
"""

import sys
from pathlib import Path

# Allow imports from the project root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.db import initialize_db, DB_PATH

if __name__ == "__main__":
    print(f"Database path: {DB_PATH}")
    initialize_db()
    print("Done.")
