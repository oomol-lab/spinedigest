#!/usr/bin/env node

import { helloWorld } from "./index.js";

process.stdout.write(`${helloWorld()}\n`);
