import { t } from "../../i18n";
import { short } from "../../format";
import type { XRayReport } from "./types";
import { Stat } from "./shared";

type Rights = NonNullable<XRayReport["check"]["rights"]>;

/** Who can still touch holders' tokens, as the mint account says. A held right is a power, not proof it will be used. */
export function RightsStats({ r }: { r: Rights }) {
  const held = (w: string | null) => (w ? t("held by {w}", { w: short(w) }) : t("revoked"));
  return (
    <>
      <Stat k="can mint more" v={held(r.mintAuthority)} bad={!!r.mintAuthority} />
      <Stat k="can freeze holders" v={held(r.freezeAuthority)} bad={!!r.freezeAuthority} />
      {r.permanentDelegate && <Stat k="can move anyone's tokens" v={held(r.permanentDelegate)} bad />}
      {r.pauseAuthority && <Stat k="can pause transfers" v={held(r.pauseAuthority)} bad />}
      {r.transferHook && <Stat k="runs a program on every transfer" v={short(r.transferHook)} bad />}
      {r.transferFeeBps !== undefined && <Stat k="fee on every transfer" v={`${r.transferFeeBps / 100}%`} bad />}
      {r.defaultFrozen && <Stat k="new accounts start frozen" v={t("yes")} bad />}
      {r.nonTransferable && <Stat k="tokens cannot be transferred" v={t("yes")} bad />}
    </>
  );
}
