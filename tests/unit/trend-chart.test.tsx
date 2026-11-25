// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TrendChart } from '@/components/analytics/trend-chart'
import { fillTrendDays } from '@/lib/analytics/trend'

const NOW = new Date('2026-11-25T12:00:00.000Z')
const points = (data: Array<[string, number, number]>, days: number) =>
  fillTrendDays(data.map(([day, answered, deflected]) => ({ day, answered, deflected })), days, NOW)

describe('TrendChart', () => {
  it('summarizes the window in words', () => {
    render(<TrendChart points={points([['2026-11-25', 6, 4], ['2026-11-24', 4, 4]], 7)} range={7} />)
    expect(screen.getByText('8 of 10 answered questions resolved automatically in the last 7 days.')).toBeInTheDocument()
  })

  it('draws one column per day, including quiet ones, each with a tooltip', () => {
    const { container } = render(<TrendChart points={points([['2026-11-25', 2, 1]], 7)} range={7} />)
    const columns = container.querySelectorAll('[title]')
    expect(columns).toHaveLength(7)
    expect(columns[6].getAttribute('title')).toContain('1 of 2 resolved automatically')
    expect(columns[0].getAttribute('title')).toContain('0 of 0')
  })

  it('names the chart for screen readers', () => {
    render(<TrendChart points={points([['2026-11-25', 5, 3]], 30)} range={30} />)
    expect(screen.getByRole('img', { name: /last 30 days: 3 of 5 resolved automatically/ })).toBeInTheDocument()
  })

  it('says so, instead of drawing an empty chart, when nothing was answered', () => {
    render(<TrendChart points={points([], 30)} range={30} />)
    expect(screen.getByText('No answered questions in the last 30 days.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('offers 7, 30 and 90 days as links, marking the current one', () => {
    render(<TrendChart points={points([], 30)} range={30} />)
    const nav = screen.getByRole('navigation', { name: 'Trend range' })
    expect(within(nav).getByRole('link', { name: '7 days' })).toHaveAttribute('href', '/analytics?range=7')
    expect(within(nav).getByRole('link', { name: '90 days' })).toHaveAttribute('href', '/analytics?range=90')
    expect(within(nav).getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: '7 days' })).not.toHaveAttribute('aria-current')
  })

  it('explains the two colors', () => {
    render(<TrendChart points={points([['2026-11-25', 1, 1]], 7)} range={7} />)
    expect(screen.getByText('Resolved automatically')).toBeInTheDocument()
    expect(screen.getByText('Handled by a person')).toBeInTheDocument()
  })
})
