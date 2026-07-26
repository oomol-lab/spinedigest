import { main } from "../app/index.js";
import { resolveDevStateDirectoryPath } from "../runtime/dev-state.js";

void main(
  {
    stateDir: resolveDevStateDirectoryPath(),
  },
  "development",
);
