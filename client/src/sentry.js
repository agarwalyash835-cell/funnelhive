// Only what error reporting uses, so the chunk stays small (a namespace import of @sentry/browser can't be tree-shaken)
export { init, captureException } from '@sentry/browser';
