import os
import glob
import json
import shutil
from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Import the existing OpenClaw pipeline controller
from core.workflow_controller import run_pipeline
from config.settings import INCOMING_ORDERS_DIR, ARCHIVE_DIR, FAILED_ORDERS_DIR, INVENTORY_FILE

app = FastAPI(title="AI Factory OpenClaw API")

# Allow the local Next.js frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/stats")
def get_stats():
    """Reads basic stats from archive to display on frontend dashboard."""
    try:
        completed = len(glob.glob(str(ARCHIVE_DIR / "*.xlsx")))
        failed = len(glob.glob(str(FAILED_ORDERS_DIR / "*.txt")))
        return {"status": "success", "data": {"completed": completed, "failed": failed}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/upload")
async def upload_order(file: UploadFile = File(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    """Receives an Excel file from the Next.js frontend and triggers OpenClaw."""
    os.makedirs(INCOMING_ORDERS_DIR, exist_ok=True)
    
    file_path = os.path.join(INCOMING_ORDERS_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Trigger OpenClaw pipeline in background so frontend unblocks immediately
    background_tasks.add_task(run_pipeline, file_path)
    
    return {
        "status": "success", 
        "message": "File uploaded successfully. OpenClaw Pipeline triggered in the background.", 
        "file": file.filename
    }

@app.get("/api/inventory")
def get_inventory():
    """Reads current local JSON inventory for the UI."""
    if os.path.exists(INVENTORY_FILE):
        with open(INVENTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"status": "success", "data": data}
    return {"status": "error", "message": "Inventory file not found locally"}

@app.get("/api/orders/history")
def get_order_history():
    """Get all processed logic stats for the history table from the output JSONs."""
    # This is a stub that should read through output directory cut_result.json files
    return {"status": "success", "data": []}

@app.get("/api/bom-history")
def get_bom_history():
    """Returns BOM history."""
    history_file = "data/bom_history.jsonl"
    if os.path.exists(history_file):
        history = []
        with open(history_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    history.append(json.loads(line))
        return {"status": "success", "data": history}
    return {"status": "success", "data": []}

if __name__ == "__main__":
    print("🚀 Starting Local OpenClaw FastAPI Server on port 8000...")
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=True)
