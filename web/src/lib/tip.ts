/** 提示文字的排版標記。內容仍是一個字串（放在 data-tip），要上色、強調的地方包成 {{種類|文字}}：
 *    big 大數字｜n 數字｜win／loss 勝敗色｜mute 次要文字｜rank 名次小標｜lv 等級標籤（顏色查 tipLevelClass）
 *    tagwin／tagmute 小標籤
 *  行首的記號決定這一行怎麼排：
 *    {{lab|勝率}}…  左邊一欄放小標籤、右邊放內容（一組「項目」）
 *    > …           接在上一個項目下面的補充（次要色、小一點）
 *    -- …          最後一行的操作提示（上面一條分隔線、結尾一個箭頭）
 *  沒有任何標記的純文字提示照舊：第一行夠短當標題，其餘每行一段；「標題：說明」的標題會加粗。 */
export const tipLevelClass: Record<string, string> = {}
export const MARK = /\{\{(\w+)\|([^}]*)\}\}/g
/** 拿掉標記，給 aria-label、SVG 的 <title> 這種只吃純文字的地方 */
export const stripTip = (t: string) =>
  t
    .replace(MARK, (_, kind: string, text: string) => (kind === "lab" ? `${text} ` : kind === "rank" ? `${text}・` : text))
    .replace(/^(?:> |-- )/gm, "")
