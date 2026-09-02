import {
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  SEARCH_INDEX_DATABASE_PATH,
} from "./constants.js";
export function shouldWriteDocumentFile(input: {
  readonly archivePath: string;
}): boolean {
  if (input.archivePath === "manifest.json") {
    return false;
  }
  if (input.archivePath === ".wikg-mutation-token") {
    return false;
  }
  if (input.archivePath === LEGACY_SEARCH_INDEX_DATABASE_PATH) {
    return false;
  }
  if (input.archivePath === SEARCH_INDEX_DATABASE_PATH) {
    return false;
  }

  return true;
}
