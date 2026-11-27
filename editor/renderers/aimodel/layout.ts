/** A layered (Sugiyama-style) DAG layout sized for model graphs: 10k+ nodes in well under a second.
 *
 *  1. cycles are broken by ignoring back edges found by an iterative DFS;
 *  2. ranks by longest path from the sources, then sources are pulled down next to their first
 *     consumer (constants and side inputs sit beside the op that uses them, not at the top);
 *  3. edges spanning several ranks get dummy points (capped; beyond the cap long edges are drawn
 *     straight) so crossing reduction and routing see them;
 *  4. order inside a rank by barycenter sweeps (down and up);
 *  5. coordinates: each node goes to the mean position of its neighbours in the previous rank, then
 *     overlaps are resolved by a left/right push that keeps the order; a few sweeps.
 *  Direction 'TB' (top → bottom) or 'LR' (left → right): computed in TB and transposed. */

export interface LayoutNode {
  id: string
  width: number
  height: number
}

export interface LayoutEdge {
  from: string
  to: string
}

export interface LayoutOptions {
  direction?: 'TB' | 'LR'
  /** Gap between ranks (along the flow). */
  rankGap?: number
  /** Gap between nodes in a rank. */
  nodeGap?: number
  /** Ordering sweeps. */
  sweeps?: number
  /** Most dummy points created for long edges. */
  maxDummies?: number
}

export interface LayoutResult {
  /** Top-left corner of each node. */
  nodes: Map<string, { x: number; y: number; width: number; height: number; rank: number }>
  /** Polyline per input edge (same order), from the source's border to the target's border. */
  edges: { from: string; to: string; points: { x: number; y: number }[] }[]
  width: number
  height: number
}

interface Item {
  id: number
  w: number
  h: number
  rank: number
  order: number
  x: number
  dummy: boolean
  up: number[]
  down: number[]
}

export function layout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], opts: LayoutOptions = {}): LayoutResult {
  const dir = opts.direction ?? 'TB'
  const rankGap = opts.rankGap ?? 36
  const nodeGap = opts.nodeGap ?? 18
  const sweeps = opts.sweeps ?? 4
  const maxDummies = opts.maxDummies ?? 200000
  const lr = dir === 'LR'
  const index = new Map<string, number>()
  const items: Item[] = nodes.map((n, i) => {
    index.set(n.id, i)
    // Work in TB space: in LR the node's height runs across the rank.
    return { id: i, w: lr ? n.height : n.width, h: lr ? n.width : n.height, rank: 0, order: 0, x: 0, dummy: false, up: [], down: [] }
  })
  const n = items.length
  const out: number[][] = Array.from({ length: n }, () => [])
  const valid: [number, number][] = []
  for (const e of edges) {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    out[a].push(b)
    valid.push([a, b])
  }

  // 1. Back edges by iterative DFS (state 1 = on stack).
  const state = new Uint8Array(n)
  const back = new Set<number>()
  const key = (a: number, b: number) => a * n + b
  for (let s = 0; s < n; s++) {
    if (state[s]) continue
    const stack: [number, number][] = [[s, 0]]
    state[s] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [v, i] = top
      if (i < out[v].length) {
        top[1]++
        const w = out[v][i]
        if (state[w] === 1) back.add(key(v, w))
        else if (state[w] === 0) {
          state[w] = 1
          stack.push([w, 0])
        }
      } else {
        state[v] = 2
        stack.pop()
      }
    }
  }
  const dag: [number, number][] = valid.filter(([a, b]) => !back.has(key(a, b)))
  const succ: number[][] = Array.from({ length: n }, () => [])
  const pred: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of dag) {
    succ[a].push(b)
    pred[b].push(a)
  }

  // 2. Longest-path ranks (Kahn order), then pull sources down.
  const indeg = new Int32Array(n)
  for (const [, b] of dag) indeg[b]++
  const topo: number[] = []
  for (let i = 0; i < n; i++) if (!indeg[i]) topo.push(i)
  for (let k = 0; k < topo.length; k++) {
    const v = topo[k]
    for (const w of succ[v]) {
      if (items[w].rank < items[v].rank + 1) items[w].rank = items[v].rank + 1
      if (--indeg[w] === 0) topo.push(w)
    }
  }
  for (const v of topo) {
    if (pred[v].length || !succ[v].length) continue
    let m = Infinity
    for (const w of succ[v]) m = Math.min(m, items[w].rank)
    items[v].rank = Math.max(0, m - 1)
  }

  // 3. Dummies for long edges.
  const all: Item[] = items.slice()
  const chains: number[][] = [] // per dag edge: item ids from source to target
  let dummies = 0
  for (const [a, b] of dag) {
    const span = all[b].rank - all[a].rank
    const chain = [a]
    if (span > 1 && dummies + span - 1 <= maxDummies) {
      let prev = a
      for (let r = all[a].rank + 1; r < all[b].rank; r++) {
        const d: Item = { id: all.length, w: 0, h: 0, rank: r, order: 0, x: 0, dummy: true, up: [prev], down: [] }
        all.push(d)
        all[prev].down.push(d.id)
        chain.push(d.id)
        prev = d.id
        dummies++
      }
      all[prev].down.push(b)
      all[b].up.push(prev)
    } else {
      all[a].down.push(b)
      all[b].up.push(a)
    }
    chain.push(b)
    chains.push(chain)
  }

  let maxRank = 0
  for (const it of all) maxRank = Math.max(maxRank, it.rank)
  const layers: Item[][] = Array.from({ length: maxRank + 1 }, () => [])
  // Initial order: topological discovery (DFS-like) keeps chains together.
  for (const v of topo) layers[items[v].rank].push(items[v])
  for (let i = n; i < all.length; i++) layers[all[i].rank].push(all[i])
  for (const L of layers) L.forEach((it, i) => (it.order = i))

  // 4. Barycenter sweeps.
  const bary = (it: Item, nb: number[]): number => {
    if (!nb.length) return it.order
    let s = 0
    for (const j of nb) s += all[j].order
    return s / nb.length
  }
  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0
    const range = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).slice(0, -1).reverse()
    for (const r of range) {
      const L = layers[r]
      const b = new Map<Item, number>()
      for (const it of L) b.set(it, bary(it, down ? it.up : it.down))
      L.sort((p, q) => b.get(p)! - b.get(q)!)
      L.forEach((it, i) => (it.order = i))
    }
  }

  // 5. Coordinates (x = node centre in TB space).
  const half = (it: Item) => (it.dummy ? 2 : it.w / 2)
  for (const L of layers) {
    let x = 0
    for (const it of L) {
      x += half(it)
      it.x = x
      x += half(it) + nodeGap
    }
  }
  const place = (L: Item[], want: (it: Item) => number) => {
    if (!L.length) return
    const desired = L.map(want)
    // Left-to-right: no overlaps, as close as possible to desired; then right-to-left to balance.
    const xs = desired.slice()
    for (let i = 1; i < L.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + half(L[i - 1]) + nodeGap + half(L[i]))
    const ys = desired.slice()
    for (let i = L.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - half(L[i + 1]) - nodeGap - half(L[i]))
    for (let i = 0; i < L.length; i++) L[i].x = (xs[i] + ys[i]) / 2
    for (let i = 1; i < L.length; i++) L[i].x = Math.max(L[i].x, L[i - 1].x + half(L[i - 1]) + nodeGap + half(L[i]))
  }
  const mean = (it: Item, nb: number[]) => {
    if (!nb.length) return it.x
    let s = 0
    for (const j of nb) s += all[j].x
    return s / nb.length
  }
  for (let s = 0; s < 6; s++) {
    if (s % 2 === 0) for (let r = 1; r < layers.length; r++) place(layers[r], (it) => mean(it, it.up))
    else for (let r = layers.length - 2; r >= 0; r--) place(layers[r], (it) => mean(it, it.down))
  }
  let minX = Infinity
  let maxX = -Infinity
  for (const it of all) {
    minX = Math.min(minX, it.x - half(it))
    maxX = Math.max(maxX, it.x + half(it))
  }
  if (!all.length) minX = maxX = 0
  // Rank y positions from the tallest node of each rank.
  const rankY: number[] = []
  const rankH: number[] = []
  let y = 0
  for (const L of layers) {
    let hmax = 0
    for (const it of L) if (!it.dummy) hmax = Math.max(hmax, it.h)
    rankY.push(y)
    rankH.push(hmax)
    y += hmax + rankGap
  }
  const height = Math.max(0, y - rankGap)
  const width = maxX - minX

  const T = (x: number, yy: number) => (lr ? { x: yy, y: x } : { x, y: yy })
  const result = new Map<string, { x: number; y: number; width: number; height: number; rank: number }>()
  nodes.forEach((nd, i) => {
    const it = items[i]
    const cx = it.x - minX
    const top = rankY[it.rank] + (rankH[it.rank] - it.h) / 2
    const p = T(cx - it.w / 2, top)
    result.set(nd.id, { x: p.x, y: p.y, width: nd.width, height: nd.height, rank: it.rank })
  })
  const centre = (it: Item) => it.x - minX
  const edgeOut: LayoutResult['edges'] = []
  const chainOf = new Map<number, number[]>()
  dag.forEach(([a, b], i) => chainOf.set(key(a, b), chains[i]))
  for (const e of edges) {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    const reversed = back.has(key(a, b))
    const chain = reversed ? [a, b] : (chainOf.get(key(a, b)) ?? [a, b])
    const pts: { x: number; y: number }[] = []
    const A = all[chain[0]]
    const B = all[chain[chain.length - 1]]
    pts.push(T(centre(A), rankY[A.rank] + (rankH[A.rank] + A.h) / 2))
    for (let k = 1; k < chain.length - 1; k++) {
      const d = all[chain[k]]
      pts.push(T(centre(d), rankY[d.rank]), T(centre(d), rankY[d.rank] + rankH[d.rank]))
    }
    pts.push(T(centre(B), rankY[B.rank] + (rankH[B.rank] - B.h) / 2))
    edgeOut.push({ from: e.from, to: e.to, points: pts })
  }
  return { nodes: result, edges: edgeOut, width: lr ? height : width, height: lr ? width : height }
}
