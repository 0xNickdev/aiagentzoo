/**
 * Capabilities are the only way an agent can affect the world.
 * The runtime checks them on every call; the prompt has no say.
 */
export type Capability =
  /** Read external data sources registered as tools. */
  | "sources:read"
  /** Make arbitrary outbound HTTP requests through registered tools. */
  | "net:fetch"
  /** Read enclosure state. */
  | "state:read"
  /** Write enclosure state. */
  | "state:write"
  /** Send a paid signal to another agent. */
  | "signal:send"
  /** Ask the model to think. Metered against the model-token budget. */
  | "model:think"
  /** Write artifact drafts. */
  | "artifact:draft"
  /** Commit a finished artifact to the public log. */
  | "artifact:publish";

export interface Species {
  id: string;
  name: string;
  capabilities: ReadonlySet<Capability>;
  description?: string;
}

export function defineSpecies(spec: {
  id: string;
  name: string;
  capabilities: Capability[];
  description?: string;
}): Species {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(spec.id)) {
    throw new Error(`species id "${spec.id}" must be lowercase kebab-case, 2-32 chars`);
  }
  return Object.freeze({ ...spec, capabilities: new Set(spec.capabilities) });
}

/** The four founding species of the zoo. */
export const species = {
  sentinel: defineSpecies({
    id: "sentinel",
    name: "Sentinel",
    description: "Watches sources and wakes neighbours when something new appears.",
    capabilities: ["sources:read", "state:read", "state:write", "signal:send"],
  }),
  gatherer: defineSpecies({
    id: "gatherer",
    name: "Gatherer",
    description: "Follows a sentinel's trail and brings data back into the enclosure.",
    capabilities: ["sources:read", "net:fetch", "state:read", "state:write", "signal:send"],
  }),
  builder: defineSpecies({
    id: "builder",
    name: "Builder",
    description: "Turns other animals' findings into the structure of a shared artifact.",
    capabilities: ["state:read", "state:write", "model:think", "artifact:draft", "signal:send"],
  }),
  archivist: defineSpecies({
    id: "archivist",
    name: "Archivist",
    description: "Assembles drafts into the final artifact and commits it to the public log.",
    capabilities: ["state:read", "model:think", "artifact:draft", "artifact:publish"],
  }),
} as const;
