# websum

一个基于 Chrome Manifest V3 的网页总结扩展。  
在 Side Panel 中一键总结当前页面正文，支持 OpenAI 兼容 API 与 Kimi 免 Key 双模式。

## 功能

- 双提供商并存
  - `OpenAI 兼容 API`（`API Base URL + API Key + model`）
  - `Kimi（免 Key）`（通过 Kimi 网页登录态 token）
- 支持调用 `GET /v1/models` 拉取 OpenAI 兼容模型列表
- 支持 5 个默认总结模板 + 自定义系统提示词（最多 2000 字符）
- 总结结果支持 Markdown / GFM 渲染
- 自动保存最近 10 条总结历史（含提供商信息）
- 支持浅色/深色/跟随系统主题

## 技术栈

- TypeScript
- React
- Vite
- `@crxjs/vite-plugin`

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物在 `dist/` 目录。

## Chrome 加载方式

1. 打开 `chrome://extensions`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目下的 `dist` 目录

## 使用说明

### OpenAI 兼容模式

1. 打开扩展 Side Panel，进入“设置”
2. 提供商选择 `OpenAI 兼容`
3. 填写 `API 地址 / API Key / 模型`
4. 可点击“拉取模型”，或手动输入模型名
5. 保存设置后回到“总结”页执行总结

### Kimi 免 Key 模式

1. 打开扩展 Side Panel，进入“设置”
2. 提供商选择 `Kimi（免 Key）`
3. 点击“连接 Kimi”
4. 在打开的 `https://www.kimi.com/` 页面完成登录
5. 回到扩展，保存设置后即可在“总结”页直接使用

## Kimi 模式行为说明

- 自动读取登录态：无本地 token 时，会尝试自动读取 Kimi 网页 `localStorage.refresh_token`
- 本地持久化：token 保存在本地 `chrome.storage.local`
- 失效处理：遇到 401/登录态失效时会清理 token 并提示  
  `登录状态失效，请重新连接 Kimi`
- 不会自动回退到 OpenAI：需要用户主动重连 Kimi
- 智能混合策略：
  - 普通页面优先走文本直发
  - 视频/PDF/arXiv 链接优先走文件上传+解析
  - 文件路径失败时自动回退文本模式

## 历史记录兼容

- 新记录会保存 `provider` 字段（`openai` 或 `kimi_web`）
- 旧记录没有 `provider` 时默认按 `openai` 展示

## 风险提示（重要）

- Kimi 模式依赖 Kimi 网页接口与网页登录态实现
- 若 Kimi 官方网页接口或字段变化（如 `refresh_token`、接口路径），功能可能失效
- 当前实现定位为本地自用，不以 Chrome 商店公开发布为目标

## 已知限制

- `chrome://`、`chrome-extension://` 等受限页面无法提取正文
- 不同 OpenAI 兼容服务商返回字段可能有差异
- 当前仅支持 Chrome
