type HapticStyle = "light" | "medium" | "heavy";
type NotificationType = "error" | "success" | "warning";

type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  showConfirm: (message: string, callback: (ok: boolean) => void) => void;
  showAlert: (message: string, callback?: () => void) => void;
  openTelegramLink: (url: string) => void;
  onEvent: (event: "themeChanged", cb: () => void) => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: HapticStyle) => void;
    notificationOccurred: (type: NotificationType) => void;
    selectionChanged: () => void;
  };
};

declare global {
  // biome-ignore lint/nursery/useConsistentTypeDefinitions: global augmentation needs an interface
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const webApp: TelegramWebApp | undefined = window.Telegram?.WebApp;

/** True when running inside Telegram with signed init data. */
export const insideTelegram = Boolean(webApp?.initData);

export const haptic = {
  tap: () => webApp?.HapticFeedback.impactOccurred("light"),
  select: () => webApp?.HapticFeedback.selectionChanged(),
  success: () => webApp?.HapticFeedback.notificationOccurred("success"),
  error: () => webApp?.HapticFeedback.notificationOccurred("error"),
};

export const confirmAction = (message: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (webApp && insideTelegram) {
      webApp.showConfirm(message, resolve);
    } else {
      // biome-ignore lint/suspicious/noAlert: browser fallback outside Telegram
      resolve(window.confirm(message));
    }
  });

export const alertMessage = (message: string): void => {
  if (webApp && insideTelegram) {
    webApp.showAlert(message);
  } else {
    // biome-ignore lint/suspicious/noAlert: browser fallback outside Telegram
    window.alert(message);
  }
};

const applyScheme = () => {
  document.documentElement.dataset.scheme = webApp?.colorScheme ?? "light";
};

export const initTelegram = (): void => {
  if (!webApp) {
    return;
  }
  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
  applyScheme();
  webApp.onEvent("themeChanged", applyScheme);
};
