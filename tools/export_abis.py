#!/usr/bin/env python3
"""Export the two application ABIs from a completed local forge build; no dependencies or network."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ("HamsterRunNFT", "MatchQueue")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if a delivered ABI differs from the build")
    args = parser.parse_args()
    for name in CONTRACTS:
        artifact = ROOT / "out" / f"{name}.sol" / f"{name}.json"
        if not artifact.exists():
            raise SystemExit("Run forge build first.")
        abi = json.loads(artifact.read_text())["abi"]
        target = ROOT / "abi" / f"{name}.json"
        if args.check:
            if not target.exists() or json.loads(target.read_text()) != abi:
                raise SystemExit(f"ABI differs: {target.relative_to(ROOT)}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(abi, indent=2) + "\n")
        print(f"{name}: {'checked' if args.check else 'exported'} {len(abi)} ABI entries")


if __name__ == "__main__":
    main()
