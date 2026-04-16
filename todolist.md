# AI Factory Dashboard - Implementation Todo List

## Phase 1: Frontend Development (Next.js - Clean Apple Style)
- [x] 1. Initialize Next.js project in `frontend/` with Tailwind CSS, TypeScript, and App Router.
- [x] 2. Core Layout & Routing Setup: Set up global responsive layout, topbar, sidebar, and Login/User dropdown shell.
- [x] 3. Clean Apple Theme styling implemented (SF Pro fonts, shadow-apple, minimalism).
- [x] 4. Dashboard Homepage (`/`):
  - Current Inventory Status (BarChart) with low-stock Threshold alerts.
  - Active Orders & Performance metric cards.
- [x] 5. Order Management Center (`/orders`):
  - Overall Utilization metrics.
  - Historical orders list/table, routing to detailed layouts.
- [x] 6. Inventory Panel (`/inventory`):
  - Category tabs (Main/Sub/Aux) removing units for cleaner view.
  - Editable data table for stock levels, dimensions, and custom Threshold settings.
- [x] 7. BOM Analytics (`/bom-analytics`):
  - Historical consumption visualizations (USD formatted).
- [x] 8. Smart Cutting View (`/order/[id]`):
  - Crisp clean visualization for cut layouts from simulated pipeline outputs.
- [x] 9. Frontend Review: Test UI with mock data to ensure responsiveness and aesthetics.

## Phase 2: Database & Architecture Bridge (Supabase + Local OpenClaw)
*Note: Vercel serves the Frontend. Supabase acts as the Global State Database (Queue/Inventory). Local OpenClaw acts as the dedicated Heavy Computing Worker.*

- [ ] 1. **Setup Supabase Schema**:
  - Deploy standard tables: `orders` (Task Queue), `inventory` (Stock & Thresholds), `bom_history` (Historical stats).
- [ ] 2. **Vercel & Supabase Frontend Integration**:
  - Replace mock data `fetch` in UI with actual Supabase DB calls.
  - Modify `/inventory` to push threshold & stock edits to Supabase.
  - Modify `/orders` drag-drop upload to store Excel into Supabase Storage and mark item as `Pending` in DB.
- [ ] 3. **Refactor OpenClaw Core Scripts**:
  - Unify `cut_result.xlsx` and `worker_order.xlsx` down to one smart file (English naming).
  - Guarantee "Guillotine Cutting (一直线切断)" logic in Engine: Ensure the generated JSON output dictates strict edge-to-edge panel saw straight cuts, with exact kerf/trim data.

- [ ] 4. **Connect Local OpenClaw to Supabase**:
  - Create a Supabase listener/poller in `workflow_controller.py` to auto-fetch new `Pending` orders from Cloud.
  - Modify `engine_agent.py`: Hook `load_inventory()` to pull cutting bounds (1220x2440) and available stock directly from Supabase.
  - On pipeline completion: Push actual JSON dimensions, cut metrics, and `.xlsx` back up to Supabase to turn order `Completed`.

- [ ] 5. **Frontend Precise Detail View (View Layout Enhancement)**:
  - Inside `/order/[id]`, connect the "Details" tab to render a precise data table of every block's coordinates, size (WxH), and saw kerf loss, prioritizing raw data accuracy over just the 2D layout.

- [ ] 6. **E2E Validation**:
  - Run full cycle: *User hits "Upload" on Vercel -> OpenClaw factory PC kicks in -> OpenClaw updates DB -> Vercel UI turns green & shows accurate straight-cut 2D map + Detailed precise spec tables.*
