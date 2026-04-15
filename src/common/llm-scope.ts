export enum SpineDigestScope {
  EditorCompress = "serial-generation/editor-compress",
  EditorReview = "serial-generation/editor-review",
  EditorReviewGuide = "serial-generation/editor-review-guide",
  ReaderChoice = "serial-generation/reader-choice",
  ReaderExtraction = "serial-generation/reader-extraction",
}

export const SPINE_DIGEST_SCOPES = Object.freeze([
  SpineDigestScope.EditorCompress,
  SpineDigestScope.EditorReview,
  SpineDigestScope.EditorReviewGuide,
  SpineDigestScope.ReaderChoice,
  SpineDigestScope.ReaderExtraction,
] as const);

export const SPINE_DIGEST_EDITOR_SCOPES = Object.freeze({
  compress: SpineDigestScope.EditorCompress,
  review: SpineDigestScope.EditorReview,
  reviewGuide: SpineDigestScope.EditorReviewGuide,
});

export const SPINE_DIGEST_READER_SCOPES = Object.freeze({
  choice: SpineDigestScope.ReaderChoice,
  extraction: SpineDigestScope.ReaderExtraction,
});
