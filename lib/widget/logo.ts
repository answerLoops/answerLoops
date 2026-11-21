/**
 * The address a workspace's chat logo is served from, and the check that an
 * address handed to the chat or the embed script is one of ours.
 *
 * The address carries the logo's version (a short fingerprint of the stored
 * image), so a replaced logo has a new address and shows up straight away
 * instead of waiting for a cached copy to expire.
 */
export const WIDGET_LOGO_VERSION_PATTERN = /^[0-9a-f]{16}$/

/** The path a workspace's logo is served from: the widget token and the logo's version. */
export function widgetLogoPath(widgetToken: string, version: string): string {
  return `/api/widget/logo/${widgetToken}?v=${version}`
}

/** Matches exactly the paths widgetLogoPath produces, and nothing else. */
export const WIDGET_LOGO_PATH_PATTERN = /^\/api\/widget\/logo\/[0-9a-f]{48}\?v=[0-9a-f]{16}$/

export function isWidgetLogoPath(value: unknown): value is string {
  return typeof value === 'string' && WIDGET_LOGO_PATH_PATTERN.test(value)
}
