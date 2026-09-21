import { ImageResponse } from 'next/og.js'
import { createElement as h } from 'react'
import { writeFile } from 'node:fs/promises'

// Keep share images consistent with the public site's product description.
const image = new ImageResponse(
  h('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', background: '#f5f7f7', color: '#082e50',
      padding: '64px 72px', fontFamily: 'sans-serif',
    },
  },
  h('div', { style: { display: 'flex', fontSize: 38, fontWeight: 700 } }, 'answerLoops'),
  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
    h('div', { style: { fontSize: 62, fontWeight: 700, lineHeight: 1.12, maxWidth: 960 } },
      'Answer support questions with the docs you already have'),
    h('div', { style: { fontSize: 28, color: '#52616c', lineHeight: 1.45, maxWidth: 950 } },
      'Community support across your channels, with a chat widget for any website or documentation site.'),
  ),
  h('div', { style: { display: 'flex', borderTop: '1px solid #d8dfe2', paddingTop: 20, fontSize: 24, color: '#205c70' } },
    'answerloops.com'),
  ),
  { width: 1200, height: 630 },
)
const png = Buffer.from(await image.arrayBuffer())
await writeFile(new URL('../app/opengraph-image.png', import.meta.url), png)
await writeFile(new URL('../public/social-card.png', import.meta.url), png)
