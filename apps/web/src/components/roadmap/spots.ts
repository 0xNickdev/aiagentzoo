/**
 * Where each milestone's glass sphere sits in the roadmap video, measured on
 * the source still (2688×1520, same framing as the 1912×1080 loop).
 * x, y: sphere centre in % of the frame; r: sphere radius in % of the frame width.
 */
export const VIDEO_SIZE = { w: 1912, h: 1080 };

export const SPOTS: Record<string, { x: number; y: number; r: number }> = {
  runtime: { x: 23.18, y: 81.38, r: 4.46 },
  nightwatch: { x: 36.72, y: 64.93, r: 2.57 },
  brief: { x: 43.04, y: 56.97, r: 1.97 },
  learns: { x: 48.88, y: 50.46, r: 1.6 },
  guardian: { x: 52.19, y: 44.93, r: 1.19 },
  guests: { x: 55.02, y: 39.93, r: 1.04 },
  onchain: { x: 57.18, y: 35.79, r: 0.93 },
  token: { x: 59.11, y: 31.97, r: 0.82 },
  autopost: { x: 60.38, y: 27.76, r: 0.74 },
  reputation: { x: 61.38, y: 24.41, r: 0.63 },
  mainnet: { x: 61.57, y: 22.24, r: 0.6 },
};
