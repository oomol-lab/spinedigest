import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyGraphBuildParameterStore,
  ReadonlyMentionLinkStore,
  ReadonlyMentionStore,
  ReadonlyObjectMetadataStore,
} from "../../../document/index.js";

export class EmptySnapshotMentionStore implements ReadonlyMentionStore {
  public countByQid(
    _qid: string,
    _options?: { readonly chapterId?: number },
  ): Promise<number> {
    return Promise.resolve(0);
  }

  public getById(_mentionId: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public listAll(): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listByQid(
    _qid: string,
    _options?: {
      readonly chapterId?: number;
      readonly limit?: number;
      readonly offset?: number;
      readonly order?: "asc" | "desc";
    },
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listLabelsByQid(
    _qid: string,
    _options?: { readonly chapterId?: number },
  ): Promise<string[]> {
    return Promise.resolve([]);
  }

  public listBySurfaceTerms(
    _terms: readonly string[],
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listBySurfaces(
    _surfaces: readonly string[],
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listByChapter(_chapterId: number): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }
}

export class EmptySnapshotMentionLinkStore implements ReadonlyMentionLinkStore {
  public countByTriple(_input: {
    readonly chapterId?: number;
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<number> {
    return Promise.resolve(0);
  }

  public getById(_linkId: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public listAll(): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }

  public listByTriple(_input: {
    readonly chapterId?: number;
    readonly limit?: number;
    readonly offset?: number;
    readonly order?: "asc" | "desc";
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }

  public listByChapter(_chapterId: number): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }
}

export class EmptySnapshotObjectMetadataStore implements ReadonlyObjectMetadataStore {
  public getMap(
    _objectPath: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    return Promise.resolve({});
  }
}

export class EmptySnapshotGraphBuildParameterStore implements ReadonlyGraphBuildParameterStore {
  public getByHash(_hash: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}
