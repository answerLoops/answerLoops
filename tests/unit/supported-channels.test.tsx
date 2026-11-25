// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
    SupportedChannels,
    SUPPORTED_CHANNELS_LABEL,
} from '@/components/marketing/supported-channels'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

describe('SupportedChannels', () => {
    it('renders the canonical label and all marketed channels in linked variant', () => {
        render(<SupportedChannels variant="linked" />)
        expect(screen.getByText(SUPPORTED_CHANNELS_LABEL)).toBeInTheDocument()

        const link = screen.getAllByRole('link')
        expect(link).toHaveLength(MARKETED_CHANNELS.length)

        MARKETED_CHANNELS.forEach((channel, index) => {
            expect(link[index]).toHaveTextContent(channel.name)
            expect(link[index]).toHaveAttribute('href', channel.href)
        })
    })

    it('renders the canonical label and icon-only items in compact variant', () => {
        render(<SupportedChannels variant='compact' />)


        expect(screen.getByText(SUPPORTED_CHANNELS_LABEL)).toBeInTheDocument()
        expect(screen.queryAllByRole('link')).toHaveLength(0)

        for (const channel of MARKETED_CHANNELS) {
            expect(screen.getByText(channel.name)).toBeInTheDocument()
        }
    })
})