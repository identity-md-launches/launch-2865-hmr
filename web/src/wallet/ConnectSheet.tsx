import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { ADD_CHAIN_PARAMS, CHAIN_ID } from "../config";
import { short } from "../game";
import { WALLET_ICON_URLS } from "./wallet-icons";
import { OPEN_IN, isMobileBrowser } from "./open-in";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Switch to Sepolia; when the wallet does not know the chain, add it with network.json's parameters. */
export async function switchToSepolia(connector: Connector | undefined, switchChainAsync: (a: { chainId: typeof CHAIN_ID }) => Promise<unknown>) {
  try {
    await switchChainAsync({ chainId: CHAIN_ID });
  } catch (err) {
    const provider = (await connector?.getProvider?.()) as Eip1193 | undefined;
    const code = (err as { cause?: { code?: number }; code?: number })?.cause?.code ?? (err as { code?: number })?.code;
    if (provider && (code === 4902 || /unrecognized|not added|unknown chain/i.test(String((err as Error)?.message)))) {
      await provider.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
    } else throw err;
  }
}

/** The connect control and its sheet: console type and colors, the network's wallet structure. */
export function ConnectSheet() {
  const mobile = isMobileBrowser();
  const { address, isConnected, chainId, connector } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const prompted = useRef(false);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("keydown", onKey);
    return () => { removeEventListener("keydown", onKey); opener.current?.focus(); };
  }, [open]);
  useEffect(() => { if (isConnected) setOpen(false); }, [isConnected]);
  useEffect(() => { if (error) setNote(/reject|denied/i.test(error.message) ? "Request declined in the wallet." : "That wallet did not connect. Try again."); }, [error]);

  const wrongChain = isConnected && chainId !== CHAIN_ID;
  // Prompt the chain switch once after a connection lands on the wrong chain (never on first paint).
  useEffect(() => {
    if (wrongChain && !prompted.current && connector) {
      prompted.current = true;
      switchToSepolia(connector, switchChainAsync).catch(() => undefined);
    }
  }, [wrongChain, connector, switchChainAsync]);

  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")]
    .filter((c) => !(c.id === "injected" && named));
  const label = (c: Connector) => (c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name);
  const icon = (c: Connector) => c.icon ?? WALLET_ICON_URLS[c.id] ?? WALLET_ICON_URLS.metamask;

  if (isConnected && address) {
    if (wrongChain)
      return (
        <button className="btn-a" onClick={() => switchToSepolia(connector, switchChainAsync).catch(() => undefined)} disabled={switching}>
          <span className="a-dot" aria-hidden="true">A</span>{switching ? "Switching…" : "Switch to Sepolia"}
        </button>
      );
    return (
      <button className="btn-soft" onClick={() => disconnect()} title="Disconnect this wallet">
        {short(address)} · Disconnect
      </button>
    );
  }
  return (
    <>
      <button ref={opener} className="btn-a" onClick={() => { reset(); setNote(""); setOpen(true); }}>
        <span className="a-dot" aria-hidden="true">A</span>Connect
      </button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="sheet-title">Connect a wallet</h2>
              <button ref={closeBtn} className="x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            {mobile && OPEN_IN.map((w) => (
              <a key={w.id} className="row" href={w.href(location.href)}>
                <img className="ic" width={28} height={28} src={WALLET_ICON_URLS[w.id]} alt="" />
                <span>Open in {w.name}</span>
              </a>
            ))}
            {listed.filter((c) => !mobile || c.type !== "injected").map((c) => (
              <button key={c.uid} className="row" onClick={() => { setNote(""); connect({ connector: c, chainId: CHAIN_ID }); }} disabled={isPending}>
                <img className="ic" width={28} height={28} src={icon(c)} alt="" />
                <span>{label(c)}{isPending && variables?.connector === c ? " · opening…" : ""}</span>
              </button>
            ))}
            <p className="sheet-note" role="status">{note || "Sepolia testnet only. HamsterRun never asks for a seed phrase."}</p>
          </div>
        </div>
      )}
    </>
  );
}
