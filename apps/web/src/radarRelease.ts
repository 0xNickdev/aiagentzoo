/** The runner radar opens to holders at this moment; before it the page shows a countdown. */
export const RADAR_RELEASE_AT = Date.parse("2026-11-27T20:00:00Z");

export const radarPreview = () => {
  try {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  } catch {
    return false;
  }
};

export const radarOpen = () => Date.now() >= RADAR_RELEASE_AT || radarPreview();
