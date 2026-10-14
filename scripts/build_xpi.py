#!/usr/bin/env python3
"""Build a deterministic Zotero XPI using only the Python standard library."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
INCLUDE = (
    "manifest.json",
    "bootstrap.js",
    "prefs.js",
    "src",
    "ui",
    "icons",
    "locale",
)


def protected_baselines() -> dict[str, str]:
    path = DIST / "BASELINES.sha256"
    if not path.exists():
        return {}
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        checksum, filename = line.split(maxsplit=1)
        values[filename.strip()] = checksum.lower()
    return values


def verify_protected_output(output: Path) -> None:
    expected = protected_baselines().get(output.name) or protected_baselines().get(output.name.replace("zotero-collection-relations-", "zotero-literature-graph-"))
    if not expected:
        return
    if not output.exists():
        raise RuntimeError(f"Protected baseline is missing: {output}")
    actual = hashlib.sha256(output.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(
            f"Protected baseline checksum mismatch for {output.name}: {actual} != {expected}"
        )
    raise RuntimeError(f"Refusing to overwrite protected baseline: {output.name}")


def iter_files():
    for name in INCLUDE:
        path = ROOT / name
        if path.is_file():
            yield path
        else:
            yield from sorted(candidate for candidate in path.rglob("*") if candidate.is_file())


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    output = DIST / f"zotero-collection-relations-{version}.xpi"
    DIST.mkdir(exist_ok=True)
    verify_protected_output(output)
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for path in iter_files():
            relative = path.relative_to(ROOT).as_posix()
            info = ZipInfo(relative, date_time=(2026, 8, 21, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    print(output)


if __name__ == "__main__":
    main()
