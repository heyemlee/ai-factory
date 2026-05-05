# CLAUDE.md

This file gives coding agents the current project map and safe commands for this repository.

## Commands

Run commands from the project root unless noted.

### Backend

```bash
python3 -m backend.core.cloud_controller          # process pending orders once
python3 -m backend.core.cloud_controller --poll   # poll Supabase continuously
bash scripts/start_cloud.sh                       # backend-only polling launcher
bash scripts/dev.sh                               # backend polling + frontend dev server
python3 -m compileall backend scripts/setup_schema.py
```

### Frontend

```bash
cd frontend
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

The frontend uses Next.js 16.2.3 and React 19. Prefer local project patterns over older Next.js assumptions.

## Runtime Flow

```
Dashboard / Supabase Storage
      │ upload order Excel, orders.status=pending
      ▼
backend.core.cloud_controller
      ├── cabinet_calculator.process_order()
      │     Excel rows → expanded cabinet parts
      ├── cutting.efficient.run_engine()
      │     default FFD + inventory-first / T0-start cutting
      ├── cutting.stack.run_engine()
      │     stack-efficiency strategy for repeated machine cuts
      └── writes cut_result_json, cabinet summary, BOM history back to Supabase
```

`backend.core.cloud_controller` is the only normal backend entry point. It chooses the cutting strategy from the order/upload settings:

- `efficient`: `backend/cutting/efficient/`
- `stack_efficiency`: `backend/cutting/stack/`

## Backend Structure

```
backend/
├── cabinet_calculator.py          # Excel order parser and cabinet part expansion
├── core/
│   └── cloud_controller.py        # Supabase polling, order claim, pipeline, write-back
├── cutting/
│   ├── cutting_engine.py          # compatibility facade for cutting.efficient
│   ├── stack_efficiency_engine.py # compatibility facade for cutting.stack
│   ├── t0_optimizer.py            # compatibility facade for cutting.t0
│   ├── efficient/
│   │   ├── constants.py
│   │   ├── primitives.py
│   │   ├── loaders.py
│   │   ├── demand.py
│   │   ├── packing.py
│   │   ├── validator.py
│   │   └── engine.py
│   ├── stack/
│   │   ├── constants.py
│   │   ├── primitives.py
│   │   ├── strips.py
│   │   ├── recovery.py
│   │   ├── t0_packer.py
│   │   ├── allocation.py
│   │   └── engine.py
│   └── t0/
│       ├── packer.py
│       ├── recovery.py
│       └── planner.py
├── config/
│   ├── board_config.json
│   ├── board_config_loader.py
│   ├── logger.py
│   ├── settings.py
│   └── supabase_client.py
└── tools/
    ├── email_reader.py
    └── telegram_notifier.py
```

`scripts/setup_schema.py` is the one-time Supabase schema utility. Keep migration/setup scripts in `scripts/`, not `backend/config/`.

## Cutting Notes

Board system:

- `T0`: raw sheet, 1219.2 × 2438.4 mm
- `T1`: strips cut from T0 or inventory
- `T2`: final cabinet parts

Dimension terms are intentional:

- `Height`: along the 2438.4 mm axis
- `Width`: along the 1219.2 mm axis

Efficient algorithm:

1. `load_parts()` reads expanded parts.
2. `build_strip_demand()` groups parts into strip demand.
3. `apply_inventory()` consumes matching inventory unless T0-start is forced.
4. `cutting.t0.optimize_t0_from_strips()` mixed-packs T0 sheets.
5. `recover_leftover()` creates recoverable T1 strips.
6. `ffd_strip_pack()` packs parts along each strip length.
7. `_validate_cut_result()` checks placement/integrity before write-back.

Stack algorithm:

1. Normalizes/rotates parts where valid.
2. Builds repeatable strip patterns and bundles max stack size 4.
3. Allocates matching T1 inventory or T0-derived strips.
4. Packs required T0 sheets and recovered strips.
5. Emits machine-friendly stack metadata.

## Import Policy

The backend currently supports the historical path style because `cloud_controller.py` inserts `backend/` into `sys.path`:

```python
from config.supabase_client import supabase
from cutting.efficient import run_engine
```

Do not reintroduce large monolithic algorithm files. Add new helper code under the relevant domain package:

- efficient FFD/inventory logic → `backend/cutting/efficient/`
- stack-cut logic → `backend/cutting/stack/`
- T0 mixed packing/recovery/planning → `backend/cutting/t0/`

The old `cutting_engine.py`, `stack_efficiency_engine.py`, and `t0_optimizer.py` files are small compatibility facades only.

## Frontend Structure

```
frontend/src/
├── app/                         # Next.js App Router pages and API routes
├── features/orders/detail/      # order detail factory UI and cut-plan components
├── components/                  # shared UI / layout / 3D cabinet viewer
└── lib/                         # Supabase client, i18n, order actions, shared data
```

Use `useLanguage()` for UI text and keep order-detail-specific components inside `features/orders/detail/`.
