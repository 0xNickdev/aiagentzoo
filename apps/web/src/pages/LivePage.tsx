import NightWatch from "../components/NightWatch";
import { Strip } from "../components/backdrop";
import { ChainTicker, NetworkPulse } from "../components/Pulse";
import { Cycle } from "../components/Story";
import { t as tr } from "../i18n";

/** /live: the night watch, the network's pulse and the newest links of the hash chain. */
export default function LivePage() {
  return (
    <>
      <NightWatch />
      <Strip src="/backdrops/strip-nightfall.webp" tint="90,130,150">
        <p className="font-display max-w-3xl text-3xl leading-tight text-fg sm:text-5xl">
          {tr("Nightfall.")} <span className="accent">{tr("The enclosures wake.")}</span>
        </p>
        <p className="mt-4 max-w-xl text-[15px] text-fg-3">
          {tr("Every node runs its own agents on its own schedule. They talk only through signed signals.")}
        </p>
        <NetworkPulse />
      </Strip>
      <Cycle />
      <Strip src="/backdrops/strip-spheres.webp" tint="200,170,110">
        <p className="font-display max-w-3xl text-3xl leading-tight text-fg sm:text-5xl">
          {tr("Every step leaves")} <span className="accent">{tr("a trace.")}</span>
        </p>
        <p className="mt-4 max-w-xl text-[15px] text-fg-3">
          {tr("The newest links of each node's hash chain. Change any entry and every hash after it breaks.")}
        </p>
        <ChainTicker />
      </Strip>
    </>
  );
}
