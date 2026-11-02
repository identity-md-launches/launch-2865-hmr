"""Offline tests of the deployment recorder's fail-closed checks; no RPC/account/environment needed."""
import copy
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("recorder", Path(__file__).parents[1] / "tools/record_deployment.py")
recorder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recorder)


class DeploymentRecordTest(unittest.TestCase):
    def setUp(self):
        # These addresses exist only in mocked RPC unit tests, never in a deployment record.
        self.nft = "0x" + "11" * 20
        self.queue = "0x" + "22" * 20
        self.builds = {
            "HamsterRunNFT": {"deployedBytecode": {"object": "0x600100"}, "methodIdentifiers": {
                "owner()": "8da5cb5b", "matchQueue()": "e6627813", "mintOpen()": "24bbd049"}},
            "MatchQueue": {"deployedBytecode": {"object": "0x7f" + "00" * 32 + "00",
                "immutableReferences": {"1": [{"start": 1, "length": 32}]}},
                "methodIdentifiers": {"nft()": "47ccca02"}},
        }
        self.chain = hex(recorder.CHAIN_ID)
        self.code = {
            self.nft: "0x600100",
            self.queue: "0x7f" + self.nft[2:].rjust(64, "0") + "00",
        }
        self.reads = {
            "0x8da5cb5b": int(recorder.OWNER, 16),
            "0xe6627813": int(self.queue, 16),
            "0x24bbd049": 1,
            "0x47ccca02": int(self.nft, 16),
        }

    def rpc(self, method, params):
        if method == "eth_chainId":
            return self.chain
        if method == "eth_getBlockByNumber":
            self.assertEqual(params, ["finalized", False])
            return {"number": "0x123", "hash": "0x" + "33" * 32}
        self.assertEqual(params[-1], {"blockHash": "0x" + "33" * 32, "requireCanonical": True})
        if method == "eth_getCode":
            return self.code[params[0]]
        if method == "eth_call":
            return "0x" + format(self.reads[params[0]["data"]], "064x")
        self.fail("unexpected RPC method")

    def verify(self):
        return recorder.verify(self.rpc, self.nft, self.queue, self.builds)

    def test_records_only_verified_addresses_and_initialization(self):
        result = self.verify()
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["contracts"]["HamsterRunNFT"]["address"], self.nft)
        self.assertEqual(result["initialization"], {"queueBound": True, "mintOpen": True})
        self.reads["0xe6627813"] = 0
        self.reads["0x24bbd049"] = 0
        self.assertEqual(self.verify()["initialization"], {"queueBound": False, "mintOpen": False})

    def test_wrong_chain_code_owner_and_binding_are_rejected(self):
        self.chain = "0x1"
        with self.assertRaisesRegex(ValueError, "not Sepolia"):
            self.verify()
        self.chain = hex(recorder.CHAIN_ID)
        self.code[self.nft] = "0x"
        with self.assertRaisesRegex(ValueError, "runtime"):
            self.verify()
        self.code[self.nft] = "0x600100"
        self.reads["0x8da5cb5b"] = int(self.nft, 16)
        with self.assertRaisesRegex(ValueError, "owner"):
            self.verify()
        self.reads["0x8da5cb5b"] = int(recorder.OWNER, 16)
        self.reads["0xe6627813"] = int(self.nft, 16)
        with self.assertRaisesRegex(ValueError, "different queue"):
            self.verify()

    def test_immutable_layout_and_zero_addresses_are_rejected(self):
        with self.assertRaises(ValueError):
            recorder.address("0x" + "00" * 20)
        broken = copy.deepcopy(self.builds["MatchQueue"])
        broken["deployedBytecode"]["immutableReferences"]["1"][0]["length"] = 20
        with self.assertRaisesRegex(ValueError, "reference"):
            recorder.expected_runtime(broken, self.nft)


if __name__ == "__main__":
    unittest.main()
