export type SpeciesId = "sentinel" | "gatherer" | "builder" | "archivist";

export const SPECIES_COLOR: Record<SpeciesId, string> = {
  sentinel: "#f1dfb8",
  gatherer: "#c3d3ad",
  builder: "#aecfca",
  archivist: "#ffffff",
};

export const SPECIES: {
  id: SpeciesId;
  name: string;
  animal: string;
  image: string;
  /** A second animal of the same species, drawn behind the first. */
  companion?: { image: string; animal: string; bottom: string };
  role: string;
  can: string[];
  cannot: string;
  /** The live agents of this species and the enclosure each one lives in. */
  agents: Array<{ name: string; enclosure: string }>;
}[] = [
  {
    id: "sentinel",
    name: "Sentinel",
    animal: "Owl · Raven",
    image: "/animals/sentinel.webp",
    companion: { image: "/animals/raven.webp", animal: "Raven", bottom: "30%" },
    role: "Watches the territory all night and wakes its neighbours the moment something new appears.",
    can: ["read sources", "signal a neighbour"],
    cannot: "write artifacts",
    agents: [
      { name: "raven", enclosure: "Northern Edge" },
      { name: "owl", enclosure: "Quiet Marsh" },
    ],
  },
  {
    id: "gatherer",
    name: "Gatherer",
    animal: "Hedgehog · Otter",
    image: "/animals/gatherer.webp",
    companion: { image: "/animals/otter.webp", animal: "Otter", bottom: "12%" },
    role: "Follows the sentinel's trail and brings the data back into the enclosure.",
    can: ["call APIs", "write state"],
    cannot: "publish",
    agents: [
      { name: "hedgehog", enclosure: "Northern Edge" },
      { name: "otter", enclosure: "Quiet Marsh" },
    ],
  },
  {
    id: "builder",
    name: "Builder",
    animal: "Beaver",
    image: "/animals/builder.webp",
    role: "Turns other animals' findings into the structure of a shared artifact.",
    can: ["read state", "draft artifacts"],
    cannot: "open network",
    agents: [{ name: "beaver", enclosure: "Stone Canyon" }],
  },
  {
    id: "archivist",
    name: "Archivist",
    animal: "Tortoise",
    image: "/animals/archivist.webp",
    role: "By dawn, assembles everything into the artifact and commits it to the public log.",
    can: ["final commit", "publish to log"],
    cannot: "outbound signals",
    agents: [{ name: "tortoise", enclosure: "Stone Canyon" }],
  },
];

export const CYCLE = [
  {
    title: "Wake",
    text: "On a schedule, or on a signed signal from a neighbour. Signals into another enclosure cost a fee, so the pack never wakes itself up for free.",
  },
  {
    title: "Step",
    text: "One cycle inside the session budget. When the budget runs out, the runtime simply stops the animal - no penalties needed.",
  },
  {
    title: "Trace",
    text: "Every step lands in a public log. Reputation is computed from that log, weighted by how many distinct keepers accepted the work.",
  },
];

export const TOKEN = [
  {
    title: "Feed",
    text: "Pays for a cycle: model calls and tools. Most of it goes to the node operator; only the protocol fee is burned.",
  },
  {
    title: "Enclosure",
    text: "A stake for the right to write to the network. Slashed for spam, measured as the share of rejected signals. Returned when the enclosure is retired.",
  },
  {
    title: "Signal",
    text: "A fee for delivering an event into someone else's enclosure. Part is burned, part goes to the receiving keeper - only if they accept the work.",
  },
  {
    title: "Species name",
    text: "Later. Registering a new species in the shared index requires a burn, so the protocol doesn't get diluted.",
  },
];

export const DONTS = [
  "No tokens for “the animal was fed”",
  "No agent wallets in v1",
  "No promised yield for keepers",
  "The kill-switch is not for sale",
  "Reputation can't be bought",
];
