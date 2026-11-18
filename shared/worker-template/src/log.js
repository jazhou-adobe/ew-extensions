/** One structured JSON line per request on stdout. Callers pass already-safe fields; redaction runs last. */
export function createLogger(sink, redact, base) {
  return (event, fields = {}) => {
    const line = redact(JSON.stringify({ ...base, event, ...fields }));
    sink(line);
  };
}

export const defaultSink = (line) => console.log(line);
