// Word-level diff using LCS algorithm
// O(mn) complexity — capped at 5000 tokens for performance

function lcs(a, b) {
  const m = a.length, n = b.length
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const result = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ token: a[i - 1], type: 'unchanged' }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ token: b[j - 1], type: 'added' }); j--
    } else {
      result.unshift({ token: a[i - 1], type: 'removed' }); i--
    }
  }
  return result
}

export function wordDiff(original, rewritten) {
  const origTokens = original.split(/(\s+)/).slice(0, 5000)
  const newTokens = rewritten.split(/(\s+)/).slice(0, 5000)
  return lcs(origTokens, newTokens)
}

export function renderDiffStats(diffResult) {
  const additions = diffResult.filter(d => d.type === 'added').length
  const removals = diffResult.filter(d => d.type === 'removed').length
  const unchanged = diffResult.filter(d => d.type === 'unchanged').length
  const total = additions + removals + unchanged
  return {
    additions,
    removals,
    unchanged,
    change_percentage: total > 0 ? Math.round(((additions + removals) / total) * 100) : 0
  }
}
