import { startServer, type ServerHandle } from '@brot/server';
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron';
import { resolveDesktopConfig } from './config';
import { startWebGateway, type WebGateway } from './gateway';
import { contentSecurityPolicy, decideNavigation, isSafeExternalUrl, LOOPBACK_HOST } from './security';
import { backgroundColorFor, buildWindowOptions } from './window';

const config = resolveDesktopConfig({
  devServer: process.argv.includes('--dev'),
  env: process.env,
  userDataDir: app.getPath('userData'),
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  bundleDir: __dirname,
});

let mainWindow: BrowserWindow | undefined;
let appUrl: string | undefined;
let server: ServerHandle | undefined;
let gateway: WebGateway | undefined;
let quitting: Promise<void> | undefined;

if (app.requestSingleInstanceLock()) {
  wire();
} else {
  app.quit();
}

function wire(): void {
  app.on('second-instance', focusWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl !== undefined) openWindow(appUrl);
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  app.on('before-quit', (event) => {
    if (quitting !== undefined) return;
    event.preventDefault();
    quitting = shutdown().finally(() => app.quit());
  });
  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(backgroundColorFor(nativeTheme.shouldUseDarkColors));
  });
  app.whenReady().then(start, fatal);
}

async function start(): Promise<void> {
  try {
    server = await startServer({
      host: LOOPBACK_HOST,
      port: config.server.port,
      webhookPort: config.server.webhookPort,
      home: config.home,
      mode: 'desktop',
    });
    if (config.web.kind === 'gateway') {
      gateway = await startWebGateway({ webRoot: config.web.root, port: config.web.port, apiPort: server.port });
      appUrl = gateway.url;
    } else {
      appUrl = config.web.url;
    }
  } catch (error) {
    fatal(error);
    return;
  }

  configureSession(appUrl);
  openWindow(appUrl);
}

/** Denies every permission request and, in dev, adds the CSP that the Vite dev server does not send. */
function configureSession(url: string): void {
  const defaults = session.defaultSession;
  defaults.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  defaults.setPermissionCheckHandler(() => false);
  if (!config.devServer) return;

  const origin = new URL(url).origin;
  const policy = contentSecurityPolicy({ kind: 'dev', origin });
  defaults.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
}

function openWindow(url: string): void {
  const origin = new URL(url).origin;
  const win = new BrowserWindow(
    buildWindowOptions({
      platform: process.platform,
      dark: nativeTheme.shouldUseDarkColors,
      devTools: config.devServer,
    }),
  );
  mainWindow = win;

  const reveal = (): void => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', reveal);
  win.webContents.on('did-fail-load', (_event, _code, _description, _failedUrl, isMainFrame) => {
    if (isMainFrame) reveal();
  });
  win.webContents.on('will-navigate', (event, target) => guardNavigation(event, target, origin));
  win.webContents.on('will-redirect', (event, target) => guardNavigation(event, target, origin));
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });

  win.loadURL(url).catch((error: unknown) => {
    console.error('Could not load the Brot UI', error);
  });
}

function guardNavigation(event: { preventDefault(): void }, target: string, appOrigin: string): void {
  const decision = decideNavigation(target, appOrigin);
  if (decision === 'allow') return;
  event.preventDefault();
  if (decision === 'open-external') openExternal(target);
}

function openExternal(target: string): void {
  if (!isSafeExternalUrl(target)) return;
  shell.openExternal(target).catch((error: unknown) => {
    console.error('Could not open link in the system browser', error);
  });
}

function focusWindow(): void {
  if (mainWindow === undefined) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** Closes the gateway before the server, so no browser request reaches a server that is going down. */
async function shutdown(): Promise<void> {
  try {
    await gateway?.close();
  } catch (error) {
    console.error('Could not close the web gateway', error);
  }
  try {
    await server?.close();
  } catch (error) {
    console.error('Could not close the Brot server', error);
  }
  gateway = undefined;
  server = undefined;
}

function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Brot failed to start', error);
  dialog.showErrorBox('Brot could not start', message);
  shutdown().finally(() => app.exit(1));
}
