// JSON responses for every route.
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
