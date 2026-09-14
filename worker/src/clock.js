// "Now" and the client IP. Only a Worker started with var TEST_MODE=1 honours X-Test-Now / X-Test-IP.
export function testMode(env) {
  return env.TEST_MODE === '1'
}

export function now(request, env) {
  if (testMode(env)) {
    const h = request.headers.get('X-Test-Now')
    if (h) {
      const t = new Date(h)
      if (!Number.isNaN(t.getTime())) return t
    }
  }
  return new Date()
}

export function clientIp(request, env) {
  if (testMode(env)) {
    const h = request.headers.get('X-Test-IP')
    if (h) return h
  }
  return request.headers.get('CF-Connecting-IP') || '127.0.0.1'
}
