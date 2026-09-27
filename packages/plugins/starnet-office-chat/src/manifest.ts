import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "starnet.office-chat";
export const PAGE_ROUTE = "office-chat";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Starnet Office Chat",
  description: "Company chat with the office. Requests become Paperclip issues assigned to the right agent; agent comments and status flow back into the thread.",
  author: "Starnet",
  categories: ["automation", "ui"],
  capabilities: [
    "agents.read",
    "issues.read",
    "issues.create",
    "issues.wakeup",
    "issue.comments.read",
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "ui.page.register",
    "ui.sidebar.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  ui: {
    slots: [
      { type: "page", id: "office-chat-page", displayName: "Office Chat", exportName: "OfficeChatPage", routePath: PAGE_ROUTE },
      { type: "sidebar", id: "office-chat-link", displayName: "Office Chat", exportName: "OfficeChatSidebarLink" },
    ],
  },
};

export default manifest;
