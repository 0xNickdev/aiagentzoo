/** Prints fresh node identities as env lines for docker compose. Keep the output secret. */
import { randomBytes } from "node:crypto";
import { Identity } from "@aiagentzoo/sdk";

for (const role of ["NORTH", "MARSH", "CANYON"]) {
  const identity = Identity.generate();
  console.log(`${role}_SECRET=${identity.export()}`);
  console.log(`${role}_PUBLIC=${identity.publicKey}`);
}
console.log(`ZOO_ADMIN_TOKEN=${randomBytes(24).toString("base64url")}`);
