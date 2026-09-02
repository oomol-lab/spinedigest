import { installNodeWikiGraphPlatform } from "../runtime/node-platform.js";

installNodeWikiGraphPlatform();
const { main } = await import("../app/index.js");
import {
  resolveDevProjectRootPath,
  resolveDevStateDirectoryPath,
} from "../runtime/dev-state.js";

void main(
  {
    devProjectRoot: resolveDevProjectRootPath(),
    stateDir: resolveDevStateDirectoryPath(),
  },
  "development",
);
