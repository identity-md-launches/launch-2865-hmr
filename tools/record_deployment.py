#!/usr/bin/env python3
"""Read-only Sepolia code/owner checks, then record real application addresses. Never signs or waits."""
import argparse
import hashlib
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OWNER = "0x6c14430adacc99e27f6180bc5a74d6768616bf4a"
CHAIN_ID = 11155111


def address(value):
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", value) or int(value, 16) == 0:
        raise ValueError("A real nonzero 20-byte contract address is required.")
    return value.lower()


def artifact(name):
    path = ROOT / "out" / f"{name}.sol" / f"{name}.json"
    if not path.exists():
        raise ValueError("Run forge build with the delivered foundry.toml first.")
    result = json.loads(path.read_text())
    settings = result["metadata"]["settings"]
    if (
        not result["metadata"]["compiler"]["version"].startswith("0.8.26+")
        or settings["optimizer"] != {"enabled": True, "runs": 200}
        or settings["evmVersion"] != "cancun"
        or settings["metadata"]["bytecodeHash"] != "none"
        or settings.get("viaIR", False)
    ):
        raise ValueError("Artifact build settings differ from the release; run forge build (not coverage).")
    return result


def expected_runtime(build, immutable_address=None):
    runtime = bytearray.fromhex(build["deployedBytecode"]["object"].removeprefix("0x"))
    references = build["deployedBytecode"].get("immutableReferences", {})
    if references:
        # MatchQueue's only immutable is nft. Fail closed if that source layout changes.
        if immutable_address is None or len(references) != 1:
            raise ValueError("Unexpected immutable layout.")
        encoded = bytes.fromhex(address(immutable_address)[2:]).rjust(32, b"\x00")
        for locations in references.values():
            for location in locations:
                start, length = location["start"], location["length"]
                if length != 32 or start < 0 or start + length > len(runtime):
                    raise ValueError("Invalid immutable reference.")
                runtime[start:start + length] = encoded
    elif immutable_address is not None:
        raise ValueError("MatchQueue is missing its NFT immutable.")
    return bytes(runtime)


def rpc_call(url, method, params):
    if not url.startswith(("https://", "http://")):
        raise ValueError("An HTTP(S) Sepolia JSON-RPC URL is required.")
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ValueError(f"RPC transport failed during {method}; no deployment record was written.") from None
    if "error" in result or "result" not in result:
        raise ValueError(f"RPC rejected {method}; no deployment record was written.")
    return result["result"]


def verify(rpc, nft_address, queue_address, builds):
    nft_address, queue_address = address(nft_address), address(queue_address)
    if nft_address == queue_address:
        raise ValueError("The two applications must have distinct addresses.")
    if int(rpc("eth_chainId", []), 16) != CHAIN_ID:
        raise ValueError("RPC is not Sepolia.")
    block = rpc("eth_getBlockByNumber", ["finalized", False])
    if not block or not block.get("hash"):
        raise ValueError("RPC did not supply a finalized block; no record was written.")
    block_ref = {"blockHash": block["hash"], "requireCanonical": True}
    contracts = {}
    for name, location, immutable in (
        ("HamsterRunNFT", nft_address, None),
        ("MatchQueue", queue_address, nft_address),
    ):
        expected = expected_runtime(builds[name], immutable)
        actual = bytes.fromhex(rpc("eth_getCode", [location, block_ref]).removeprefix("0x"))
        if not actual or actual != expected:
            raise ValueError(f"{name} has no matching runtime at the finalized block.")
        contracts[name] = {"address": location, "runtimeSha256": hashlib.sha256(actual).hexdigest()}

    def read(name, location, signature):
        selector = builds[name]["methodIdentifiers"][signature]
        raw = rpc("eth_call", [{"to": location, "data": "0x" + selector}, block_ref])
        if not re.fullmatch(r"0x[0-9a-fA-F]{64}", raw):
            raise ValueError(f"Invalid result for {signature}.")
        return int(raw, 16)

    if read("HamsterRunNFT", nft_address, "owner()") != int(OWNER, 16):
        raise ValueError("NFT owner does not match the requested launch owner.")
    if read("MatchQueue", queue_address, "nft()") != int(nft_address, 16):
        raise ValueError("Queue is not bound to this NFT.")
    binding = read("HamsterRunNFT", nft_address, "matchQueue()")
    if binding not in (0, int(queue_address, 16)):
        raise ValueError("NFT was configured with a different queue.")
    mint_open = read("HamsterRunNFT", nft_address, "mintOpen()")
    if mint_open not in (0, 1):
        raise ValueError("Invalid mintOpen response.")
    return {
        "chainId": CHAIN_ID,
        "network": "sepolia",
        "status": "confirmed",
        "owner": OWNER,
        "verifiedAt": {"blockNumber": int(block["number"], 16), "blockHash": block["hash"], "tag": "finalized"},
        "contracts": contracts,
        "initialization": {"queueBound": binding == int(queue_address, 16), "mintOpen": bool(mint_open)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc-url", required=True)
    parser.add_argument("--nft", required=True)
    parser.add_argument("--queue", required=True)
    args = parser.parse_args()
    try:
        builds = {name: artifact(name) for name in ("HamsterRunNFT", "MatchQueue")}
        result = verify(lambda method, params: rpc_call(args.rpc_url, method, params), args.nft, args.queue, builds)
    except (ValueError, KeyError, TypeError) as error:
        raise SystemExit(str(error)) from None
    target = ROOT / "deployments" / "sepolia.json"
    target.write_text(json.dumps(result, indent=2) + "\n")
    print("Recorded finalized Sepolia addresses and exact runtime checks in deployments/sepolia.json.")


if __name__ == "__main__":
    main()
