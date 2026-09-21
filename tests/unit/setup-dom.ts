import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// next/font/google is compiled away by Next's bundler; outside of it the named
// font exports are not callable. Any test that imports a component calling a
// font loader at module scope (the marketing layout) would otherwise crash on
// import, so return the same shape the real loader does.
vi.mock('next/font/google', () => ({
  Source_Sans_3: () => ({
    className: 'font-source-sans-3',
    variable: '--font-marketing-sans',
    style: { fontFamily: 'Source Sans 3' },
  }),
}))

afterEach(() => {
  cleanup()
})
