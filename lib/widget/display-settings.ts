// What the embed script is told about how this business wants its widget to
// look. Display only: nothing here may be private, because the lookup that
// serves it is public and cached.
//
// Which values a business actually gets is decided here, on the server, from
// their plan. The install snippet cannot ask for more than the plan includes.

import {
  DEFAULT_WIDGET_BRAND_COLOR,
  ON_BRAND_LIGHT,
  isValidBrandColor,
  readableTextColor,
} from '@/lib/widget/appearance'

export const WIDGET_WINDOW_SIZES = ['small', 'medium', 'large'] as const
export type WidgetWindowSize = (typeof WIDGET_WINDOW_SIZES)[number]

export interface WidgetDisplaySettings {
  windowSize: WidgetWindowSize
  /** `#rrggbb`. */
  bubbleColor: string
  /** `#rrggbb`: the icon on the bubble, white or near-black, whichever reads better on `bubbleColor`. */
  bubbleIconColor: string
  /** The workspace logo's version, a whole number that changes when the image does, or null for the normal chat icon. */
  logoVersion: number | null
}

// Today's look. A business that has chosen nothing gets exactly this, so an
// existing install keeps its appearance without re-pasting the snippet.
export const DEFAULT_WIDGET_DISPLAY: WidgetDisplaySettings = {
  windowSize: 'small',
  bubbleColor: DEFAULT_WIDGET_BRAND_COLOR,
  bubbleIconColor: ON_BRAND_LIGHT,
  logoVersion: null,
}

export function isWidgetWindowSize(value: unknown): value is WidgetWindowSize {
  return typeof value === 'string' && (WIDGET_WINDOW_SIZES as readonly string[]).includes(value)
}

export function isWidgetBubbleColor(value: unknown): value is string {
  return isValidBrandColor(value)
}

export interface StoredWidgetDisplay {
  windowSize?: string | null
  bubbleColor?: string | null
  /** The workspace's logo version, when it has a logo. */
  logoVersion?: number | null
}

export interface DisplayPlanLimits {
  /** Window sizes and a brand bubble color are customisation, a Pro feature. */
  customization: boolean
}

/**
 * The settings to serve for a business: what it chose, limited to what its
 * plan includes, with the default standing in for anything unset, unreadable or
 * not allowed. Never throws and never returns a value the script cannot use.
 */
export function resolveWidgetDisplay(
  stored: StoredWidgetDisplay | null | undefined,
  limits: DisplayPlanLimits
): WidgetDisplaySettings {
  if (!stored || !limits.customization) return { ...DEFAULT_WIDGET_DISPLAY }
  const color = typeof stored.bubbleColor === 'string' ? stored.bubbleColor.toLowerCase() : null
  const bubbleColor = isWidgetBubbleColor(color) ? color : DEFAULT_WIDGET_DISPLAY.bubbleColor
  return {
    windowSize: isWidgetWindowSize(stored.windowSize)
      ? stored.windowSize
      : DEFAULT_WIDGET_DISPLAY.windowSize,
    bubbleColor,
    bubbleIconColor: readableTextColor(bubbleColor),
    logoVersion:
      typeof stored.logoVersion === 'number' && Number.isSafeInteger(stored.logoVersion) && stored.logoVersion >= 0
        ? stored.logoVersion
        : null,
  }
}
