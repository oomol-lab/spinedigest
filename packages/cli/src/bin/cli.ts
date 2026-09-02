#!/usr/bin/env node

import { installNodeWikiGraphPlatform } from "../runtime/node-platform.js";

installNodeWikiGraphPlatform();
const { main } = await import("../app/index.js");

void main();
