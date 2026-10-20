import type en from '../en/matrix'

export default {
  groupBars: {
    caseCount: '{n} 个用例',
    groupBy: '分组依据',
    hint: '每组的{measure}，从低到高 · 条形颜色与图表一致 · 点击分组即可选中',
    mean: '平均 {score}',
    passRate: '通过率',
  },
  parallelSets: {
    axisHint: '点击选择 · 拖动标题',
    blockTitle: '{value} · {n} 个用例',
    label: '{n} 个用例在 {axes} 上的平行集合图',
    notSelected: '（未选中）',
    ribbonTitle: '{from} → {to} · {n} 个用例',
  },
  scoreBar: {
    label: '分数：{summary}',
    part: '{score} 分 {count} 个',
  },
  view: {
    all: '全部',
    caseCount: '{n} 个用例',
    coverage: {
      full: '全部用例',
      none: '没有结果',
      other: '其他用例',
      partial: '部分用例',
    },
    deltaTitle: '比上一次完整运行变化 {delta} 个百分点',
    empty: '没有矩阵行',
    emptyHint: '没有任务的运行在这里没有内容可显示。',
    hideSuperseded: '隐藏 {n} 个旧配置',
    intro: '每个组合显示 {n} 次运行中最新的完整运行；部分运行或针对其他用例的运行不会替换它。',
    legendFull: '完整运行',
    legendNone: '没有结果',
    legendPartial: '部分运行或其他用例',
    notRun: '未运行',
    partial: '{total} 个用例中 {measured} 个有结果 · 还没有完整运行',
    pointTitle: '{time} · {coverage}（{total} 个用例中 {measured} 个有结果）· {score} {value} · 完成率 {completion}',
    runCount: '{n} 次运行',
    showSuperseded: '显示 {n} 个旧配置',
    sparkline: '{score}，共 {n} 次运行',
    superseded: '旧配置：较新的运行用其他评测参数衡量了这个入口',
    without: '不含 {axes}',
  },
} satisfies typeof en
