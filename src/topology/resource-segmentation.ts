import type { FragmentGroupRecord } from "../model/index.js";
import type { FragmentInfo } from "./fragment-incision.js";

interface FragmentResource {
  readonly count: number;
  readonly startIncision: number;
  readonly endIncision: number;
  readonly fragmentId: number;
}

interface FragmentSegment {
  readonly count: number;
  readonly resources: readonly FragmentResource[];
}

interface SegmentNode {
  readonly level: number;
  readonly count: number;
  readonly startIncision: number;
  readonly endIncision: number;
  readonly children: readonly SegmentNodeChild[];
}

type SegmentItem = FragmentResource | FragmentSegment;
type SegmentNodeChild = FragmentResource | SegmentNode;

export function createFragmentGroups(input: {
  fragmentInfos: readonly FragmentInfo[];
  groupTokensCount: number;
  serialId: number;
}): FragmentGroupRecord[] {
  if (input.fragmentInfos.length === 0) {
    return [];
  }

  const resources = input.fragmentInfos.map(
    (fragmentInfo): FragmentResource => ({
      count: fragmentInfo.tokenCount,
      endIncision: fragmentInfo.endIncision,
      fragmentId: fragmentInfo.fragmentId,
      startIncision: fragmentInfo.startIncision,
    }),
  );
  const groups = allocateFragmentGroups(resources, input.groupTokensCount);

  return groups.flatMap((fragmentIds, groupId) =>
    fragmentIds.map((fragmentId) => ({
      fragmentId,
      groupId,
      serialId: input.serialId,
    })),
  );
}

function allocateFragmentGroups(
  resources: readonly FragmentResource[],
  maxCount: number,
): number[][] {
  const items = allocateSegments(resources, 0, maxCount);
  const groups: number[][] = [];
  let currentGroup: FragmentResource[] = [];
  let currentCount = 0;

  for (const item of items) {
    if (currentGroup.length > 0 && currentCount + item.count > maxCount) {
      groups.push(currentGroup.map((resource) => resource.fragmentId));
      currentGroup = [];
      currentCount = 0;
    }

    if (isFragmentSegment(item)) {
      currentGroup.push(...item.resources);
      currentCount += item.count;
      continue;
    }

    currentGroup.push(item);
    currentCount += item.count;
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup.map((resource) => resource.fragmentId));
  }

  return groups;
}

function allocateSegments(
  resources: readonly FragmentResource[],
  borderIncision: number,
  maxCount: number,
): SegmentItem[] {
  const stream = new FragmentResourceStream(resources);
  const segment = collectSegment(
    stream,
    borderIncision,
    Number.MAX_SAFE_INTEGER,
  );
  const items: SegmentItem[] = [];

  for (const item of segment.children) {
    if (isSegmentNode(item)) {
      for (const childSegment of splitSegmentIfNeeded(item, maxCount)) {
        items.push(transformSegment(childSegment));
      }
      continue;
    }

    items.push(item);
  }

  return items;
}

function collectSegment(
  stream: FragmentResourceStream,
  borderIncision: number,
  level: number,
): SegmentNode {
  let startIncision = borderIncision;
  let endIncision = borderIncision;
  const children: SegmentNodeChild[] = [];

  while (true) {
    const resource = stream.get();

    if (resource === undefined) {
      break;
    }

    if (children.length === 0) {
      startIncision = resource.startIncision;
      children.push(resource);
      continue;
    }

    const previous = children[children.length - 1];

    if (previous === undefined) {
      break;
    }

    const incisionLevel = getEndIncision(previous) + resource.startIncision;

    if (incisionLevel > level) {
      stream.recover(resource);
      endIncision = resource.endIncision;
      break;
    }

    if (incisionLevel < level) {
      stream.recover(resource);
      stream.recover(getLastResource(previous));
      const lastChild = children.pop();

      if (lastChild === undefined) {
        break;
      }

      const nested = collectSegment(stream, borderIncision, incisionLevel);

      children.push({
        children: [lastChild, ...nested.children],
        count: nested.count,
        endIncision: nested.endIncision,
        level: nested.level,
        startIncision: nested.startIncision,
      });
      continue;
    }

    children.push(resource);
  }

  return {
    children,
    count: children.reduce((total, child) => total + child.count, 0),
    endIncision,
    level,
    startIncision,
  };
}

function* splitSegmentIfNeeded(
  segment: SegmentNode,
  maxCount: number,
): Generator<SegmentNode> {
  if (segment.count <= maxCount) {
    yield segment;
    return;
  }

  let count = 0;
  let children: SegmentNodeChild[] = [];

  for (const item of unfoldSegments(segment, maxCount)) {
    if (children.length > 0 && count + item.count > maxCount) {
      yield createSegmentNode(count, children, segment.level);
      count = 0;
      children = [];
    }

    count += item.count;
    children.push(item);
  }

  if (children.length > 0) {
    yield createSegmentNode(count, children, segment.level);
  }
}

function* unfoldSegments(
  segment: SegmentNode,
  maxCount: number,
): Generator<SegmentNodeChild> {
  for (const item of segment.children) {
    if (isSegmentNode(item) && item.count > maxCount) {
      yield* splitSegmentIfNeeded(item, maxCount);
      continue;
    }

    yield item;
  }
}

function transformSegment(segment: SegmentNode): SegmentItem {
  const resources = [...deepIterSegment(segment)];

  if (resources.length === 1) {
    const resource = resources[0];

    if (resource === undefined) {
      throw new Error("Segment resources cannot be empty");
    }

    return resource;
  }

  return {
    count: segment.count,
    resources,
  };
}

function* deepIterSegment(segment: SegmentNode): Generator<FragmentResource> {
  for (const child of segment.children) {
    if (isSegmentNode(child)) {
      yield* deepIterSegment(child);
      continue;
    }

    yield child;
  }
}

function createSegmentNode(
  count: number,
  children: readonly SegmentNodeChild[],
  level: number,
): SegmentNode {
  const firstChild = children[0];
  const lastChild = children[children.length - 1];

  if (firstChild === undefined || lastChild === undefined) {
    throw new Error("Segment node children cannot be empty");
  }

  return {
    children: [...children],
    count,
    endIncision: getEndIncision(lastChild),
    level,
    startIncision: getStartIncision(firstChild),
  };
}

function getLastResource(item: SegmentNodeChild): FragmentResource {
  if (!isSegmentNode(item)) {
    return item;
  }

  const lastChild = item.children[item.children.length - 1];

  if (lastChild === undefined) {
    throw new Error("Segment node children cannot be empty");
  }

  return getLastResource(lastChild);
}

function getEndIncision(item: SegmentNodeChild): number {
  return isSegmentNode(item) ? item.endIncision : item.endIncision;
}

function getStartIncision(item: SegmentNodeChild): number {
  return isSegmentNode(item) ? item.startIncision : item.startIncision;
}

function isFragmentSegment(item: SegmentItem): item is FragmentSegment {
  return "resources" in item;
}

function isSegmentNode(item: SegmentNodeChild): item is SegmentNode {
  return "children" in item;
}

class FragmentResourceStream {
  readonly #buffer: FragmentResource[] = [];
  #index = 0;
  readonly #resources: readonly FragmentResource[];

  public constructor(resources: readonly FragmentResource[]) {
    this.#resources = resources;
  }

  public get(): FragmentResource | undefined {
    if (this.#buffer.length > 0) {
      return this.#buffer.pop();
    }

    const resource = this.#resources[this.#index];

    if (resource === undefined) {
      return undefined;
    }

    this.#index += 1;

    return resource;
  }

  public recover(resource: FragmentResource): void {
    this.#buffer.push(resource);
  }
}
