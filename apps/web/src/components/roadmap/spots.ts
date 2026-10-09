/**
 * Where each milestone's glass sphere sits in the roadmap video (1912×1080):
 * x, y are the sphere's geometric centre in % of the frame, r its radius in %
 * of the frame width. Fitted to the glass outline, not to the flame inside,
 * which sits low in every sphere.
 */
export const VIDEO_SIZE = { w: 1912, h: 1080 };

export const SPOTS: Record<string, { x: number; y: number; r: number }> = {
  runtime: { x: 23.35, y: 79.44, r: 4.71 },
  nightwatch: { x: 36.83, y: 63.58, r: 2.71 },
  brief: { x: 43.1, y: 56.06, r: 2.07 },
  learns: { x: 48.88, y: 49.54, r: 1.62 },
  guardian: { x: 52.17, y: 44.26, r: 1.31 },
  guests: { x: 54.99, y: 40.28, r: 1.1 },
  onchain: { x: 57.2, y: 35.07, r: 0.97 },
  token: { x: 59.05, y: 31.5, r: 0.8 },
  autopost: { x: 60.46, y: 27.69, r: 0.78 },
  reputation: { x: 61.3, y: 24.63, r: 0.64 },
  mainnet: { x: 61.61, y: 22.22, r: 0.58 },
};
