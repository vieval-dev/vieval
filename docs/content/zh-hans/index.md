---
title: Vieval
titleTemplate: 面向智能体的评测框架
layout: home
theme: dark
home:
  heroTitle: 可靠地评测智能体与模型
  heroDescription: 智能体的行为时好时坏，借助 Vieval，我们可以探索在不同参数、模型、语言下不同的用例是如何工作的，并为下一次改动提供有效支撑。
  primaryAction:
    text: 快速开始
    link: /zh-hans/guide/
  secondaryAction:
    text: 查看 GitHub
    link: https://github.com/vieval-dev/vieval
  terminal:
    title: vieval
    code: |-
      $ pnpm vieval run --report-out .vieval/reports/candidate
      RUN  vieval
      ✓ |desktop-agent| (412 cases)
        cases 407 passed | 5 failed | 0 timeout
      $ pnpm vieval report cases .vieval/reports/candidate --where state=failed
        ✗ chrome/open-settings  exact 0  wrong tab
        ✗ gimp/resize-image  timeout  60m
        ✗ vscode/rename-symbol  exact 0  old name kept
        ✗ calc/sum-column  rubric 0.42  partial
        ✗ chat/refund-policy  rubric 0.31  hallucinated
  blocks:
    eyebrow: 工作方式
    title: 一次编写，处处评测，统一管理用例。
    body: 只跑通一次，说明不了什么。用 Vieval 把同一份评测反复跑、换着参数跑，每个用例为什么通过、为什么失败，都有记录。
    items:
      - eyebrow: 编写
        visual: code
        title: 像写测试一样写评测
        details: 评测就是放在项目里的 TypeScript 文件。准备好一组输入，casesFromInputs 会把每一条变成一个用例，用同一段代码跑完。
      - eyebrow: 展开
        visual: matrix
        title: 一份任务，覆盖所有组合
        details: 在配置里列出要比较的模型和场景，Vieval 会自动排出所有组合；再列出评分标准，每次运行都会按每个标准各评一遍。开跑之前就知道一共要跑多少次。
      - eyebrow: 观察
        visual: trace
        title: 错在哪里？都有得查！
        details: 每一次运行、每一次重试、每一次模型调用都会被记录下来。可以在看板里实时看，也可以导出到 OpenTelemetry。
      - eyebrow: 对比
        visual: compare
        title: 对分数进行横向对比
        details: 报告就是普通文件。挑出两次运行，按类别、按指标对比分数，哪里进步了、哪里退步了，一眼就能看出来。
  usedBy:
    title: 谁在用 Vieval
    adopters:
      - { github: proj-airi, name: Project AIRI }
      - { github: moeru-ai, name: Moeru AI }
    domains:
      - 智能体记忆
      - Computer-use 智能体
      - 工具调用
      - 视觉语言模型
      - 语音智能体
      - 机器人
      - 检索
      - 自我进化的智能体
  capabilities:
    eyebrow: 能力
    title: 评测要用的，这里都有
    learnMore: 了解更多
    items:
      - eyebrow: 生成
        scene: factory
        title: 任意数据源
        summary: Hugging Face、S3、本地文件，拿来就能用。
        details: 不管数据放在 Hugging Face、S3、本地文件里，还是用代码现场生成，都能直接变成用例。数据换了，评测代码不用改；每个用例的 ID 也不会变，方便前后对比。
        link: /zh-hans/guide/learn/tasks-cases-and-inputs
      - eyebrow: 执行
        scene: executors
        title: 任意任务，任意模型
        summary: 聊天、语音、视觉、桌面操作，都能评。
        details: 模型通过插件接入，OpenAI 兼容接口和 Ollama 开箱即用。语音、视觉、机器人这类运行时，也可以自己写一个执行器接进来。
        link: /zh-hans/guide/learn/models-and-inference-executors
      - eyebrow: 调度
        scene: scheduler
        title: 全速并行
        summary: 能并行的都并行，出错了自动重试。
        details: 按需设置并发，让用例尽可能同时跑。接口不稳定就自动重试，调用卡住了到点就停，重复的准备工作直接走缓存，不浪费时间。
        link: /zh-hans/guide/learn/reliable-execution
      - eyebrow: 监控
        scene: monitor
        title: 内置监控看板
        summary: 跑的时候就能看，不用等结束。
        details: 加上 --with-viewer，就能在本地看板里实时看到进度、用例和分数；别的进程正在跑的评测，也能直接打开看。不用注册账号，也不依赖云服务。
        link: /zh-hans/guide/learn/reports-and-comparisons
      - eyebrow: 追踪
        scene: trace
        title: 溯源
        summary: 每个分数都能找到它的出处。
        details: 从一个分数出发，可以一路追到对应的那次尝试、对话记录、截图和指标。分数掉了，直接看原因，不用靠猜。
        link: /zh-hans/guide/learn/reports-and-comparisons
      - eyebrow: 评审
        scene: judge
        title: 模型即评审
        summary: 规则判不了的，交给模型来评。
        details: 能用规则判断的，用 expect 断言；判断不了的，交给另一个模型按评分标准打分。也可以写自己的断言和插件。
        link: /zh-hans/guide/learn/assertions-scores-and-metrics
  openSource:
    eyebrow: 开源
    title: 完全开源，欢迎一起来建设
    body: Vieval 以 MIT 协议开源。感谢我们依赖的每一个项目和组织、和我们一起做评测的大学，以及每一位贡献者。
    contributorsTitle: 贡献者
    action:
      text: 在 GitHub 上 Star
      link: https://github.com/vieval-dev/vieval
    thanks:
      - { github: vitest-dev, name: Vitest }
      - { github: vitejs, name: Vite }
      - { github: voidzero-dev, name: VoidZero }
      - { github: vuejs, name: Vue }
      - { github: unocss, name: UnoCSS }
      - { github: unjs, name: UnJS }
      - { github: juliangarnier, name: anime.js }
      - { github: open-telemetry, name: OpenTelemetry }
      - { github: pnpm, name: pnpm }
      - { github: moeru-ai, name: Moeru AI }
      - { github: proj-airi, name: Project AIRI }
      - { github: lobehub, name: LobeHub }
  footer:
    heading: 开始用 Vieval 做评测
    subheading: 写下第一份评测，换几个模型跑一跑，看看结果有什么不同。
    action:
      text: 快速开始
      link: /zh-hans/guide/
---

<script setup lang="ts">
import Home from '../../.vitepress/theme/Home.vue'
</script>

<Home />
