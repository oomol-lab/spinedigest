import { nodeWikiGraphPlatform } from "../packages/cli/src/runtime/node-platform.js";
import { installWikiGraphPlatform } from "../packages/core/src/runtime/platform/index.js";

installWikiGraphPlatform(nodeWikiGraphPlatform);
