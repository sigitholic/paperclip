import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "starnet.virtual-office";
export const PAGE_ROUTE = "virtual-office";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Starnet Virtual Office",
  description: "Agents as desks with live status derived only from real Paperclip state and events (agent status, runs, current issue, last activity).",
  author: "Starnet",
  categories: ["ui"],
  capabilities: [
    "agents.read",
    "issues.read",
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  ui: {
    slots: [
      { type: "page", id: "virtual-office-page", displayName: "Virtual Office", exportName: "VirtualOfficePage", routePath: PAGE_ROUTE },
      { type: "sidebar", id: "virtual-office-link", displayName: "Virtual Office", exportName: "VirtualOfficeSidebarLink" },
      { type: "dashboardWidget", id: "virtual-office-widget", displayName: "Virtual Office", exportName: "VirtualOfficeWidget" },
    ],
  },
};

export default manifest;
