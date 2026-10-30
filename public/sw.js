self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const options = {
    body: data.body ?? '',
    icon: '/icon.png',
    data: { url: data.url ?? '/' },
  }
  // A tag makes a newer push for the same ticket replace the one already on
  // screen; renotify still alerts the person that it changed.
  if (data.tag) {
    options.tag = data.tag
    options.renotify = true
  }
  event.waitUntil(self.registration.showNotification(data.title ?? 'answerLoops', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse a dashboard tab that is already open rather than adding another.
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'navigate' in client) {
          return client.navigate(url).then((c) => (c ?? client).focus())
        }
      }
      return clients.openWindow(url)
    })
  )
})
