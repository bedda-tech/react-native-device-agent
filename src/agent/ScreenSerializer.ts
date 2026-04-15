/**
 * Converts the accessibility tree into an LLM-friendly text representation.
 *
 * The serializer flattens the tree into a compact text format that includes
 * node IDs, types, text content, and interactive state -- giving the LLM
 * enough context to decide which element to interact with.
 */

interface A11yNode {
  nodeId?: string;
  className?: string;
  text?: string | null;
  contentDescription?: string | null;
  bounds?: { left: number; top: number; right: number; bottom: number };
  isClickable?: boolean;
  isScrollable?: boolean;
  isEditable?: boolean;
  isFocused?: boolean;
  children?: A11yNode[];
}

export class ScreenSerializer {
  /**
   * Serialize an accessibility tree into a text prompt.
   *
   * Produces output like:
   *   [node:42] Button "Settings" (clickable) bounds(100,200,300,400)
   *   [node:43] EditText "Search..." (editable,focused)
   *
   * @param tree - Raw accessibility tree from react-native-accessibility-controller
   * @returns A text representation suitable for LLM consumption
   */
  static serialize(tree: unknown): string {
    const lines: string[] = ['=== SCREEN STATE ==='];
    ScreenSerializer.walkNode(tree as A11yNode, lines, 0);
    return lines.join('\n');
  }

  /**
   * Create a compact summary of the screen for context windows.
   *
   * When the full tree would exceed maxLength, the summary trims leaf nodes
   * that have no interactive state, favouring clickable/editable elements.
   *
   * @param tree - Raw accessibility tree
   * @param maxLength - Maximum character length of the output (default: 3000)
   * @returns Truncated/summarised screen representation
   */
  static summarize(tree: unknown, maxLength: number = 3000): string {
    const full = ScreenSerializer.serialize(tree);
    if (full.length <= maxLength) return full;

    // Trim: keep only lines with interactive state or non-empty text
    const lines = full.split('\n').filter((line) => {
      return (
        line.startsWith('===') ||
        line.includes('(clickable') ||
        line.includes('(editable') ||
        line.includes('(focused') ||
        line.includes('(scrollable')
      );
    });

    let result = lines.join('\n');
    if (result.length > maxLength) {
      result = result.slice(0, maxLength - 3) + '...';
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private static walkNode(node: A11yNode, lines: string[], depth: number): void {
    if (!node || typeof node !== 'object') return;

    const indent = '  '.repeat(depth);
    const parts: string[] = [];

    // Node ID
    if (node.nodeId) {
      parts.push(`[node:${node.nodeId}]`);
    }

    // Type / class name (simplified)
    const className = ScreenSerializer.shortClassName(node.className);
    if (className) parts.push(className);

    // Display text
    const label = node.text || node.contentDescription;
    if (label) parts.push(`"${label}"`);

    // Interactive flags
    const flags: string[] = [];
    if (node.isClickable) flags.push('clickable');
    if (node.isEditable) flags.push('editable');
    if (node.isScrollable) flags.push('scrollable');
    if (node.isFocused) flags.push('focused');
    if (flags.length > 0) parts.push(`(${flags.join(',')})`);

    // Bounds (compact)
    if (node.bounds) {
      const { left, top, right, bottom } = node.bounds;
      parts.push(`bounds(${left},${top},${right},${bottom})`);
    }

    if (parts.length > 0) {
      lines.push(indent + parts.join(' '));
    }

    // Recurse
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        ScreenSerializer.walkNode(child, lines, depth + 1);
      }
    }
  }

  private static shortClassName(className?: string): string {
    if (!className) return '';
    // Strip package prefix: "android.widget.TextView" -> "TextView"
    const parts = className.split('.');
    return parts[parts.length - 1] ?? className;
  }
}
