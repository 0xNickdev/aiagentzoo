export interface Market {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  url: string | null;
}
export interface Obs {
  mint: string;
  symbol: string;
  name: string;
  market: Market | null;
  reasons?: string[];
  watchedBy?: string[];
}
export interface Sections {
  night: string;
  observed: number;
  launches: number;
  topVolume: Obs[];
  graduated: Obs[];
  wentToZero: Obs[];
  suspicious: Obs[];
  promoted: Obs[];
  watched?: Obs[];
  guests?: GuestReport[];
  week?: Week;
  calls?: Call[];
  reviewZh?: string;
  counts?: { graduated: number; wentToZero: number; suspicious: number };
  learned?: { score: { hits: number; misses: number; accuracy: number | null; skill?: number | null; cases?: Array<{ outcome: string; already?: boolean }> } | null; playbook: { version: number; text: string } };
}
export interface Week {
  start: string;
  end: string;
  minGraded: number;
  minSide: number;
  rows: Array<{ name: string; score: number; graded: number; dead: number; alive: number; ranked: boolean }>;
}
export interface Call {
  mint: string;
  symbol: string;
  verdict: string;
  confidence: number;
  why: string;
  whyZh?: string;
  by: "model" | "rules";
}
export interface GuestReport {
  guest: string;
  species: string;
  platform?: string;
  token: string | null;
  items: Array<{ mint: string; verdict: string; note: string }>;
}
export interface BriefRef {
  id: string;
  night: string;
  ts: number;
  sha256: string;
}
export interface BriefDoc {
  ref: BriefRef;
  markdown: string;
  sections: Sections;
}
