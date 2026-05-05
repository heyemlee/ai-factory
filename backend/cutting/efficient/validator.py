"""
Cut-result integrity validation.

Appends issues to output["issues"]["integrity"]; never raises.
"""

from .constants import BOARD_HEIGHT


def _validate_cut_result(output: dict, cabinet_breakdown: dict, total_parts_required: int, oversized_parts: list):
    """
    Append integrity issues to output["issues"]["integrity"]. Never raises.

    Checks:
      - PART_COUNT_MISMATCH     placed + oversized + unmatched != required
      - DUPLICATE_PART_ID       same part_id on multiple boards
      - INVALID_PART_DIM        Height <= 0 or Width <= 0
      - INVALID_BOARD_SIZE      board_size unparsable
      - T0_STRIP_OVERFLOW       t0_strip_position + strip_width > 1219.2
      - STRIP_LENGTH_OVERFLOW   trim + parts + kerf > usable_height
      - CABINET_PART_MISSING    expected part_id not rendered on any board
      - CABINET_PART_EXTRA      rendered part_id not in cabinet_breakdown
      - CABINET_DIM_MISMATCH    dims differ from breakdown (allow H↔W swap if auto_swapped)
      - CABINET_COUNT_MISMATCH  cab_id rendered count != breakdown count
    """
    import re
    issues = output.setdefault("issues", {})
    integrity: list = []

    boards = output.get("boards", [])

    # ── Part-level checks ──
    seen_ids: dict = {}
    rendered_by_cab: dict = {}
    rendered_by_id: dict = {}
    for b in boards:
        bid = b.get("board_id", "?")
        # board_size parsability
        bs = b.get("board_size", "")
        if not re.search(r"(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)", str(bs), re.IGNORECASE):
            integrity.append({
                "code": "INVALID_BOARD_SIZE",
                "severity": "warn",
                "msg": f"board_size unparsable on {bid}: {bs!r}",
                "ref": {"board_id": bid},
            })

        # T0 strip overflow
        tsp = b.get("t0_strip_position")
        sw = b.get("strip_width", 0) or 0
        if tsp is not None and (tsp + sw) > (1219.2 + 0.5):
            integrity.append({
                "code": "T0_STRIP_OVERFLOW",
                "severity": "error",
                "msg": f"{bid}: strip_position {tsp} + width {sw} exceeds T0 1219.2mm",
                "ref": {"board_id": bid, "t0_strip_position": tsp, "strip_width": sw},
            })

        # Strip length overflow
        tl = b.get("trim_loss", 0) or 0
        sk = b.get("saw_kerf", 0) or 0
        parts_sum = 0.0
        for p in b.get("parts", []):
            parts_sum += (p.get("cut_length") or p.get("Height") or 0)
        kerf_sum = max(0, (len(b.get("parts", [])) - 1)) * sk
        # tl is per-edge trim (5 or 0); both short edges are trimmed when tl > 0.
        usable_len = (b.get("usable_length") or 0) or (BOARD_HEIGHT - 2 * tl)
        used_len = parts_sum + kerf_sum
        if used_len > usable_len + 0.5:
            integrity.append({
                "code": "STRIP_LENGTH_OVERFLOW",
                "severity": "error",
                "msg": f"{bid}: parts+kerf = {used_len:.1f} exceeds usable {usable_len:.1f} (trim {tl:.1f}mm already excluded)",
                "ref": {"board_id": bid},
            })

        for p in b.get("parts", []):
            pid = p.get("part_id", "?")
            h = p.get("Height", 0) or 0
            w = p.get("Width", 0) or 0
            if h <= 0 or w <= 0:
                integrity.append({
                    "code": "INVALID_PART_DIM",
                    "severity": "error",
                    "msg": f"part {pid} on {bid}: Height={h}, Width={w}",
                    "ref": {"board_id": bid, "part_id": pid},
                })
            if pid in seen_ids:
                integrity.append({
                    "code": "DUPLICATE_PART_ID",
                    "severity": "error",
                    "msg": f"part_id {pid} appears on both {seen_ids[pid]} and {bid}",
                    "ref": {"part_id": pid, "boards": [seen_ids[pid], bid]},
                })
            else:
                seen_ids[pid] = bid
            rendered_by_id[pid] = {
                "Height": h, "Width": w,
                "auto_swapped": bool(p.get("auto_swapped") or p.get("rotated")),
                "cab_id": p.get("cab_id"),
            }
            cab = p.get("cab_id")
            if cab:
                rendered_by_cab.setdefault(cab, []).append(pid)

    # ── Part count conservation ──
    placed = sum(len(b.get("parts", [])) for b in boards)
    oversized_n = len(oversized_parts or [])
    unmatched_n = len(output.get("issues", {}).get("unmatched_parts", []))
    expected = total_parts_required + oversized_n
    actual = placed + oversized_n + unmatched_n
    if actual != expected:
        integrity.append({
            "code": "PART_COUNT_MISMATCH",
            "severity": "error",
            "msg": f"expected {expected} parts (required {total_parts_required} + oversized {oversized_n}), got placed {placed} + unmatched {unmatched_n} + oversized {oversized_n} = {actual}",
            "ref": {"placed": placed, "unmatched": unmatched_n, "oversized": oversized_n, "required": total_parts_required},
        })

    # ── Cabinet-level reconciliation ──
    if cabinet_breakdown:
        for cab_id, cb in cabinet_breakdown.items():
            expected_parts = {pp["part_id"]: pp for pp in cb.get("parts", [])}
            rendered_ids = set(rendered_by_cab.get(cab_id, []))
            missing = set(expected_parts.keys()) - rendered_ids
            extra = rendered_ids - set(expected_parts.keys())

            for pid in sorted(missing):
                # Skip if this part is in oversized_parts (legitimately not placed)
                if any(o.get("part_id") == pid for o in (oversized_parts or [])):
                    continue
                integrity.append({
                    "code": "CABINET_PART_MISSING",
                    "severity": "error",
                    "msg": f"cab {cab_id}: part {pid} expected but not rendered",
                    "ref": {"cab_id": cab_id, "part_id": pid},
                })
            for pid in sorted(extra):
                integrity.append({
                    "code": "CABINET_PART_EXTRA",
                    "severity": "warn",
                    "msg": f"cab {cab_id}: part {pid} rendered but not in cabinet_breakdown",
                    "ref": {"cab_id": cab_id, "part_id": pid},
                })

            # Count check
            if cb.get("count", 0) != len(rendered_ids) and not missing and not extra:
                integrity.append({
                    "code": "CABINET_COUNT_MISMATCH",
                    "severity": "warn",
                    "msg": f"cab {cab_id}: breakdown count {cb.get('count')} != rendered {len(rendered_ids)}",
                    "ref": {"cab_id": cab_id},
                })

            # Dim check:
            # cabinet reconciliation cares about the final panel size, not the
            # cutting orientation. If Height/Width are an exact swap, treat it
            # as the same physical part and do not flag an integrity error.
            for pid in rendered_ids & set(expected_parts.keys()):
                exp = expected_parts[pid]
                got = rendered_by_id.get(pid, {})
                if not got:
                    continue
                eh, ew = exp.get("Height", 0), exp.get("Width", 0)
                gh, gw = got.get("Height", 0), got.get("Width", 0)
                match_direct = abs(eh - gh) < 0.5 and abs(ew - gw) < 0.5
                match_swapped = abs(eh - gw) < 0.5 and abs(ew - gh) < 0.5
                if match_direct:
                    continue
                if match_swapped:
                    continue
                integrity.append({
                    "code": "CABINET_DIM_MISMATCH",
                    "severity": "error",
                    "msg": f"cab {cab_id} part {pid}: expected {eh}×{ew}, got {gh}×{gw}",
                    "ref": {"cab_id": cab_id, "part_id": pid,
                            "expected": {"Height": eh, "Width": ew},
                            "actual": {"Height": gh, "Width": gw,
                                       "auto_swapped": got.get("auto_swapped", False)}},
                })

    if integrity:
        issues["integrity"] = integrity
        print(f"\n⚠️  Integrity validator: {len(integrity)} issue(s) detected")
        # Print a short digest
        codes = {}
        for it in integrity:
            codes[it["code"]] = codes.get(it["code"], 0) + 1
        for c, n in codes.items():
            print(f"   • {c}: {n}")
