// A single newline inside a chat message is a line break, as in common chat
// apps. CommonMark folds it into a space, which glued lists written as
// "**A.** ... **B.** ..." onto one line. Only mdast text nodes are touched:
// code, inline code, tables and HTML keep their text exactly as written.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

export function remarkSoftBreaks() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      const children = node.children;
      if (!children) return;
      const next: MdNode[] = [];
      for (const child of children) {
        if (child.type === "text" && child.value?.includes("\n")) {
          const lines = child.value.split("\n");
          lines.forEach((line, index) => {
            if (index > 0) next.push({ type: "break" });
            // Spaces before the newline and indent after it carry no meaning.
            const text = line.replace(index < lines.length - 1 ? /[ \t]+$/ : /^$/, "").replace(index > 0 ? /^[ \t]+/ : /^$/, "");
            if (text) next.push({ type: "text", value: text });
          });
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}
