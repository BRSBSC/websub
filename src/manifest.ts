import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "网页总结助手",
  version: "0.1.0",
  description: "一键总结当前网页正文，支持多模板与自定义提示词。",
  minimum_chrome_version: "114",
  permissions: ["storage", "activeTab", "scripting", "sidePanel", "tabs"],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  action: {
    default_title: "网页总结助手"
  },
  side_panel: {
    default_path: "src/sidepanel/index.html"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/extract.ts"],
      run_at: "document_idle"
    }
  ]
};

export default manifest;
