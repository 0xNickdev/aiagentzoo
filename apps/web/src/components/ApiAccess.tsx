import { useState } from "react";
import { nodeOf, shortAddress, useGuardian } from "../zoo";
import { Reveal, Section, SectionHead } from "./ui";
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

  return (
    <Section id="api" className="!pt-0">
      <SectionHead
        eyebrow={pick("Creator check API · for trading agents", "开发者检查 API · 给交易智能体")}
        title={[pick("Free for every agent.", "所有智能体免费。"), pick("More for holders.", "持币者用得更多。")]}
        text={pick(
          "Before your agent buys a fresh pump.fun token, one call says avoid, caution or pass, with the reasons: did the creator already sell, did a few wallets take the launch block, does this wallet dump what it launches. Read straight from Solana.",
          "你的智能体买入 pump.fun 新币之前，调用一次就告诉你：避开、谨慎还是通过，并给出理由：开发者是否已经砸盘，开盘区块是否被几个钱包捆绑，这个钱包是否专门发币砸盘。数据直接来自 Solana 链上。",
        )}
      />
      <Reveal className="grid gap-3 lg:grid-cols-2">
        {tiers.map((tier, i) => (
          <div key={tier.name} className={`liquid-glass rounded-3xl p-6 ${i === 1 ? "ring-1 ring-amber-100/20" : ""}`}>
            <p className="font-display text-3xl">{tier.name}</p>
            <p className="font-mono mt-1 text-[11px] text-white/45">{tier.who}</p>
            <ul className="mt-5 space-y-2 text-[13.5px] font-light text-white/75">
              {tier.rows.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
            <pre className="font-mono mt-5 overflow-x-auto rounded-xl bg-black/30 p-3 text-[11.5px] text-white/70">{i === 0 ? EXAMPLE : KEYED}</pre>
          </div>
        ))}
      </Reveal>

      <Reveal className="liquid-glass mt-3 rounded-3xl p-6">
        <p className="font-mono text-[10.5px] text-white/45">{pick("your key", "你的密钥")}</p>
        {key ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-3">
              <code className="font-mono break-all rounded-lg bg-black/40 px-3 py-2 text-[12.5px] text-amber-100">{key}</code>
              <button type="button" onClick={() => copy(key)} className="rounded-full bg-white px-4 py-1.5 text-[12.5px] text-black">
                {copied ? pick("copied", "已复制") : pick("copy", "复制")}
              </button>
            </div>
            <p className="mt-3 text-[12.5px] font-light text-white/55">
              {pick("Shown once. Keep it out of public code. Asking for a new key replaces this one. If the wallet drops under 500,000, the key falls back to the free limits.", "只显示一次。不要放进公开代码。重新申请会替换这个密钥。如果钱包持仓低于 500,000，密钥会退回免费额度。")}
            </p>
          </div>
        ) : session ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-[12.5px] text-white/60">{shortAddress(session.publicKey)}</span>
            <button type="button" disabled={working} onClick={getKey} className="rounded-full bg-white px-5 py-2 text-[13px] text-black disabled:opacity-50">
              {working ? pick("checking your holding…", "正在检查持仓…") : pick("Get my key", "获取密钥")}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={signIn} className="rounded-full bg-white px-5 py-2 text-[13px] text-black disabled:opacity-50">
              {pick("Sign in with your wallet", "用钱包登录")}
            </button>
            <span className="text-[12.5px] font-light text-white/50">{pick("A signature, not a transaction. It costs nothing.", "只是签名，不是交易，不花钱。")}</span>
          </div>
        )}
        {(error || signError) && <p className="mt-3 text-[12.5px] text-[#ff8a7e]">{error ?? signError}</p>}
        <p className="font-mono mt-5 text-[10.5px] text-white/35">
          {pick("for agents: ", "智能体请看：")}
          <a href="/skill.md" className="underline decoration-white/20 underline-offset-4 hover:text-white">zooaiagency.com/skill.md</a>
        </p>
      </Reveal>
    </Section>
  );
}
