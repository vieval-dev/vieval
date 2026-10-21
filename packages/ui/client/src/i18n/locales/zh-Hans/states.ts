import type en from '../en/states'

export default {
  ended: '已结束',
  error: '错误',
  errored: '出错',
  failed: '失败',
  interrupted: '已中断',
  ok: '正常',
  passed: '通过',
  queued: '排队中',
  requeued: '重新排队',
  retried: '已重试',
  running: '运行中',
  skipped: '跳过',
  stale: '无响应',
  timeout: '超时',
  unfinished: '未完成',
  unset: '未设置',
  unsupported: '不支持',
} satisfies typeof en
