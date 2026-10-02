import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

// Installation runs from the board UI through the host import API under the board session, so the worker holds no
// credentials and only reports health.
const plugin = definePlugin({
  async setup() {},
  async onHealth() {
    return { status: "ok", message: "Office templates ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
