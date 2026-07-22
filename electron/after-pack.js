// electron-builder's `extraResources` copy goes through its own glob/filter
// machinery, which was silently stripping the standalone build's nested
// node_modules (the app shipped without `next` itself inside it — every
// launch failed with "Cannot find module 'next'"). This hook runs after
// packaging and copies the standalone build over by hand with plain
// fs.cpSync, byte for byte, bypassing whatever electron-builder was filtering.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  const dest = path.join(context.appOutDir, "resources", "standalone");

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });

  const nextPkgExists = fs.existsSync(path.join(dest, "node_modules", "next"));
  console.log(`[after-pack] copied standalone build to ${dest} (node_modules/next present: ${nextPkgExists})`);
  if (!nextPkgExists) {
    throw new Error("[after-pack] node_modules/next is still missing after the manual copy — aborting build.");
  }
};
