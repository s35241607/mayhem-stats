/** 計算欄位：對查詢回來的聚合結果做運算。
 *
 *  公式語法：數字、[指標標題]、+ - * /、括號，以及幾個函式：
 *    佔比([x])   這一列的 x 佔全部列加總的百分比
 *    排名([x])   x 由大到小的名次（1 是最大）
 *    絕對值(x)、四捨五入(x, 位數)、最大(a, b)、最小(a, b)
 *  函式名稱中英都收（share / rank / abs / round / max / min）。
 *
 *  注意它算的是「聚合之後」的數字：[勝場] / [場次] 是對的（比值的比值），
 *  但把兩個平均相加不等於合起來的平均——需要那種算法就該回語意層加指標。
 *  不用 eval：公式來自使用者輸入、也會存到伺服器給別人開，自己寫一個只認得上面這些東西的解析器。
 *  任何一步遇到 null、除以 0 或非有限數，結果就是 null（畫面上顯示「—」），不會冒出 NaN 或 Infinity。 */

export type Node =
  | { t: "num"; v: number }
  | { t: "ref"; title: string }
  | { t: "neg"; x: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: Node; b: Node }
  | { t: "call"; fn: Fn; args: Node[] }

type Fn = "share" | "rank" | "abs" | "round" | "max" | "min"

const FN_ALIASES: Record<string, Fn> = {
  share: "share", 佔比: "share", 占比: "share",
  rank: "rank", 排名: "rank",
  abs: "abs", 絕對值: "abs",
  round: "round", 四捨五入: "round",
  max: "max", 最大: "max",
  min: "min", 最小: "min",
}
const ARITY: Record<Fn, [number, number]> = { share: [1, 1], rank: [1, 1], abs: [1, 1], round: [1, 2], max: [2, 8], min: [2, 8] }

type Token = { k: "num"; v: number } | { k: "ref"; v: string } | { k: "id"; v: string } | { k: "op"; v: string }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
    } else if (ch === "[" || ch === "［") {
      const end = src.slice(i + 1).search(/[\]］]/)
      if (end < 0) throw new Error("少了右邊的 ]")
      out.push({ k: "ref", v: src.slice(i + 1, i + 1 + end).trim() })
      i += end + 2
    } else if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))
      if (!m) throw new Error(`看不懂的數字：${src.slice(i, i + 6)}`)
      out.push({ k: "num", v: Number(m[0]) })
      i += m[0].length
    } else if ("+-*/(),×÷（），".includes(ch)) {
      out.push({ k: "op", v: { "×": "*", "÷": "/", "（": "(", "）": ")", "，": "," }[ch] ?? ch })
      i++
    } else {
      const m = /^[A-Za-z_一-鿿]+/.exec(src.slice(i))
      if (!m) throw new Error(`看不懂的符號：${ch}`)
      out.push({ k: "id", v: m[0] })
      i += m[0].length
    }
  }
  return out
}

/** 解析公式。語法錯誤丟 Error（訊息是給使用者看的中文） */
export function parse(src: string): Node {
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (v: string) => peek()?.k === "op" && peek().v === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`這裡應該要有 ${v}`)
    pos++
  }

  const primary = (): Node => {
    const t = peek()
    if (!t) throw new Error("公式不完整")
    if (t.k === "num") return pos++, { t: "num", v: t.v }
    if (t.k === "ref") return pos++, { t: "ref", title: t.v }
    if (t.k === "op" && t.v === "(") {
      pos++
      const inner = sum()
      expect(")")
      return inner
    }
    if (t.k === "op" && t.v === "-") return pos++, { t: "neg", x: primary() }
    if (t.k === "id") {
      const fn = FN_ALIASES[t.v.toLowerCase()] ?? FN_ALIASES[t.v]
      if (!fn) throw new Error(`不認得「${t.v}」。指標要用 [ ] 括起來，例如 [場次]`)
      pos++
      expect("(")
      const args: Node[] = []
      if (!isOp(")")) {
        args.push(sum())
        while (isOp(",")) {
          pos++
          args.push(sum())
        }
      }
      expect(")")
      const [lo, hi] = ARITY[fn]
      if (args.length < lo || args.length > hi) throw new Error(`${t.v} 要 ${lo === hi ? lo : `${lo}～${hi}`} 個參數`)
      return { t: "call", fn, args }
    }
    throw new Error(`這裡不該出現 ${t.v}`)
  }
  const product = (): Node => {
    let node = primary()
    while (isOp("*") || isOp("/")) {
      const op = tokens[pos++].v as "*" | "/"
      node = { t: "bin", op, a: node, b: primary() }
    }
    return node
  }
  const sum = (): Node => {
    let node = product()
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].v as "+" | "-"
      node = { t: "bin", op, a: node, b: product() }
    }
    return node
  }

  const root = sum()
  if (pos < tokens.length) throw new Error(`多了看不懂的部分：${String(tokens[pos].v)}`)
  return root
}

/** 公式裡引用了哪些 [標題] */
export function refsOf(node: Node, out: string[] = []): string[] {
  if (node.t === "ref") {
    if (!out.includes(node.title)) out.push(node.title)
  } else if (node.t === "neg") {
    refsOf(node.x, out)
  } else if (node.t === "bin") {
    refsOf(node.a, out)
    refsOf(node.b, out)
  } else if (node.t === "call") {
    node.args.forEach((a) => refsOf(a, out))
  }
  return out
}

const ok = (n: number | null): n is number => n !== null && Number.isFinite(n)

/** 對一整組列算出每一列的值。get(i, title) 取第 i 列某個引用的數字。
 *  佔比與排名要看整組，所以一次算全部而不是一列一列呼叫。 */
export function evaluate(node: Node, count: number, get: (row: number, title: string) => number | null): (number | null)[] {
  const column = (n: Node): (number | null)[] => {
    switch (n.t) {
      case "num":
        return Array.from({ length: count }, () => n.v)
      case "ref":
        return Array.from({ length: count }, (_, i) => {
          const v = get(i, n.title)
          return ok(v) ? v : null
        })
      case "neg":
        return column(n.x).map((v) => (ok(v) ? -v : null))
      case "bin": {
        const a = column(n.a)
        const b = column(n.b)
        return a.map((x, i) => {
          const y = b[i]
          if (!ok(x) || !ok(y)) return null
          const r = n.op === "+" ? x + y : n.op === "-" ? x - y : n.op === "*" ? x * y : y === 0 ? null : x / y
          return ok(r) ? r : null
        })
      }
      case "call": {
        const args = n.args.map(column)
        const [x] = args
        if (n.fn === "share") {
          const total = x.reduce<number>((acc, v) => acc + (ok(v) ? v : 0), 0)
          return x.map((v) => (ok(v) && total !== 0 ? (100 * v) / total : null))
        }
        if (n.fn === "rank") return x.map((v) => (ok(v) ? 1 + x.filter((o) => ok(o) && o > v).length : null))
        if (n.fn === "abs") return x.map((v) => (ok(v) ? Math.abs(v) : null))
        if (n.fn === "round") {
          return x.map((v, i) => {
            const digits = args[1]?.[i] ?? 0
            if (!ok(v) || !ok(digits)) return null
            const f = 10 ** Math.max(0, Math.min(6, Math.round(digits)))
            return Math.round(v * f) / f
          })
        }
        return x.map((_, i) => {
          const vals = args.map((a) => a[i])
          return vals.every(ok) ? (n.fn === "max" ? Math.max(...(vals as number[])) : Math.min(...(vals as number[]))) : null
        })
      }
    }
  }
  return column(node)
}
