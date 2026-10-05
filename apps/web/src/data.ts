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
  role: string;
  can: string[];
  cannot: string;
}[] = [
  {
    id: "sentinel",
    name: "Sentinel",
    animal: "Owl",
    image: "/animals/sentinel.webp",
    role: "Watches the territory all night and wakes its neighbours the moment something new appears.",
    can: ["read sources", "signal a neighbour"],
    cannot: "write artifacts",
  },
  {
    id: "gatherer",
    name: "Gatherer",
    animal: "Hedgehog",
    image: "/animals/gatherer.webp",
    role: "Follows the sentinel's trail and brings the data back into the enclosure.",
    can: ["call APIs", "write state"],
    cannot: "publish",
  },
  {
    id: "builder",
    name: "Builder",
    animal: "Beaver",
    image: "/animals/builder.webp",
    role: "Turns other animals' findings into the structure of a shared artifact.",
    can: ["read state", "draft artifacts"],
    cannot: "open network",
  },
  {
    id: "archivist",
    name: "Archivist",
    animal: "Tortoise",
    image: "/animals/archivist.webp",
    role: "By dawn, assembles everything into the artifact and commits it to the public log.",
    can: ["final commit", "publish to log"],
    cannot: "outbound signals",
  },
];

export const CYCLE = [
  {
    title: "Wake",
    text: "On a schedule, or on a signed signal from a neighbour. Signals into another enclosure cost a fee, so the pack never wakes itself up for free.",
  },
  {
    title: "Step",
    text: "One cycle inside the session budget. When the budget runs out, the runtime simply stops the animal — no penalties needed.",
  },
  {
    title: "Trace",
    text: "Every step lands in a public log. Reputation is computed from that log, weighted by how many distinct keepers accepted the work.",
  },
];

export const TOKEN = [
  {
    title: "Feed",
    text: "Pays for a cycle: model calls, tools, a place in the queue. Most of it goes to the node operator; only the protocol fee is burned.",
  },
  {
    title: "Enclosure",
    text: "A stake for the right to write to the network. Slashed for spam, measured as the share of rejected signals. Returned when the enclosure is retired.",
  },
  {
    title: "Signal",
    text: "A fee for delivering an event into someone else's enclosure. Part is burned, part goes to the receiving keeper — only if they accept the work.",
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

export const ROADMAP = [
  {
    when: "Weeks 1–2",
    title: "Runtime",
    text: "Scheduler, enclosure state, events, two species, cycle budgets and a public log page. Feed runs on internal credits.",
  },
  {
    when: "Week 3",
    title: "First night",
    text: "The night watch runs on its own and ships the first morning brief — no human in the loop.",
  },
  {
    when: "After",
    title: "Federation & token",
    text: "A second independent node, stakes and signal fees. Feed can be bought with the token on launch day.",
  },
];
