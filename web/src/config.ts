import { createPublicClient, defineChain, fallback, http, type Abi } from "viem";
import { createConfig } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import nftAbiJson from "../../abi/HamsterRunNFT.json";
import queueAbiJson from "../../abi/MatchQueue.json";

/* Values below are copied from .imd/reads/deployment.json and .imd/reads/network.json. */
export const CHAIN_ID = 11155111;
export const DEPLOY_BLOCK = 12047166n;
export const NFT_ADDRESS = "0x140128b9208ee5de9690cd96b3bb7bc601d5b4ec" as const;
export const QUEUE_ADDRESS = "0x98d449abfaeaa0d0ebd0cf073f19faae24d32308" as const;
/** Display only: the HamsterRunNFT owner who runs setMatchQueue and setMintOpen. */
export const OWNER_ADDRESS = "0x6C14430adacc99e27F6180bC5a74d6768616BF4A" as const;
export const ABI_HASHES = {
  HamsterRunNFT: "1ab2fb4b4edfcc9305fafc87f763cddadc2711bee95b116a8a30f7c8e83d7df6",
  MatchQueue: "87b2b981be42ba2d1f728b64c3096e53cbf5549c02b4236fd79ce6d911f9aa20",
} as const;
export const RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.ethpandaops.io",
  "https://sepolia.rpc.sentio.xyz",
];
export const EXPLORER = "https://sepolia.etherscan.io";
export const FAUCETS = [
  { name: "Google Cloud faucet", url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia" },
  { name: "Alchemy faucet", url: "https://www.alchemy.com/faucets/ethereum-sepolia" },
];
export const ADD_CHAIN_PARAMS = {
  chainId: "0xaa36a7",
  chainName: "Sepolia",
  rpcUrls: RPC_URLS,
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: [EXPLORER],
};

export const SITE_NAME = "HamsterRun";
export const SITE_DESCRIPTION =
  "HamsterRun v2: mint a free pixel hamster on Sepolia, feed it, train it and race it in stamina-band queues.";

export const nftAbi = nftAbiJson as Abi;
export const queueAbi = queueAbiJson as Abi;

/* No multicall contract is declared: every read goes through plain eth_call, batched per request. */
export const sepolia = defineChain({
  id: CHAIN_ID,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: { default: { name: "Etherscan", url: EXPLORER } },
  testnet: true,
});

const transport = () => fallback(RPC_URLS.map((u) => http(u, { batch: { batchSize: 40, wait: 16 } })));

export const publicClient = createPublicClient({ chain: sepolia, transport: transport() });

export const wagmiConfig = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: { [sepolia.id]: transport() },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
