export { createDesktopService, DesktopError, TAKEOVER_WAIT_MS } from './service';
export type { DesktopCommandResult, DesktopOptions, DesktopRunner, DesktopService, DesktopServiceDeps, DesktopStateView } from './service';
export { createTakeoverState, TAKEOVER_REFUSAL } from './takeover';
export type { TakeoverState } from './takeover';
export { createDesktopTools } from './tools';
export { mountDesktopRoutes } from './routes';
export { browserArgv, inputArgv, screenshotArgv, DESKTOP_ENV } from './commands';
