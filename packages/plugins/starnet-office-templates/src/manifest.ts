import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "starnet.office-templates";
export const PAGE_ROUTE = "install-office";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Starnet Office Templates",
  description: "Install a ready-made office (Network/ISP, Software, Marketing, Finance) into the current company in one click. Agents arrive paused and without tool grants; the board turns them on.",
  author: "Starnet",
  categories: ["ui"],
  capabilities: ["ui.page.register", "ui.sidebar.register"],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  ui: {
    slots: [
      { type: "page", id: "install-office-page", displayName: "Install Office", exportName: "InstallOfficePage", routePath: PAGE_ROUTE },
      { type: "sidebar", id: "install-office-link", displayName: "Install Office", exportName: "InstallOfficeSidebarLink" },
    ],
  },
};

export default manifest;
