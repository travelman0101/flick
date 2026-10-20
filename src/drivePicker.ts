/**
 * Google Picker: Google's own Drive file chooser, shown inside Flick.
 * The access token comes from our server (drive.file scope, same account as the Flick login).
 */

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export interface DriveToken {
  accessToken: string;
  apiKey: string;
  appId: string;
}

declare global {
  interface Window {
    gapi?: { load: (lib: string, cb: () => void) => void };
    google?: any;
    /** E2E seam: replaces the real picker */
    __flickDrivePicker?: (token: DriveToken) => Promise<PickedFile[]>;
  }
}

let loading: Promise<void> | null = null;

function loadPicker() {
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => window.gapi!.load("picker", () => resolve());
    s.onerror = () => {
      loading = null;
      reject(new Error("picker failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens the picker; resolves with the chosen files, or [] if the user closes it. */
export async function pickFromDrive(token: DriveToken): Promise<PickedFile[]> {
  if (window.__flickDrivePicker) return window.__flickDrivePicker(token);
  await loadPicker();
  const { picker } = window.google;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    const recent = new picker.DocsView(picker.ViewId.RECENTLY_PICKED);
    const p = new picker.PickerBuilder()
      .addView(view)
      .addView(recent)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.NAV_HIDDEN)
      .setLocale("ja")
      .setOAuthToken(token.accessToken)
      .setDeveloperKey(token.apiKey)
      .setAppId(token.appId)
      .setOrigin(location.origin)
      .setSize(Math.min(window.innerWidth, 1051), Math.min(window.innerHeight, 650))
      .setCallback((data: any) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          resolve(
            (data[picker.Response.DOCUMENTS] as any[]).map((d) => ({
              id: d[picker.Document.ID],
              name: d[picker.Document.NAME],
              mimeType: d[picker.Document.MIME_TYPE],
              url: d[picker.Document.URL],
            })),
          );
        } else if (action === picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();
    p.setVisible(true);
  });
}

const RETURN_KEY = "flick:v1:drive-return";

/** Remember which task asked for Drive, so the picker reopens after connecting. */
export function rememberDriveReturn(taskId: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, taskId);
  } catch {
    /* ignore */
  }
}

export function takeDriveReturn(): string | null {
  try {
    const id = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return id;
  } catch {
    return null;
  }
}
