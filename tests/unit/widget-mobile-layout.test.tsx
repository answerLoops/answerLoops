// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WidgetChat } from '@/app/widget/[widgetToken]/widget-chat'

vi.mock('@copilotkit/react-core/v2', () => ({
    CopilotKitProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@copilotkit/react-core/v2/headless', () => ({
    useAgent: () => ({
        agent: {
            messages: [],
            subscribe: () => ({ unsubscribe: () => { } }),
            addMessage: vi.fn(),
            runAgent: vi.fn(),
        },
    }),
    useRenderTool: vi.fn(),
    useRenderToolCall: () => () => null,
}))

describe('Widget mobile layout (#344)', () => {
    it('includes phone-width fullscreen styles and close listener in public/widget.js', () => {
        const script = readFileSync(join(process.cwd(), 'public/widget.js'), 'utf8')
        expect(script).toContain('@media (max-width:480px)')
        expect(script).toContain('inset:0;width:100%;height:100%')
        expect(script).toContain('cp-widget-close')
    })

    it('renders a mobile close button that posts cp-widget-close to the parent window', () => {
        const postMessageSpy = vi.fn()
        Object.defineProperty(window, 'parent', {
            value: { postMessage: postMessageSpy },
            configurable: true,
        })

        render(
            <WidgetChat
                widgetToken={'a'.repeat(48)}
                renderToken="test-render-token"
                orgName="Acme"
                showBranding={true}
                isSelfPreview={false}
                leadCaptureMode="off"
            />
        )

        const closeButton = screen.getByRole('button', { name: /close support chat/i })
        expect(closeButton).toBeInTheDocument()

        fireEvent.click(closeButton)
        expect(postMessageSpy).toHaveBeenCalledWith({ type: 'cp-widget-close' }, '*')
    })
})