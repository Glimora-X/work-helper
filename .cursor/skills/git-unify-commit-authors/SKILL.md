---
name: git-unify-commit-authors
description: >-
  Rewrites Git history so every commit uses a single Author and Committer name
  and email across all refs (including after merges), using git filter-branch,
  then removes refs/original and prunes reflog so git log --all no longer shows
  old identities. Use when the user wants to replace commit authors (e.g. old
  corporate identity), fix mixed authors after pull/merge, or still sees old
  names when using --all.
---

# 统一 Git 提交作者（filter-branch）

## 适用场景

- 把整个仓库（含合并进来的父链）里**所有提交**的 Author / Committer 改成同一套姓名与邮箱。
- 已做过一次重写，但 **`git log --all` 或 `git shortlog --all` 仍出现旧作者**：通常是 **`refs/original/`** 备份引用仍在，或 **merge 拉进了旧 SHA 链**。
- 准备 **force push** 前需要本地历史与远端策略一致。

## 前置条件

- **工作区干净**，或先 **`git stash push --include-untracked`**（`filter-branch` 在脏工作树会拒绝执行）。
- 告知用户：**改写历史会变更所有提交的 SHA**；已推送的远端需 **`git push --force-with-lease`**，协作者需重新对齐分支。

## 执行步骤

1. **确认要写入的身份**（示例占位符，执行时替换为实际值）：

   - `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME`
   - `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL`

2. **对 `--all` 涉及引用重写**（含 `main`、本地 `refs/remotes/origin/*`、若有 `refs/stash` 等）：

```bash
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
export GIT_AUTHOR_NAME="YOUR_NAME"
export GIT_AUTHOR_EMAIL="YOUR_EMAIL"
export GIT_COMMITTER_NAME="YOUR_NAME"
export GIT_COMMITTER_EMAIL="YOUR_EMAIL"
' --tag-name-filter cat -- --all
```

3. **必须删除 `filter-branch` 备份引用**，否则 `git log --all` 仍会遍历到旧提交（旧作者会「复活」）：

```bash
git for-each-ref --format='%(refname)' refs/original/ | xargs -n1 git update-ref -d 2>/dev/null
git reflog expire --expire=now --all
git gc --prune=now
```

4. **验证**（应只剩目标邮箱；`shortlog` 只应有单一作者行）：

```bash
git log --all --format='%ae %an' | sort -u
git shortlog -sne --all
git rev-list --all | while read c; do git log -1 --format='%ae' "$c"; done | sort | uniq -c
```

5. **减少以后再混入旧身份**：在本仓库设置（或让用户自行设置）：

```bash
git config user.name "YOUR_NAME"
git config user.email "YOUR_EMAIL"
```

## 常见原因说明（给助手用）

- **`refs/original/`**：`filter-branch` 默认保留重写前分支尖；`git log --all` 会扫到这些引用，因此会看到旧作者。
- **Merge**：`git pull` 合并远端时，若远端仍是旧作者链，图中会并存两条父链；应对 **`--all` 再跑一次** `env-filter`，把两条链上的对象都改掉。
- **优先用 `git filter-repo` 的用户**：若环境已安装，可改用 `git filter-repo`；本 skill 固定流程以 **`git filter-branch`** 为准（与用户/项目约定一致时）。

## 完成后对用户说明的要点

- 远端更新：`git push --force-with-lease origin <branch>`。
- 若曾 `stash`，注意 `filter-branch` 会改写 `refs/stash`；操作前后与用户对一下是否有未提交改动需恢复。
