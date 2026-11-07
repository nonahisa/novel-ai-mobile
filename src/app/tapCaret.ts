/**
 * **押した点から、カーソルを置く字の位置を決める**（B：右傍線の2つの形。字をこの画面が描くので、
 * ブラウザは押した所にカーソルを置いてくれない）。
 *
 * 以前は押した点の下の字（span）だけを見ていた。字の無い所（列の下の端を少し越えた所・行の終わりの
 * 先・列のあいだ）を押すと、字が見つからずカーソルが動かず、**本文全体の末**に残った（2026-11-07 Mac。
 * 列の下を押したのに、カーソルが最後の字の後ろへ飛んだ）。そこで、押した点に**いちばん近い列（横書きは行）**
 * を選び、その中で押した点の位置にカーソルを置く：
 *
 * - 縦書き：押した点の横の位置を含む列。無ければ横にいちばん近い列。その列の字を上から見て、
 *   字の上下のまん中より上を押していればその字の前。どの字よりも下なら、その列の末（改行の前）
 * - 横書き：縦と横を入れ替えたもの
 *
 * ここは DOM に触らない（テストのため）。字の四隅は画面の座標で渡す。
 */

export interface CharBox {
  /** 本文の位置（UTF-16 の単位） */
  i: number;
  /** 字の長さ（サロゲートペアは2） */
  n: number;
  /** 改行の字か（列の末に置くとき、改行の前に置く） */
  newline: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function caretFromPoint(chars: readonly CharBox[], x: number, y: number, vertical: boolean): number | undefined {
  // 字の並ぶ向き（縦書きは上下）と、列の並ぶ向き（縦書きは左右）
  const across = (c: CharBox) => (vertical ? [c.left, c.right] : [c.top, c.bottom]);
  const along = (c: CharBox) => (vertical ? [c.top, c.bottom] : [c.left, c.right]);
  const pAcross = vertical ? x : y;
  const pAlong = vertical ? y : x;
  // 大きさの無い字（改行の字が大きさ0で返る端末がある）も列に数えるが、列を決めるのには使わない
  const visible = chars.filter((c) => c.right > c.left || c.bottom > c.top);
  if (visible.length === 0) return chars.length > 0 ? chars[chars.length - 1].i : undefined;

  // 押した点を含む列。無ければ、いちばん近い列
  const distance = (c: CharBox) => {
    const [a, b] = across(c);
    return pAcross < a ? a - pAcross : pAcross > b ? pAcross - b : 0;
  };
  let nearest = visible[0];
  for (const c of visible) if (distance(c) < distance(nearest)) nearest = c;
  const [colA, colB] = across(nearest);
  const middle = (colA + colB) / 2;
  // 同じ列：列のまん中が、その字の列の幅に入るもの
  const column = chars
    .filter((c) => {
      const [a, b] = across(c);
      return middle >= a - 0.5 && middle <= b + 0.5;
    })
    .sort((p, q) => along(p)[0] - along(q)[0] || p.i - q.i);

  for (const c of column) {
    const [a, b] = along(c);
    if (b <= a && c.newline) continue;
    if (pAlong < (a + b) / 2) return c.i;
  }
  // どの字よりも先（縦書きは下）：その列の末。列が改行で終わっていれば、改行の前
  const last = column[column.length - 1];
  return last.newline ? last.i : last.i + last.n;
}

/** 描いた字（`data-i` の span）の四隅を読む（画面の上で使う） */
export function readCharBoxes(root: ParentNode): CharBox[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-i]")).map((span) => {
    const r = span.getBoundingClientRect();
    return {
      i: Number(span.dataset.i),
      n: Number(span.dataset.n ?? "1"),
      newline: span.textContent === "\n",
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    };
  });
}
