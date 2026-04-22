# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend

Run from the project root with the virtualenv active:

```bash
source venv/bin/activate

# Start production backend (poll Supabase every 30s)
bash scripts/start_cloud.sh

# Start backend + frontend together
bash scripts/dev.sh
```

### Frontend

```bash
cd frontend
npm run dev      # dev server at http://localhost:3000
npm run build
npm run lint
```

> **Warning:** The frontend uses Next.js 16.2.3 with React 19 — APIs and file conventions may differ from training data. Read `node_modules/next/dist/docs/` before writing frontend code. (See `frontend/AGENTS.md`.)

## Architecture

### Production flow

```
Dashboard (Vercel)
      │  upload order Excel → Supabase Storage, status=pending
      ▼
   Supabase
      │  poll every 30s
      ▼
cloud_controller.py  (backend/core/)
      ├── cabinet_calculator.py   — parse Excel, expand cabinets → parts
      ├── engine_agent.py         — FFD bin-packing cut optimization
      │     └── t0_optimizer.py  — T0 sheet mix-pack
      └── write results → Supabase (orders, bom_history tables)
```

`cloud_controller.py` is the sole backend entry point. It handles everything directly: Supabase polling, order download, pipeline execution, and result write-back. It does **not** use `settings.py` — it constructs paths manually.

### Cutting algorithm (engine_agent.py + t0_optimizer.py)

1. `build_strip_demand()` — group parts by Width into T1 strip demand (±0.5mm tolerance)
2. `apply_inventory()` — deduct from T1 stock; remainder goes to T0 pool
3. `optimize_t0_from_strips()` — FFD mix-pack strips onto T0 sheets
4. Gap-fill — pull narrow strips from inventory to fill T0 gaps
5. `recover_leftover()` — reclaim T0 offcuts as T1 strips (≥609.6 wide, ≥304.8 narrow, ≥200 pull-rail)
6. `ffd_strip_pack()` — FFD-pack parts within each strip along the Height axis

Oversized parts (Width > 1219.2mm or Height > 2433.4mm) are flagged in `issues.oversized_parts`, not blocked.

### Board type system

```
T0  Raw sheet  1219.2 × 2438.4 mm (48″ × 96″)
 ↓ cut along width axis
T1  Strip      304.8 mm (12″) or 609.6 mm (24″) wide
 ↓ cut along height axis
T2  Part       final cabinet panel
```

Terminology: always **Height** (along 2438.4mm axis) and **Width** (along 1219.2mm axis).

### Key constants

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `PANEL_THICKNESS` | 18 mm | Board thickness |
| `TRIM_LOSS` | 5 mm | Edge trim loss |
| `SAW_KERF` | 5 mm | Saw kerf per cut |
| `BOARD_HEIGHT` | 2438.4 mm | T0 sheet length |
| `STRIP_WIDTH_NARROW` | 304.8 mm | 12″ strip |
| `STRIP_WIDTH_WIDE` | 609.6 mm | 24″ strip |

### Supabase tables

| Table | Purpose |
|-------|---------|
| `orders` | Order queue — `status`: pending → processing → completed / failed |
| `inventory` | Board stock (board_type, stock, threshold) |
| `cutting_stats` | Per-part cut records |
| `bom_history` | Aggregated usage per job |
| `order-files` | Storage bucket for uploaded Excel files |

### Frontend structure (frontend/src/)

- `app/` — App Router pages: dashboard, orders list, order detail (`order/[id]`), inventory, cut-stats, bom-analytics, login
- `components/CabinetViewer.tsx` — Three.js 3D cabinet renderer (dynamically imported, SSR disabled)
- `components/layout/` — Shell, Sidebar, Topbar
- `lib/i18n.tsx` — Client-side i18n for `en` / `zh` / `es`; use `useLanguage()` hook for all UI strings
- `lib/supabase.ts` — Supabase JS client
- `lib/order_actions.ts` — `revertCut()` and other order mutations

### Configuration (backend/config/settings.py)

Loads from `.env` at project root. Contains:
- Telegram / Email credentials
- Factory params (`PANEL_THICKNESS`, `TRIM_LOSS`, `SAW_KERF`)
- `INVENTORY_FILE` → `data/t1_inventory.xlsx` (still used by cloud_controller)

### Available but not yet wired in

- `backend/agents/notifier_agent.py` + `backend/tools/telegram_notifier.py` — Telegram push notifications, kept for future integration into cloud_controller
- `backend/tools/email_reader.py` — Gmail IMAP order intake, kept for future use
