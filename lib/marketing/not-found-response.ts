/**
 * A complete 404 response for the edge proxy to return itself.
 *
 * The proxy cannot hand a request to Next's own not-found page by rewriting:
 * a rewrite target built from the request is read against whatever host
 * Auth.js normalised the URL to, and on a deployment where the marketing site
 * and the app answer on different hosts that sends the rewrite to the wrong
 * host and the visitor gets a 500. Answering directly has no host to get wrong.
 *
 * Carries `noindex` as a header and a tag, the same signal Next adds to its
 * own 404 pages, so a crawler that reaches it drops the URL.
 */
const BODY = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found | answerLoops</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#082e50;background:#fff}
main{padding:2rem;text-align:center}
h1{font-size:1.5rem;font-weight:600;margin:0 0 .75rem}
p{margin:0 0 1.5rem;color:#5d6b7c}
a{color:#315e81}
</style>
</head>
<body>
<main>
<h1>Page not found</h1>
<p>That page doesn&rsquo;t exist or has moved.</p>
<a href="/">Go to the homepage</a>
</main>
</body>
</html>
`

export function notFoundResponse(): Response {
  return new Response(BODY, {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      'cache-control': 'no-store',
    },
  })
}
