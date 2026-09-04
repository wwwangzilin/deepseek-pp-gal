#!/usr/bin/env node
import { main } from '../packages/shell-host/lib/installer.mjs';

main().catch((err) => {
  console.error(`\nInstall failed: ${err.message}`);
  process.exit(1);
});
