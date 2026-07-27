export interface RenderTreeNode {
  readonly children: readonly RenderTreeNode[];
  readonly label: string;
}

export function renderTreeText(nodes: readonly RenderTreeNode[]): string {
  const lines = formatTreeNodes(nodes);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function formatTreeNodes(
  nodes: readonly RenderTreeNode[],
  prefix = "",
): readonly string[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1;
    const branch = last ? "└─ " : "├─ ";
    const childPrefix = `${prefix}${last ? "   " : "│  "}`;

    return [
      `${prefix}${branch}${node.label}`,
      ...formatTreeNodes(node.children, childPrefix),
    ];
  });
}
