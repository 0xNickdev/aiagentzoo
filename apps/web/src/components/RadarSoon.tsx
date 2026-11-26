import { t } from "../i18n";
import { BOT_URL, ZOOAGENCY_CLAWPUMP_URL } from "../links";
import { RADAR_RELEASE_AT } from "../radarRelease";
import RadarDisc from "./RadarDisc";
import VaporCountdown from "./VaporCountdown";
import { Btn } from "./site/Panel";

/** The radar before it opens: the disc sweeping behind a particle countdown. */
export default function RadarSoon({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="relative flex min-h-[calc(100svh-60px)] flex-col items-center justify-center overflow-hidden px-4 py-12 text-center sm:px-5">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.22]" aria-hidden>
        <RadarDisc blips={[]} active={null} onActive={() => {}} sweepMs={14_000} className="aspect-square w-[min(120vw,920px)] max-w-none text-white" />
      </div>
      <div className="relative z-10 flex w-full max-w-[1240px] flex-col items-center">
        <h1 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[40px]">{t("Runner radar")}</h1>
        <p className="mt-3 text-[14px] text-fg-2 sm:text-[16px]">{t("Opens to holders of 500,000 $ZOOAGENCY in")}</p>
        <div className="mb-10 mt-[120px] flex w-full justify-center">
          <VaporCountdown targetDate={RADAR_RELEASE_AT} labels={[t("hours"), t("minutes"), t("seconds")]} onZero={onOpen} />
        </div>
        <p className="max-w-[60ch] text-[13.5px] leading-[1.55] text-fg-2 sm:text-[15px]">
          {t("Frozen on 21 Nov, graded in public: its sharpest picks graduated 46% of the time, against 1.3% for a random launch.")}
        </p>
        <p className="mt-2 max-w-[60ch] text-[13.5px] leading-[1.55] text-dim sm:text-[15px]">{t("Signals at minute five, live in the site and in Telegram.")}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Btn href={ZOOAGENCY_CLAWPUMP_URL} primary className="h-10 px-4 text-[13.5px]">{t("Get $ZOOAGENCY")}</Btn>
          <Btn href={BOT_URL} className="h-10 px-4 text-[13.5px]">{t("Open the bot")}</Btn>
        </div>
      </div>
    </section>
  );
}
