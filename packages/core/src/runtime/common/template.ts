import { Environment, Loader, type LoaderSource } from "nunjucks";
import { getWikiGraphPlatform } from "../platform/index.js";

const JINJA_EXTENSION_PATTERN = /\.jinja$/iu;
const LEADING_DOT_SEGMENT_PATTERN = /^\.+\//u;
const LEADING_SLASH_PATTERN = /^\/+/u;

export function createEnv(
  _legacyDataDirectory?: string,
  options: {
    readonly autoescape?: boolean;
    readonly trimBlocks?: boolean;
  } = {},
): Environment {
  return new Environment(new HostTemplateLoader(), {
    autoescape: options.autoescape ?? true,
    trimBlocks: options.trimBlocks ?? true,
  });
}

class HostTemplateLoader extends Loader {
  public getSource(templateName: string): LoaderSource {
    const name = normalizeTemplateName(templateName);
    const template = getWikiGraphPlatform().templates.get(name);
    return { noCache: false, path: name, src: template.source };
  }
}

function normalizeTemplateName(templateName: string): string {
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
