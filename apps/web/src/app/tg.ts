/** The slice of the Telegram Mini App API the zoo uses; every call is optional so the page also works in a browser. */
interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string }; start_param?: string };
  platform?: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  /** Bot API 8.0: the whole screen, no Telegram header; Telegram keeps its close and menu buttons over the top. */
  requestFullscreen?(): void;
  isVersionAtLeast?(version: string): boolean;
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | undefined = window.Telegram?.WebApp?.initData !== undefined ? window.Telegram.WebApp : undefined;
/** True inside Telegram, where initData is signed by Telegram for this user. */
export const inTelegram = Boolean(tg?.initData);

export function boot(): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#030504");
  tg.setBackgroundColor?.("#030504");
  tg.setBottomBarColor?.("#030504");
  tg.disableVerticalSwipes?.();
  // On a phone the zoo takes the whole screen; on desktop Telegram's own window is the better frame.
  const phone = tg.platform === "ios" || tg.platform === "android";
  if (phone && tg.isVersionAtLeast?.("8.0")) tg.requestFullscreen?.();
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.impactOccurred("light"),
  select: () => tg?.HapticFeedback?.selectionChanged(),
  verdict: (v: "suspicious" | "watch" | "promising") =>
    tg?.HapticFeedback?.notificationOccurred(v === "suspicious" ? "error" : v === "promising" ? "success" : "warning"),
};

export function openLink(url: string): void {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Share into any Telegram chat, or the browser's share sheet outside Telegram. */
export function share(url: string, text: string): void {
  const t = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(t);
  else if (navigator.share) void navigator.share({ url, text }).catch(() => {});
  else window.open(t, "_blank", "noopener");
}
