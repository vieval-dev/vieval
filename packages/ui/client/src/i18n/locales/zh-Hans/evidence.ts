import type en from '../en/evidence'

export default {
  files: {
    empty: '证据目录为空',
    filter: '筛选文件…',
    label: '证据文件',
    truncated: '列表已在 {n} 项处停止。',
  },
  frameCaption: '{purpose} · AUV 运行 {run}',
  link: '第 {round} 轮 · {file}',
  logs: {
    empty: '没有关联的日志行',
    emptyHint: '已在 {n} 个日志文件中搜索键 {keys}',
    loadMore: '加载更多（剩余 {n} 行）',
    matched: '在 {files} 中匹配到 {n} 行 · Pod {pods} · 时间窗口 {from}–{to}',
  },
  noRecords: '这个回合中没有 {file}',
  noScreenshots: '{dir} 中没有截图',
  notReadable: {
    kind: '它是一个 {kind}',
    missing: '这台机器上不存在该路径',
    title: '无法读取证据：{reason}。',
  },
  steps: {
    columns: {
      command: '命令',
      screenshot: '截图',
      status: '状态',
      target: '输入 / 目标',
    },
    empty: '{file} 中没有智能体步骤',
    openFrame: '打开第 {n} 帧',
    screenshotOf: '第 {n} 步的截图',
  },
  tabs: {
    commandLogs: '命令日志',
    files: '文件',
    label: '证据视图',
    logs: '日志',
    records: 'AUV 记录',
    screenshots: '截图',
    steps: '步骤',
  },
  title: '外部证据',
} satisfies typeof en
