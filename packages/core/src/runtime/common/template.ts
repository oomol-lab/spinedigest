import { getWikiGraphPlatform } from "../platform/index.js";
import type { HostTemplateEnvironment } from "../platform/index.js";

const JINJA_EXTENSION_PATTERN = /\.jinja$/iu;
const LEADING_DOT_SEGMENT_PATTERN = /^\.+\//u;
const LEADING_SLASH_PATTERN = /^\/+/u;

export function createEnv(
  _legacyDataDirectory?: string,
  options: {
    readonly autoescape?: boolean;
    readonly trimBlocks?: boolean;
  } = {},
): HostTemplateEnvironment {
  const environment = getWikiGraphPlatform().templates.createEnvironment({
    autoescape: options.autoescape ?? true,
    trimBlocks: options.trimBlocks ?? true,
  });
  return {
    render: (templateName, context) =>
      environment.render(normalizeTemplateName(templateName), context),
  };
}

export function normalizeTemplateName(templateName: string): string {
  if (LEADING_DOT_SEGMENT_PATTERN.test(templateName)) {
    throw new Error(`invalid template name ${templateName}`);
  }
  const withoutLeadingSlash = templateName.replace(LEADING_SLASH_PATTERN, "");
  const withoutExtension = withoutLeadingSlash.replace(
    JINJA_EXTENSION_PATTERN,
    "",
  );
  if (withoutExtension.split("/").includes("..")) {
    throw new Error(`invalid template name ${templateName}`);
  }
  return `${withoutExtension}.jinja`;
}
