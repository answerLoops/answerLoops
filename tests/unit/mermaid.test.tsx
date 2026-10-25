// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { initialize, renderDiagram } = vi.hoisted(() => ({ initialize: vi.fn(), renderDiagram: vi.fn() }))
vi.mock('mermaid', () => ({ default: { initialize, render: renderDiagram } }))

import { Mermaid } from '@/components/docs/mermaid'

beforeEach(() => {
  renderDiagram.mockReset()
})

describe('Mermaid', () => {
  it('shows the caption straight away and a placeholder until the diagram is drawn', () => {
    renderDiagram.mockReturnValue(new Promise(() => {}))
    const { container } = render(<Mermaid chart="flowchart LR; A-->B" caption="How A reaches B" />)
    expect(screen.getByText('How A reaches B').tagName).toBe('FIGCAPTION')
    expect(container.querySelector('[role="img"]')).toBeNull()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('draws the diagram, labelled with the caption, from the trimmed chart text', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-testid="drawn"></svg>' })
    render(<Mermaid chart={'\n  flowchart LR; A-->B\n'} caption="How A reaches B" />)
    const img = await screen.findByRole('img', { name: 'How A reaches B' })
    expect(img.querySelector('svg')).not.toBeNull()
    expect(renderDiagram).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-[a-zA-Z0-9_-]+$/), 'flowchart LR; A-->B')
  })

  it('configures Mermaid once with strict security and the docs palette', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg></svg>' })
    render(<Mermaid chart="flowchart LR; A-->B" caption="one" />)
    await screen.findByRole('img')
    render(<Mermaid chart="flowchart LR; C-->D" caption="two" />)
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize.mock.calls[0][0]).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      themeVariables: { primaryTextColor: '#082e50', primaryBorderColor: '#168fa3' },
    })
  })

  it('falls back to the diagram source when rendering fails', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error'))
    const { container } = render(<Mermaid chart="not a diagram" caption="Broken one" />)
    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull())
    expect(container.querySelector('pre')).toHaveTextContent('not a diagram')
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Broken one')).toBeInTheDocument()
  })

  it('draws again when the chart changes', async () => {
    renderDiagram.mockResolvedValueOnce({ svg: '<svg id="first"></svg>' })
    const { rerender } = render(<Mermaid chart="flowchart LR; A-->B" caption="Diagram" />)
    await screen.findByRole('img')
    renderDiagram.mockResolvedValueOnce({ svg: '<svg id="second"></svg>' })
    rerender(<Mermaid chart="flowchart LR; A-->C" caption="Diagram" />)
    await waitFor(() => expect(document.querySelector('svg#second')).not.toBeNull())
    expect(renderDiagram).toHaveBeenCalledTimes(2)
  })
})
