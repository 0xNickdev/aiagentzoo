import { useState } from "react";
import { WalletChip } from "./WalletChip";
import { nodeOf, shortAddress, useGuardian } from "../zoo";
import { Panel } from "./site/Panel";
import { pick } from "../i18n";

const EXAMPLE = "curl https://zooaiagency.com/api/check/<mint>";
const KEYED = 'curl -H "Authorization: Bearer zk_..." https://zooaiagency.com/api/check/<mint>?holders=1';

/** The creator check for agents: free for everyone, a key with ten times the room for holders. */
export default function ApiAccess() {
  const { session, signIn, error: signError, busy } = useGuardian();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  const getKey = async () => {
    if (!session) return;
    setWorking(true);
    setError(null);
    try {
      // The key comes from the node that reads the chain.
      const north = await nodeOf("raven");
      if (!north) throw new Error(pick("The chain node is out of reach, try again in a minute.", "链上节点暂时连不上，过一分钟再试。"));
      const r = await fetch(`${north.url}/v1/check/key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guardian: session }) });
      const body = (await r.json()) as { key?: string; error?: string };
      if (!r.ok || !body.key) throw new Error(body.error ?? `HTTP ${r.status}`);
      setKey(body.key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const tiers = [
    { name: pick("Free", "免费"), who: pick("everyone, no key, no signup", "所有人，不用密钥，不用注册"), rows: [pick("120 checks a minute", "每分钟 120 次检查"), pick("10 holder reads a minute", "每分钟 10 次持币分析"), pick("enough for any single agent", "单个智能体完全够用")] },
    { name: pick("Holder", "持币者"), who: pick("500,000+ $ZOOAGENCY, one key per wallet", "持有 500,000+ $ZOOAGENCY，一个钱包一个密钥"), rows: [pick("1,200 checks a minute", "每分钟 1,200 次检查"), pick("300 holder reads a minute", "每分钟 300 次持币分析"), pick("for bots that check every launch", "给检查每个新币的机器人用")] },
  ];

  const btn = "btn-primary inline-flex h-8 items-center rounded-[7px] px-3 text-[12.5px] font-medium disabled:opacity-50";
  return (
    <>
      <Panel id="api" title={pick("Creator check API", "开发者检查 API")} meta={pick("for trading agents · free for every agent, more for holders", "给交易智能体 · 所有智能体免费，持币者用得更多")} className="lg:col-span-12" bodyClass="grid grid-cols-1 lg:grid-cols-3">
        <p className="border-b border-line p-3.5 text-[12.5px] leading-[1.6] text-fg-2 lg:border-b-0 lg:border-r">
          {pick(
            "Before your agent buys a fresh pump.fun token, one call says avoid, caution or pass, with the reasons: did the creator already sell, did a few wallets take the launch block, does this wallet dump what it launches. Read straight from Solana.",
            "你的智能体买入 pump.fun 新币之前，调用一次就告诉你：避开、谨慎还是通过，并给出理由：开发者是否已经砸盘，开盘区块是否被几个钱包捆绑，这个钱包是否专门发币砸盘。数据直接来自 Solana 链上。",
          )}
        </p>
        {tiers.map((tier, i) => (
          <div key={tier.name} className={`min-w-0 p-3.5 ${i === 0 ? "border-b border-line lg:border-b-0 lg:border-r" : ""}`}>
            <p className="flex items-baseline gap-2">
              <span className={`text-[17px] font-medium tracking-[-0.02em] ${i === 1 ? "text-lit" : "text-white"}`}>{tier.name}</span>
              <span className="min-w-0 text-[11.5px] text-dim">{tier.who}</span>
            </p>
            <ul className="mt-2 space-y-1 text-[12.5px] text-fg-2">
              {tier.rows.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
            <pre className="mt-3 overflow-x-auto rounded-[7px] border border-line bg-night p-2.5 font-mono text-[11.5px] text-fg-2">{i === 0 ? EXAMPLE : KEYED}</pre>
          </div>
        ))}
      </Panel>

      <Panel title={pick("Your key", "你的密钥")} meta={<a href="/skill.md" className="hover:text-white">{pick("for agents: ", "智能体请看：")}zooaiagency.com/skill.md</a>} className="lg:col-span-12">
        {key ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded-[7px] border border-line bg-night px-2.5 py-1.5 font-mono text-[12px] text-warn">{key}</code>
              <button type="button" onClick={() => copy(key)} className={btn}>
                {copied ? pick("copied", "已复制") : pick("copy", "复制")}
              </button>
            </div>
            <p className="mt-2.5 text-[12px] text-dim">
              {pick("Shown once. Keep it out of public code. Asking for a new key replaces this one. If the wallet drops under 500,000, the key falls back to the free limits.", "只显示一次。不要放进公开代码。重新申请会替换这个密钥。如果钱包持仓低于 500,000，密钥会退回免费额度。")}
            </p>
          </div>
        ) : session ? (
          <div className="flex flex-wrap items-center gap-3">
            <WalletChip />
            <button type="button" disabled={working} onClick={getKey} className={btn}>
              {working ? pick("checking your holding…", "正在检查持仓…") : pick("Get my key", "获取密钥")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void signIn()} className={btn}>
              {pick("Sign in with your wallet", "用钱包登录")}
            </button>
            <span className="text-[12px] text-dim">{pick("A signature, not a transaction. It costs nothing.", "只是签名，不是交易，不花钱。")}</span>
          </div>
        )}
        {(error || signError) && <p className="mt-2.5 text-[12.5px] text-danger">{error ?? signError}</p>}
      </Panel>
    </>
  );
}
