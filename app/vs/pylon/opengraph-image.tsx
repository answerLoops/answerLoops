import { renderVsCover, VS_COVER_SIZE } from '@/lib/marketing/vs-cover'

// Decided per request, not at build time: a self-hosted install must 404 here,
// and the deployment mode is a runtime setting.
export const dynamic = 'force-dynamic'
export const alt = 'answerLoops vs Pylon'
export const size = VS_COVER_SIZE
export const contentType = 'image/png'

export default function Image() {
  return renderVsCover('Pylon', ['Channels', 'Controls', 'Self-hosting'])
}
