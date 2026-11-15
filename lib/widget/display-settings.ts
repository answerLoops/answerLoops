// What the embed script is told about how this business wants its widget to
// look. Display only: nothing here may be private, because the lookup that
// serves it is public and cached.
//
// Which values a business actually gets is decided here, on the server, from
// their plan. The install snippet cannot ask for more than the plan includes.

export const WIDGET_WINDOW_SIZES = ['small', 'medium', 'large'] as const
export type WidgetWindowSize = (typeof WIDGET_WINDOW_SIZES)[number]

export interface WidgetDisplaySettings {
  windowSize: WidgetWindowSize
  /** `#rrggbb`. */
  bubbleColor: string
}

// Today's look. A business that has chosen nothing gets exactly this, so an
// existing install keeps its appearance without re-pasting the snippet.
export const DEFAULT_WIDGET_DISPLAY: WidgetDisplaySettings = {
  windowSize: 'small',
  bubbleColor: '#4f46e5',
}

const HEX_COLOR = /^#[0-9a-f]{6}$/

export function isWidgetWindowSize(value: unknown): value is WidgetWindowSize {
  return typeof value === 'string' && (WIDGET_WINDOW_SIZES as readonly string[]).includes(value)
}

export function isWidgetBubbleColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

export interface StoredWidgetDisplay {
  windowSize?: string | null
  bubbleColor?: string | null
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
  return {
    windowSize: isWidgetWindowSize(stored.windowSize)
      ? stored.windowSize
      : DEFAULT_WIDGET_DISPLAY.windowSize,
    bubbleColor: isWidgetBubbleColor(color) ? color : DEFAULT_WIDGET_DISPLAY.bubbleColor,
  }
}
