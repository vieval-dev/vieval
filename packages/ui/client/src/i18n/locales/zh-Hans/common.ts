import type en from '../en/common'

export default {
  cellDetails: '单元格详情',
  choice: {
    description: '选择一项；信息按钮可以预览每个选项的效果',
    details: '预览 {choice}',
    use: '使用 {choice}',
  },
  close: '关闭',
  empty: '暂无内容',
  loading: '加载中…',
  notFound: '未找到',
  open: '打开',
  requestFailed: '请求失败',
  requestFailedStatus: '请求失败（{status}）',
  retry: '重试',
  serverUnreachable: '无法连接查看器服务',
} satisfies typeof en
