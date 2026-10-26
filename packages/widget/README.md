# @answerloops/widget

Add the [answerLoops](https://answerloops.com) chat widget to a React, Next.js or plain JavaScript site. The widget answers visitors' questions from your published knowledge base. This package loads it from your answerLoops instance, so it always matches your workspace settings, branding and allowed domains.

You need two values from **Settings → Widget** in your workspace: the embed token and the address of your instance. See the [chat widget docs](https://answerloops.com/docs/product/chat-widget) for setup, including **Allowed domains**, which must list the site you embed on.

## Install

```bash
npm install @answerloops/widget
```

## React and Next.js

Place the component once, in the layout that wraps every page.

```tsx
// app/layout.tsx
import { AnswerLoopsWidget } from '@answerloops/widget/react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AnswerLoopsWidget
          widgetId={process.env.NEXT_PUBLIC_ANSWERLOOPS_WIDGET_ID!}
          baseUrl={process.env.NEXT_PUBLIC_ANSWERLOOPS_URL!}
        />
      </body>
    </html>
  )
}
```

The component renders nothing itself. It is marked as a client component, so it works from a server layout without a wrapper file. React 18 or newer is required.

## Plain JavaScript

```ts
import { mountWidget } from '@answerloops/widget'

const widget = mountWidget({
  widgetId: '<your-embed-token>',
  baseUrl: 'https://your-instance.example.com',
})

// Later, to remove the chat bubble:
widget.unmount()
```

## Options

| Option | Required | Description |
|---|---|---|
| `widgetId` | yes | The embed token from **Settings → Widget**. It is public by design; **Allowed domains** controls where it works. |
| `baseUrl` | yes | The address of your answerLoops instance, for example `https://your-instance.example.com`. |
| `onError` | no | Called if the widget script cannot be loaded. |

A page shows one widget. Calling `mountWidget` again with the same options returns the same handle, and calling it with different options replaces the widget. On the server it does nothing.

## License

AGPL-3.0
