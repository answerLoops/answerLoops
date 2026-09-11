// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Nav, type NavState } from '@/components/marketing/chrome'

/**
 * The marketing header has two navigation surfaces, and only one of them is
 * visible on a phone. Below `md` the desktop nav is hidden and below `sm` the
 * "Log in" button is hidden too, so on a 375px screen the hamburger drawer is
 * not a convenience — it is the entire navigation.
 *
 * That asymmetry is what makes the drawer worth its own test file. A regression
 * in it is invisible to every check that looks at the header: drop the drawer's
 * sign-in entry and the desktop header still renders two perfectly weighted
 * buttons, the screenshots still look right, and a phone visitor who already
 * has an account has no way into the product at all.
 *
 * tests/unit/marketing-nav-cta.test.tsx covers the header's own CTAs and the
 * navState mapping; tests/unit/mobile-drawer.test.tsx covers the drawer
 * primitive's open/close mechanics. Neither one looks at what the marketing
 * header actually puts inside the drawer, which is what follows.
 */

const ALL_STATES: NavState[] = ['anonymous', 'no-plan', 'active']

/**
 * The drawer renders nothing until it is opened, and it portals into
 * document.body — so `screen` sees the header and the drawer at once. Almost
 * every assertion here needs one or the other in isolation (both surfaces carry
 * a "Log in" link when anonymous), hence the scoped queries rather than bare
 * `screen` lookups.
 */
async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  const panel = screen.getByRole('button', { name: 'Close menu' }).closest('div.fixed')
  expect(panel, 'the opened drawer panel').not.toBeNull()
  return { panel: panel as HTMLElement, drawer: within(panel as HTMLElement) }
}

describe('the drawer is the only navigation a phone gets', () => {
  it('carries both halves of the anonymous pair, since the header hides one below sm', async () => {
    // "Log in" is `hidden … sm:flex` in the header. At 375px it is gone, so
    // the drawer copy is the only sign-in affordance on the whole page for a
    // returning visitor whose session expired. Losing it does not break any
    // layout and does not remove anything a desktop reviewer would notice.
    const user = userEvent.setup()
    render(<Nav state="anonymous" />)
    const { drawer } = await openDrawer(user)

    const signIn = drawer.getByRole('link', { name: /^log in$/i })
    expect(
      signIn.getAttribute('href'),
      'the drawer must use the sign-in framing, not "Create your account"',
    ).toBe('/login?mode=signin')

    const trial = drawer.getByRole('link', { name: /start for \$0/i })
    expect(
      trial.getAttribute('href'),
      'every "start" action goes to auth; the plan is chosen after, at /checkout',
    ).toBe('/login')
  })

  it('offers no auth actions to somebody who is already signed in', async () => {
    // Both drawer auth links are gated on `state === 'anonymous'`. If that gate
    // is dropped, a signed-in visitor is invited to log in again — and on a
    // phone the drawer is the only place they would see it, so the confusion
    // lands exactly where it is hardest to notice in review.
    for (const state of ['no-plan', 'active'] as const) {
      const user = userEvent.setup()
      const { unmount } = render(<Nav state={state} />)
      const { drawer } = await openDrawer(user)

      expect(drawer.queryByRole('link', { name: /^log in$/i }), `${state} drawer`).toBeNull()
      expect(drawer.queryByRole('link', { name: /start for \$0/i }), `${state} drawer`).toBeNull()
      unmount()
    }
  })

  it('always carries the five nav links, in every state', async () => {
    // These are the desktop nav's replacements. They are not state-dependent
    // and must never become so: a phone visitor with no plan still needs to
    // reach Pricing, and one with an active plan still needs Docs.
    const expected: [RegExp, string][] = [
      [/^product$/i, '/#features'],
      [/^integrations$/i, '/#integrations'],
      [/^pricing$/i, '/pricing'],
      [/^docs$/i, '/docs'],
      [/^about$/i, '/about'],
    ]

    for (const state of ALL_STATES) {
      const user = userEvent.setup()
      const { unmount } = render(<Nav state={state} />)
      const { drawer } = await openDrawer(user)

      for (const [name, href] of expected) {
        const link = drawer.getByRole('link', { name })
        expect(link.getAttribute('href'), `${String(name)} in the ${state} drawer`).toBe(href)
      }
      unmount()
    }
  })

  it('does not send a phone visitor out to the source repository', async () => {
    // The GitHub link was removed from the header because it competed with the
    // CTA at the point of decision. The drawer is a stricter case: it is the
    // only navigation on a phone, so an outbound link there is a larger share
    // of the available exits. The footer still links to the repo for anyone
    // actually looking for it.
    for (const state of ALL_STATES) {
      const user = userEvent.setup()
      const { unmount } = render(<Nav state={state} />)
      const { drawer } = await openDrawer(user)

      for (const link of drawer.getAllByRole('link')) {
        expect(link.getAttribute('href') ?? '', `${state} drawer`).not.toMatch(/github\.com/i)
      }
      unmount()
    }
  })
})

/**
 * Each state's CTA is rendered by its own `state === …` guard, so a wrong or
 * missing guard shows up as an extra button rather than a crash. Two CTAs side
 * by side look deliberate; the header is designed to hold two. The existing CTA
 * test asserts the dashboard link is absent in the other states — this covers
 * the rest of the matrix, with the drawer open so both surfaces are checked at
 * once.
 */
describe('each state renders its own CTA and nobody else’s', () => {
  const CTAS = {
    dashboard: /go to dashboard/i,
    choosePlan: /choose a plan/i,
    trial: /start for \$0/i,
    signIn: /^log in$/i,
  } as const

  const EXPECTED: Record<NavState, (keyof typeof CTAS)[]> = {
    anonymous: ['trial', 'signIn'],
    'no-plan': ['choosePlan'],
    active: ['dashboard'],
  }

  for (const state of ALL_STATES) {
    it(`renders only the ${state} CTAs`, async () => {
      const user = userEvent.setup()
      render(<Nav state={state} />)
      await openDrawer(user)

      for (const [key, pattern] of Object.entries(CTAS) as [keyof typeof CTAS, RegExp][]) {
        const found = screen.queryAllByRole('link', { name: pattern })
        if (EXPECTED[state].includes(key)) {
          expect(found.length, `${state} should offer ${key}`).toBeGreaterThan(0)
        } else {
          expect(found, `${state} must not offer ${key}`).toHaveLength(0)
        }
      }
    })
  }

  it('never offers a signed-in visitor a way to start a second trial', async () => {
    // Worth stating on its own: "Start free trial" in front of somebody who is
    // already paying is not a cosmetic slip, it is an invitation to a second
    // subscription, and /login will bounce them somewhere confusing.
    const user = userEvent.setup()
    render(<Nav state="active" />)
    await openDrawer(user)

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '', 'no auth links for an active subscriber').not.toMatch(
        /^\/login/,
      )
    }
  })
})

/**
 * The header is `sticky … backdrop-blur-xl`. A backdrop-filter establishes a CSS
 * containing block, which means a `position: fixed` descendant is sized and
 * positioned against the header's own box instead of the viewport. Rendered
 * inline, the drawer's `fixed inset-0` overlay would be clipped to a ~60px tall
 * header strip — the panel would be a sliver at the top of the screen and the
 * backdrop would cover nothing.
 *
 * Nothing about the drawer's markup hints at this dependency, so the portal is
 * exactly the kind of thing a well-meaning refactor removes.
 */
describe('the drawer escapes the header’s containing block', () => {
  it('renders the drawer into document.body, outside the header subtree', async () => {
    const user = userEvent.setup()
    const { container } = render(<Nav state="anonymous" />)
    const { panel } = await openDrawer(user)

    const header = container.querySelector('header')
    expect(header, 'the marketing header element').not.toBeNull()
    expect(
      header!.contains(panel),
      'the drawer must not be a descendant of the blurred header',
    ).toBe(false)
    expect(panel.parentElement, 'the drawer portals straight to document.body').toBe(document.body)
  })

  it('leaves nothing behind in the header when the drawer is closed', async () => {
    // The portal is conditional on `open`, so a closed drawer must contribute
    // no overlay at all — a leftover `fixed inset-0` node would swallow clicks
    // across the whole page even at zero opacity.
    const user = userEvent.setup()
    render(<Nav state="anonymous" />)
    const { panel } = await openDrawer(user)
    expect(document.body.contains(panel)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(document.body.contains(panel)).toBe(false)
    expect(document.body.querySelector('div.fixed.inset-0')).toBeNull()
  })
})
