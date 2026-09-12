---
name: issue-to-pr
description: 把一個 GitHub issue 從認領做到開 PR 的完整流程。當使用者說「處理 issue #N」「做一下 GitHub 上那個需求」「幫我開 PR」「這個 issue 可以做了」，或給了一個 issue 連結／編號時使用。包含分支命名、commit 訊息規範、驗證要求、PR 內容與 issue 狀態同步。
---

# Issue → PR

這個 repo 的需求都走 GitHub issue，改動都走 PR。這份流程把每次都一樣的部分固定下來。

## 前置條件

需要 `gh` CLI 並且已登入：

```bash
gh auth status
```

沒有的話先裝（裝完要 `gh auth login`，選 HTTPS + 瀏覽器登入）：

```bash
winget install --id GitHub.cli
```

**`gh` 不可用就停下來問使用者**，不要改用 git push + 手動開 PR 繞過去——那樣 issue 狀態不會同步。

## 流程

### 1. 讀 issue，確認範圍

```bash
gh issue view <N> --json number,title,body,labels,state,comments
```

範圍不明確就在 issue 上問，不要自己猜：

```bash
gh issue comment <N> --body "想先確認一下：……"
```

### 2. 認領

```bash
gh issue edit <N> --add-assignee @me
gh issue edit <N> --add-label "in progress"     # 標籤不存在就先 gh label create
```

### 3. 開分支

從最新的 main 開，分支名用 `<type>/<issue 編號>-<英文簡述>`：

```bash
git switch main && git pull
git switch -c feat/42-champion-role-winrate
```

type 用 `feat` / `fix` / `perf` / `refactor` / `docs`。

### 4. 實作，然後驗證

**這個 repo 的規矩是：沒有量過的改動不算做完。** 細節看 `verify-change` skill，重點：

- 動到 Cube 模型或指標 → 必須用獨立手寫的 SQL 對過數字
- 動到效能 → 必須有改前／改後的數字
- 動到畫面 → 必須有無頭瀏覽器的截圖，**不要用內嵌的瀏覽器窗格判斷**（它會被節流，圖表會停在 0 寬不畫）

### 5. Commit

一個 commit 講一件事。訊息用中文，格式：

```
<一句話講這個 commit 做了什麼，不要寫 "fix bug">

<為什麼要這樣做。如果是修 bug，寫清楚原本錯在哪、怎麼發現的、
影響是什麼。如果有量過，把數字放進來。>

<試過但沒用、已經還原的做法也寫進來，免得下一個人再走一次。>

Refs #<issue 編號>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

參考既有的 commit（`git log --format=%B -5`）抓語氣。反例與正例：

- ✗ `修正時區問題`
- ✓ `時段分析修掉八小時時差` + 內文說明「同一句 SQL，Python 跑出 55/39/14，Cube 跑出 49/39/20，因為 Cube 的 server 行程跑在 UTC 下」

前端有改的話，`web/dist` 要一起 build 並提交（這個 repo 刻意把建置產物進版控，執行期才不需要 npm）：

```bash
cd web && npm run build && cd ..
```

### 6. 開 PR

```bash
git push -u origin <branch>
gh pr create --fill --body "$(cat <<'EOF'
## 做了什麼

<兩三句>

## 怎麼驗的

<貼實際跑出來的數字／截圖路徑。這段不能空著。>

## 已知限制

<樣本數不足、只在某情境測過、暫時沒解的部分。沒有就寫「無」。>

Closes #<issue 編號>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

`Closes #N` 會讓 PR 合併時自動關掉 issue，所以**不要**再手動關。

### 7. 回報

把 PR 連結給使用者，並說明：改了什麼、怎麼驗的、有什麼還沒解決。

## 常見狀況

**issue 做到一半發現範圍不對**——先在 issue 留言說明，不要默默改範圍。

**一個 issue 牽出另一個問題**——另開 issue，不要塞進同一個 PR：

```bash
gh issue create --title "..." --body "..." --label bug
```

**PR 被要求修改**——在同一個分支繼續 commit 再 push，PR 會自動更新。

**改動需要重啟服務才看得到**——看 `verify-change` skill 的重啟章節，直接 kill 再起會留下孤兒 Cube 行程。
