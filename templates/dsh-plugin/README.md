# @your-scope/dsh-plugin-example

这是由 DSH Desk 生成的最小 DeepSeek Harness plugin bundle。空 patch 可以被安全安装，但不会改变 Harness 行为；添加真实配置前请先阅读与当前固定 DSH 版本一致的官方插件文档。

## 本地验证

```sh
dsh plugin --profile web add file:$PWD
dsh --profile web --dump-config
dsh plugin --profile web why @your-scope/dsh-plugin-example
```

## 发布前检查

- 固定并测试兼容的 DSH 版本；
- 只发布 `files` 中声明的必要文件；
- 避免 `preinstall`、`install`、`postinstall` 和 `prepare`，确有需要时公开解释；
- 文档列出文件、网络、命令和凭据需求；
- `npm pack --dry-run` 检查最终包内容；
- 在全新 `DSH_HOME` 完成 add、dump-config、启动、update 和 remove 回归。

不要把 API Key、测试凭证、用户路径、构建产物或本地 Profile 提交到仓库。
