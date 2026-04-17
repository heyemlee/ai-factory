"""
Shared Supabase Python client.
Used by all backend scripts to connect to the cloud database.
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load .env from project root
_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
load_dotenv(_env_path)

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file. "
        f"Looked at: {_env_path}"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
