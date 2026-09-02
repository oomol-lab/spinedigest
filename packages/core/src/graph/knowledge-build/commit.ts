import type { Document } from "../../document/index.js";
import {
  collectChapterKnowledgeGraphObjects,
  readWikgObjectsFromJsonl,
} from "../../object-stream.js";
import { replaceChapterFtsIndexArtifact } from "../../retrieval/index-artifact/index.js";
import { validateChapterKnowledgeGraphArtifact } from "./artifact-io.js";
import type { ChapterKnowledgeGraphBuildArtifact } from "./types.js";

export async function commitChapterKnowledgeGraphArtifact(
  document: Document,
  artifact: ChapterKnowledgeGraphBuildArtifact,
): Promise<void> {
  const objects = await collectChapterKnowledgeGraphObjects(
    artifact.chapterId,
    readWikgObjectsFromJsonl(artifact.objectsFile),
  );
  const mentions = objects.mentions;
  const mentionLinks = objects.mentionLinks;
  const parameter = objects.parameter ?? artifact.parameter;

  validateChapterKnowledgeGraphArtifact(artifact.chapterId, {
    mentionLinks,
    mentions,
  });

  await document.openSession(async (openedDocument) => {
    await openedDocument.serials.ensure(artifact.chapterId);
    const existingLinks = await openedDocument.mentionLinks.listByChapter(
      artifact.chapterId,
    );
    const hadFtsArtifact =
      (await openedDocument.indexArtifacts.get(artifact.chapterId, "fts")) !==
      undefined;

    if (existingLinks.length > 0 && mentionLinks.length === 0) {
      throw new Error(
        `Refusing to replace chapter ${artifact.chapterId} knowledge graph with an artifact that contains no mention links.`,
      );
    }

    await openedDocument.clearSerialKnowledgeGraph(artifact.chapterId);
    await openedDocument.mentions.saveMany(mentions);
    await openedDocument.mentionLinks.saveMany(mentionLinks);
    const savedParameter =
      await openedDocument.graphBuildParameters.save(parameter);
    await openedDocument.serials.setKnowledgeGraphReady(
      artifact.chapterId,
      true,
      savedParameter.hash,
    );
    if (hadFtsArtifact) {
      await replaceChapterFtsIndexArtifact(openedDocument, artifact.chapterId);
    }
  });
}

export async function clearChapterKnowledgeGraph(
  document: Document,
  chapterId: number,
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.clearSerialKnowledgeGraph(chapterId);
  });
}
