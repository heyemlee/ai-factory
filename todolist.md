# AI Factory Dashboard - Implementation Todo List

## Phase 1: Frontend Development (Next.js - Clean Apple Style)
- [x] 1. Initialize Next.js project in `frontend/` with Tailwind CSS, TypeScript, and App Router.
- [x] 2. Core Layout & Routing Setup: Set up global responsive layout, topbar, sidebar, and Login/User dropdown shell.
- [x] 3. Clean Apple Theme styling implemented (SF Pro fonts, shadow-apple, minimalism).
- [x] 4. Dashboard Homepage (`/`):
  - Current Inventory Status (BarChart) with low-stock Threshold alerts.
  - Updated to T0/T1-305/T1-610 board names and correct mm sizes.
- [x] 5. Order Management Center (`/orders`):
  - Overall Utilization metrics.
  - Historical orders list with Cabinets (W/B/T breakdown) and Boards columns.
- [x] 6. Inventory Panel (`/inventory`):
  - Category tabs (Main/Sub/Aux) removing units for cleaner view.
  - Editable data table with correct T0(1219.2×2438.4), T1-305(304.8×2438.4), T1-610(609.6×2438.4) stock.
- [x] 7. BOM Analytics (`/bom-analytics`):
  - Historical consumption visualizations (USD formatted).
- [x] 8. Smart Cutting View (`/order/[id]`):
  - Crisp clean visualization for cut layouts from simulated pipeline outputs.
- [x] 9. Frontend Review: Test UI with mock data, build passes all 8 routes.

## Phase 1.5: Backend Pipeline Refactor (Cabinet Calculator + Engine)
- [x] 1. **Cabinet Calculator v2** (`backend/cabinet_calculator.py`):
  - Batch order processing from Excel with `Type` column (wall/base/tall).
  - Imperial→mm conversion (×25.4), precision to 1 decimal.
  - Corrected construction: back panel +6mm groove, top/bottom no groove.
  - Base cabinet: no top panel, 2 stretchers (101.6mm). Tall: top+bottom, no stretchers.
  - Fixed shelf: no inset. Adjustable shelf: -20mm inset.
  - `cab_id` uses ABC Item code from order.
- [x] 2. **Engine Agent v3** (`backend/agents/engine_agent.py`):
  - Best-fit Depth matching (part Depth ≤ board Depth, smallest board wins).
  - Rotation support for oversized parts.
  - Carries cab_id/cab_type/component metadata through pipeline.
- [x] 3. **Inventory Data** (`data/t1_inventory.xlsx`):
  - T0: 1219.2 × 2438.4mm, T1-305: 304.8 × 2438.4mm, T1-610: 609.6 × 2438.4mm.
- [x] 4. **Full Pipeline Test**: 13 cabinets (10W/2B/1T) → 115 parts → 49 boards, 86.9% utilization, 0 unmatched. ✅

## Phase 2: Database & Architecture Bridge (Supabase + Local OpenClaw)
*Note: Vercel serves the Frontend. Supabase acts as the Global State Database (Queue/Inventory). Local OpenClaw acts as the dedicated Heavy Computing Worker.*

- [ ] 1. **Setup Supabase Schema**:
  - Deploy standard tables: `orders` (Task Queue), `inventory` (Stock & Thresholds), `bom_history` (Historical stats).
- [ ] 2. **Vercel & Supabase Frontend Integration**:
  - Replace mock data `fetch` in UI with actual Supabase DB calls.
  - Modify `/inventory` to push threshold & stock edits to Supabase.
  - Modify `/orders` drag-drop upload to store Excel into Supabase Storage and mark item as `Pending` in DB.
- [ ] 3. **Connect Local OpenClaw to Supabase**:
  - Create a Supabase listener/poller in `workflow_controller.py` to auto-fetch new `Pending` orders from Cloud.
  - Modify `engine_agent.py`: Hook `load_inventory()` to pull cutting bounds (1219.2×2438.4 / 304.8×2438.4 / 609.6×2438.4) and stock from Supabase.
  - On pipeline completion: Push cut_result JSON, metrics, and `.xlsx` back up to Supabase to turn order `Completed`.

- [ ] 4. **Frontend Precise Detail View (View Layout Enhancement)**:
  - Inside `/order/[id]`, connect the "Details" tab to render a precise data table of every block's coordinates, size (WxH), and saw kerf loss.

- [ ] 5. **E2E Validation**:
  - Run full cycle: *User hits "Upload" on Vercel -> OpenClaw factory PC kicks in -> OpenClaw updates DB -> Vercel UI turns green & shows accurate straight-cut 2D map + Detailed precise spec tables.*
