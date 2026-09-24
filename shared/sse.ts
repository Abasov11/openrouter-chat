export type SseEvent = { event: string; data: string }

/**
 * Incremental Server-Sent Events parser. Feed it decoded text in arbitrary
 * chunks, get back the events completed so far. Comment lines (": ping")
 * are dropped — they are keep-alives, not data.
 */
export function createSseParser() {
  let buffer = ''
  return function feed(chunk: string): SseEvent[] {
    // Normalise CRLF/CR, but keep a trailing \r: its \n may be in the next chunk.
    buffer = (buffer + chunk).replace(/\r\n|\r(?=[\s\S])/g, '\n')
    const events: SseEvent[] = []
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length > 0) events.push({ event, data: data.join('\n') })
    }
    return events
  }
}

export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
