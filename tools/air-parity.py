#!/usr/bin/env python3
"""Compare compact website air tuples against the pinned native Python decoder."""
import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import struct
import sys

EXPECTED_DECODER_SHA256 = "a75687cd39ec6b51aee bd7651e385b53be7657ef2cc00b5c8f73e2e9bcc70583".replace(" ", "")
BASE_KEYS = ("startMs", "endMs", "kind", "laneStart", "laneEnd")
TIMELINE_KEYS = (*BASE_KEYS, "airVersion", "airCoordinates")


def f32(value):
    try:
        result = struct.unpack("<f", struct.pack("<f", float(value)))[0]
    except (OverflowError, TypeError, ValueError, struct.error):
        raise ValueError("not-float32") from None
    return 0.0 if result == 0.0 else result


def valid_source(row):
    guid, lookup = row.get("guid"), row.get("lookupPath")
    if not isinstance(guid, str) or re.fullmatch(r"[a-f0-9]{32}", guid) is None:
        raise ValueError("source-guid")
    if not isinstance(lookup, str) or not lookup or "\x00" in lookup:
        raise ValueError("source-path")
    windows_path = pathlib.PureWindowsPath(lookup)
    posix_path = pathlib.PurePosixPath(lookup)
    if windows_path.is_absolute() or posix_path.is_absolute() or any(part == ".." for part in re.split(r"[/\\]+", lookup)):
        raise ValueError("source-path")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--game-root", required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    decoder_path = root / "tools" / "infalsus_spc_decode.py"
    if hashlib.sha256(decoder_path.read_bytes()).hexdigest() != EXPECTED_DECODER_SHA256:
        raise ValueError("decoder-hash")
    spec = importlib.util.spec_from_file_location("infalsus_spc_decode", decoder_path)
    decoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decoder)
    bundle = json.loads(pathlib.Path(args.bundle).read_text(encoding="utf-8"))
    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    if (not isinstance(bundle, dict) or set(bundle) != {"format", "charts"} or
            bundle.get("format") != "infalsus-private-timelines-v2" or
            not isinstance(bundle["charts"], list) or len(bundle["charts"]) != 280):
        raise ValueError("bundle")
    if (not isinstance(manifest, dict) or manifest.get("format") != "infalsus-spc-private-evidence-v1" or
            not isinstance(manifest.get("charts"), list)):
        raise ValueError("manifest")
    charts = {x.get("chartId"): x for x in bundle["charts"] if isinstance(x, dict)}
    rows = {x.get("chartId"): x for x in manifest["charts"] if isinstance(x, dict)}
    if len(charts) != 280 or len(rows) != len(manifest["charts"]):
        raise ValueError("duplicate-id")
    root_game = pathlib.Path(args.game_root)
    checked = events = air_count = 0
    errors = []
    supported = set()
    for chart_id, row in rows.items():
        if not row.get("guid") and row.get("expectedError") and row.get("lookupPath") is None and row.get("fileSha256") is None:
            continue
        supported.add(chart_id)
        if chart_id not in charts:
            errors.append(f"{chart_id}:missing-bundle")
            continue
        valid_source(row)
        path = root_game / "infalsus_Data" / "StreamingAssets" / "sam" / row["guid"]
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row.get("fileSha256"):
            raise ValueError("source-hash")
        found, index = [], 0
        original = decoder._air_coordinates

        def collect(raw, pairs):
            nonlocal index
            i = index
            index += 1
            value = original(raw, pairs)
            if value is not None:
                found.append((i, value))
            return value

        decoder._air_coordinates = collect
        try:
            native = decoder.decode_spc(data, row["lookupPath"], 0)
        finally:
            decoder._air_coordinates = original
        dto = charts[chart_id]
        if not isinstance(dto, dict) or list(dto) != ["chartId", "bpm", "timeline"] or dto.get("chartId") != chart_id:
            errors.append(f"{chart_id}:dto-keys")
            continue
        timeline = dto.get("timeline")
        if not isinstance(timeline, dict) or tuple(timeline) != TIMELINE_KEYS or timeline.get("airVersion") != 1:
            errors.append(f"{chart_id}:timeline-keys")
            continue
        if index != native["header"]["noteCount"]:
            errors.append(f"{chart_id}:count")
            continue
        base_ok = all(isinstance(timeline.get(key), list) and len(timeline[key]) == index for key in BASE_KEYS)
        if not base_ok:
            errors.append(f"{chart_id}:base-length")
            continue
        kinds = {}
        for kind in timeline["kind"]:
            if not isinstance(kind, int) or isinstance(kind, bool):
                base_ok = False
                break
            kinds[str(kind)] = kinds.get(str(kind), 0) + 1
        if not base_ok:
            errors.append(f"{chart_id}:base-kind")
            continue
        starts, ends = timeline["startMs"], timeline["endMs"]
        time_range = {"startMs": min(starts) if starts else None, "endMs": max(ends) if ends else None}
        ex = row.get("expected", {})
        native_kinds = native["notes"]["kindCounts"]
        native_bpm = {"base": native["bpm"], "changes": [{"timeMs": x["timeMs"], "bpm": x["bpm"]} for x in native["tempo"]["changes"]]}
        expected_bpm = ex.get("bpm")
        expected_bpm_projection = ({"base": expected_bpm.get("base"), "changes": [
            {"timeMs": change.get("timeMs"), "bpm": change.get("bpm")}
            for change in expected_bpm.get("changes", []) if isinstance(change, dict)
        ]} if isinstance(expected_bpm, dict) and isinstance(expected_bpm.get("changes"), list) else None)
        bpm = dto.get("bpm")
        if (native["header"]["noteCount"] != ex.get("noteCount") or kinds != native_kinds or kinds != {str(k): v for k, v in ex.get("kindCounts", {}).items()} or
                time_range != {key: native["time"][key] for key in time_range} or time_range != {key: ex.get("time", {}).get(key) for key in time_range} or
                not isinstance(bpm, dict) or list(bpm) != ["base", "changes"] or
                not isinstance(bpm.get("changes"), list) or any(not isinstance(x, dict) or set(x) != {"timeMs", "bpm"} for x in bpm["changes"]) or
                native_bpm != expected_bpm_projection or bpm != native_bpm):
            errors.append(f"{chart_id}:base-parity")
        actual = timeline.get("airCoordinates")
        expected_count = sum(1 for kind in timeline["kind"] if kind == 4)
        if not isinstance(actual, list) or len(actual) != expected_count or len(actual) != len(found):
            errors.append(f"{chart_id}:air-count")
        else:
            for pos, ((note_index, air), tuple_value) in enumerate(zip(found, actual)):
                if not isinstance(tuple_value, list) or len(tuple_value) != 10:
                    errors.append(f"{chart_id}:{pos}:tuple")
                    break
                i, typ, direction, c0, w0, c1, w1, left_mode, right_mode, reason = tuple_value
                resolved = air["status"] == "resolved"
                expected = [note_index, air["type"], air["direction"],
                            air["start"]["center"] if resolved else None,
                            air["start"]["width"] if resolved else None,
                            air["end"]["center"] if resolved else None,
                            air["end"]["width"] if resolved else None,
                            air["curveModes"]["left"], air["curveModes"]["right"], air["reason"]]
                if (not isinstance(i, int) or isinstance(i, bool) or i != note_index or
                        i <= (actual[pos - 1][0] if pos else -1) or timeline["kind"][i] != 4):
                    errors.append(f"{chart_id}:{pos}:index")
                    break
                if tuple_value[:3] != expected[:3] or tuple_value[7:] != expected[7:]:
                    errors.append(f"{chart_id}:{pos}:metadata")
                    break
                if not resolved:
                    if tuple_value[3:7] != [None, None, None, None]:
                        errors.append(f"{chart_id}:{pos}:unresolved")
                        break
                else:
                    try:
                        if any(not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x) or f32(x) != x or (x == 0 and math.copysign(1, x) < 0) for x in tuple_value[3:7]):
                            raise ValueError("geometry-number")
                        if w0 < 0 or w1 < 0:
                            raise ValueError("geometry-width")
                        recomputed = []
                        for center, width in ((c0, w0), (c1, w1)):
                            half = f32(width / 2.0)
                            left, right = f32(center - half), f32(center + half)
                            x = None if typ == "catch" else (right if direction == "right" else left)
                            recomputed.append({"center": center, "width": width, "left": left, "right": right, "x": x})
                        if any(not math.isfinite(v) for point in recomputed for v in (point["center"], point["width"], point["left"], point["right"])):
                            raise ValueError("geometry-nonfinite")
                        if tuple_value[3:7] != expected[3:7] or recomputed != [air["start"], air["end"]]:
                            raise ValueError("geometry-parity")
                    except (ValueError, TypeError, OverflowError):
                        errors.append(f"{chart_id}:{pos}:geometry")
                        break
        checked += 1
        events += native["header"]["noteCount"]
        air_count += len(found)
    if checked != 280 or supported != set(charts) or events != 185068 or errors:
        print(json.dumps({"charts": checked, "events": events, "airCoordinates": air_count, "mismatches": errors[:20]}, separators=(",", ":")))
        return 1
    print(json.dumps({"charts": checked, "events": events, "airCoordinates": air_count, "mismatches": 0}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("air-parity-failed", file=sys.stderr)
        sys.exit(1)
