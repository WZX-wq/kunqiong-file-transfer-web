// Portable SHA-256 for the synchronous resume key, including plain HTTP browsers
// without SubtleCrypto. The persisted manifest contains only a digest of options.
export function resumeDigest(value) {
  const bytes = new TextEncoder().encode(value)
  const words = new Uint32Array(((bytes.length + 9 + 63) >> 6) * 16)
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8)
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8)
  words[words.length - 1] = bytes.length * 8
  const constants = [], initial = []
  for (let n = 2; constants.length < 64; n++) {
    let prime = true
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break }
    if (prime) { if (initial.length < 8) initial.push((Math.sqrt(n) % 1 * 2 ** 32) | 0); constants.push((Math.cbrt(n) % 1 * 2 ** 32) | 0) }
  }
  const rotate = (x, n) => x >>> n | x << (32 - n)
  const hash = initial, schedule = new Uint32Array(64)
  for (let base = 0; base < words.length; base += 16) {
    schedule.set(words.subarray(base, base + 16))
    for (let i = 16; i < 64; i++) {
      const x = schedule[i - 15], y = schedule[i - 2]
      schedule[i] = schedule[i-16] + (rotate(x,7)^rotate(x,18)^x>>>3) + schedule[i-7] + (rotate(y,17)^rotate(y,19)^y>>>10)
    }
    let [a,b,c,d,e,f,g,h] = hash
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + (e&f^~e&g) + constants[i] + schedule[i]) | 0
      const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + (a&b^a&c^b&c)) | 0
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0
    }
    ;[a,b,c,d,e,f,g,h].forEach((v,i) => { hash[i] = (hash[i] + v) | 0 })
  }
  return hash.map(word => (word >>> 0).toString(16).padStart(8,'0')).join('')
}
