import { describe, expect, it } from "vitest";

import {
  formatLocatedWikiGraphUri,
  formatWikiGraphCommandUri,
  formatWikiGraphObjectUri,
  parseLocatedWikiGraphUri,
  parseWikiGraphUriSyntax,
} from "../../../../packages/core/src/runtime/common/wiki-graph/uri.js";

describe("wiki graph URI helpers", () => {
  it("formats located URIs with URL path separators", () => {
    expect(
      formatLocatedWikiGraphUri(
        String.raw`C:\books\book.wikg`,
        formatWikiGraphObjectUri("entity/Q9957"),
      ),
    ).toBe("wikg://C:/books/book.wikg/entity/Q9957");
  });

  it("keeps command URI locators host-neutral", () => {
    expect(
      formatWikiGraphCommandUri(
        "/workspace/books/book.wikg",
        formatWikiGraphObjectUri("entity/Q9957"),
        "/workspace",
      ),
    ).toBe("wikg:///workspace/books/book.wikg/entity/Q9957");
  });

  it("formats command URIs with absolute paths outside cwd", () => {
    expect(
      formatWikiGraphCommandUri(
        "/other/books/book.wikg",
        formatWikiGraphObjectUri("entity/Q9957"),
        "/workspace",
      ),
    ).toBe("wikg:///other/books/book.wikg/entity/Q9957");
  });

  it("formats relative command URI archive paths against the provided cwd", () => {
    expect(
      formatWikiGraphCommandUri(
        "books/book.wikg",
        formatWikiGraphObjectUri("entity/Q9957"),
        "/workspace",
      ),
    ).toBe("wikg://books/book.wikg/entity/Q9957");
  });

  it("preserves host-specific archive locator syntax", () => {
    expect(
      parseLocatedWikiGraphUri("wikg://~/Downloads/book.wikg/chapter/1"),
    ).toStrictEqual({
      archivePath: "~/Downloads/book.wikg",
      objectUri: "wikg://chapter/1",
    });
    expect(parseLocatedWikiGraphUri("wikg:///tmp/~/book.wikg")).toStrictEqual({
      archivePath: "/tmp/~/book.wikg",
    });
    expect(parseLocatedWikiGraphUri("wikg://~user/book.wikg")).toStrictEqual({
      archivePath: "~user/book.wikg",
    });
  });

  it("parses Wiki Graph URI syntax before business classification", () => {
    expect(parseWikiGraphUriSyntax("wikg://lib")).toStrictEqual({
      protocol: "wikg",
      path: ["lib"],
    });
    expect(parseWikiGraphUriSyntax("wikg://lib/")).toStrictEqual({
      protocol: "wikg",
      path: ["lib"],
    });
    expect(
      parseWikiGraphUriSyntax("wikg://lib/arc/a/entity/Q1#1..5"),
    ).toStrictEqual({
      fragment: { begin: 1, end: 5 },
      protocol: "wikg",
      path: ["lib", "arc", "a", "entity", "Q1"],
    });
    expect(
      parseWikiGraphUriSyntax("wikg:///file/path/to.wikg/entity/Q1#12"),
    ).toStrictEqual({
      fragment: 12,
      protocol: "wikg",
      path: ["/", "file", "path", "to.wikg", "entity", "Q1"],
    });
    expect(
      parseWikiGraphUriSyntax(
        `wikg://artifact/${"a".repeat(64)}#epubcfi(/6/2!/4/2)`,
      ),
    ).toStrictEqual({
      fragment: { raw: "epubcfi(/6/2!/4/2)" },
      protocol: "wikg",
      path: ["artifact", "a".repeat(64)],
    });
    expect(
      parseWikiGraphUriSyntax(
        `wikg://artifact/${"a".repeat(12)}#epubcfi(/6/2!/4/2)`,
      ),
    ).toStrictEqual({
      fragment: { raw: "epubcfi(/6/2!/4/2)" },
      protocol: "wikg",
      path: ["artifact", "a".repeat(12)],
    });
    expect(() => parseWikiGraphUriSyntax("wikg://lib//arc")).toThrow(
      "empty path segment",
    );
  });

  it("normalizes located URI object paths through the syntax parser", () => {
    expect(
      parseLocatedWikiGraphUri("wikg://book.wikg/entity/Q1/"),
    ).toStrictEqual({
      archivePath: "book.wikg",
      objectUri: "wikg://entity/Q1",
    });
    expect(
      parseLocatedWikiGraphUri("wikg:///file/path/to.wikg/entity/Q1#12"),
    ).toStrictEqual({
      archivePath: "/file/path/to.wikg",
      objectUri: "wikg://entity/Q1#12",
    });
    expect(
      parseLocatedWikiGraphUri(
        "wikg://lib/arc/archive123/chapter/part/source#1..5",
      ),
    ).toStrictEqual({
      archivePath: "wikg://lib/arc/archive123",
      objectUri: "wikg://chapter/part/source#1..5",
    });
    expect(
      parseLocatedWikiGraphUri(
        `wikg:///file/book.wikg/artifact/${"b".repeat(64)}#page=2&bbox=0,0,1,1`,
      ),
    ).toStrictEqual({
      archivePath: "/file/book.wikg",
      objectUri: `wikg://artifact/${"b".repeat(64)}#page=2&bbox=0,0,1,1`,
    });
    expect(
      parseLocatedWikiGraphUri(
        `wikg://lib/arc/archive123/artifact/${"b".repeat(12)}#page=2&bbox=0,0,1,1`,
      ),
    ).toStrictEqual({
      archivePath: "wikg://lib/arc/archive123",
      objectUri: `wikg://artifact/${"b".repeat(12)}#page=2&bbox=0,0,1,1`,
    });
  });
});
