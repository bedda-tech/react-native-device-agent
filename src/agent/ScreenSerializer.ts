/**
 * Converts the accessibility tree into an LLM-friendly text representation.
 *
 * The serializer flattens the tree into a compact text format that includes
 * node IDs, types, text content, and interactive state -- giving the LLM
 * enough context to decide which element to interact with.
 */
export class ScreenSerializer {
  /**
   * Serialize an accessibility tree into a text prompt.
   *
   * @param tree - Raw accessibility tree from react-native-accessibility-controller
   * @returns A text representation suitable for LLM consumption
   */
  static serialize(_tree: unknown): string {
    throw new Error('Not implemented: ScreenSerializer.serialize');
  }

  /**
   * Create a compact summary of the screen for context windows.
   *
   * @param tree - Raw accessibility tree
   * @param maxLength - Maximum character length of the output
   * @returns Truncated/summarised screen representation
   */
  static summarize(_tree: unknown, _maxLength?: number): string {
    throw new Error('Not implemented: ScreenSerializer.summarize');
  }
}
