// Copied from @audio/pitch-pyin 2.1.0 (viterbi.js, MIT, https://github.com/audiojs/pitch),
// unchanged: the package doesn't export it, and note-model.ts needs it.

// Online Viterbi decoding in the log domain. A frame's state is decided as soon as every
// survivor path passes through the same state at an earlier frame (the paths coalesce), so the
// result equals offline Viterbi while backpointers stay bounded. If the paths have not met
// within `lag` frames, the older half is decided along the currently best path: fixed-lag
// decoding, which the pYIN Vamp plugin uses throughout.
//
// model: { S, init(delta, obs), step(delta, next, psi, obs) }; `step` writes the best
// predecessor of each state to `psi` and the new log score, observation included, to `next`.

export default function viterbi(model, emit, lag = 4096) {
  let { S } = model
  let Row = S > 65535 ? Int32Array : Uint16Array
  let delta = new Float64Array(S), next = new Float64Array(S)
  let anc = new Int32Array(S), prev = new Int32Array(S)
  let rows = [], pool = [], path = new Int32Array(0)
  let t = 0, done = 0, anchor = 0   // frames pushed, frames decided, frame the ancestors refer to

  // decide frames done..to along the path through state s at frame `from` ≥ to
  function decide(from, s, to) {
    let n = from - done + 1
    if (path.length < n) path = new Int32Array(n * 2)
    for (let f = from; ; f--) {
      path[f - done] = s
      if (f === done) break
      s = rows[f - done - 1][s]
    }
    for (let f = done; f <= to; f++) emit(path[f - done], f)
    pool.push(...rows.splice(0, to + 1 - done))
    done = to + 1
  }

  function reanchor() { anchor = t - 1; for (let j = 0; j < S; j++) anc[j] = j }

  function best() {
    let b = 0
    for (let j = 1; j < S; j++) if (delta[j] > delta[b]) b = j
    return b
  }

  function push(obs) {
    if (!t) { model.init(delta, obs); t = 1; return reanchor() }
    let psi = pool.pop() || new Row(S)
    model.step(delta, next, psi, obs)
    ;[delta, next] = [next, delta]
    let max = -Infinity
    for (let j = 0; j < S; j++) if (delta[j] > max) max = delta[j]
    if (max > -Infinity) for (let j = 0; j < S; j++) delta[j] -= max
    ;[anc, prev] = [prev, anc]
    for (let j = 0; j < S; j++) anc[j] = prev[psi[j]]
    rows.push(psi); t++

    let a = anc[0], same = true
    for (let j = 1; j < S && same; j++) same = anc[j] === a
    if (same) { decide(anchor, a, anchor); reanchor() }
    else if (t - done > lag) {
      let to = t - 1 - (lag >> 1)
      decide(t - 1, best(), to)
      if (anchor <= to) reanchor()
    }
  }

  push.end = () => { if (t > done) decide(t - 1, best(), t - 1) }
  return push
}
