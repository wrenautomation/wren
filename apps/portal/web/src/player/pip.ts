/**
 * Document Picture-in-Picture (`window.documentPictureInPicture`, Chromium): a small always-on-top
 * window that holds our own DOM, so the player's element moves into it. Not in TypeScript's DOM
 * lib yet, so its one member is declared here. No API (Firefox, Safari): the button is hidden.
 */
interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

export const pipApi = (): DocumentPictureInPicture | null =>
  (globalThis as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture ?? null;

/** Opens the window, black and edge to edge. A user gesture must have started the call. */
export async function openPip(width: number, height: number): Promise<Window | null> {
  const api = pipApi();
  if (!api) return null;
  const win = await api.requestWindow({ width, height });
  win.document.documentElement.style.cssText = "height:100%";
  win.document.body.style.cssText = "margin:0;height:100%;background:#000;overflow:hidden";
  return win;
}
