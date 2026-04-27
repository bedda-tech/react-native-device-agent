import { ScreenSerializer } from '../src/agent/ScreenSerializer';

const makeNode = (overrides: object = {}) => ({
  nodeId: '1',
  className: 'android.widget.Button',
  text: 'OK',
  contentDescription: null,
  bounds: { left: 0, top: 0, right: 100, bottom: 50 },
  isClickable: true,
  isScrollable: false,
  isEditable: false,
  isFocused: false,
  children: [],
  ...overrides,
});

describe('ScreenSerializer.serialize', () => {
  it('starts with the screen state header', () => {
    const result = ScreenSerializer.serialize(makeNode());
    expect(result.startsWith('=== SCREEN STATE ===')).toBe(true);
  });

  it('includes the node ID', () => {
    const result = ScreenSerializer.serialize(makeNode({ nodeId: '42' }));
    expect(result).toContain('[node:42]');
  });

  it('strips the package prefix from className', () => {
    const result = ScreenSerializer.serialize(makeNode({ className: 'android.widget.TextView' }));
    expect(result).toContain('TextView');
    expect(result).not.toContain('android.widget.');
  });

  it('includes the node text', () => {
    const result = ScreenSerializer.serialize(makeNode({ text: 'Submit' }));
    expect(result).toContain('"Submit"');
  });

  it('falls back to contentDescription when text is null', () => {
    const node = makeNode({ text: null, contentDescription: 'Close button' });
    const result = ScreenSerializer.serialize(node);
    expect(result).toContain('"Close button"');
  });

  it('includes clickable flag', () => {
    const result = ScreenSerializer.serialize(makeNode({ isClickable: true }));
    expect(result).toContain('clickable');
  });

  it('includes editable and focused flags', () => {
    const node = makeNode({ isEditable: true, isFocused: true, isClickable: false });
    const result = ScreenSerializer.serialize(node);
    expect(result).toContain('editable');
    expect(result).toContain('focused');
  });

  it('includes scrollable flag', () => {
    const node = makeNode({ isScrollable: true, isClickable: false });
    const result = ScreenSerializer.serialize(node);
    expect(result).toContain('scrollable');
  });

  it('includes checked flag for checked nodes', () => {
    const node = makeNode({ isChecked: true, isClickable: false });
    const result = ScreenSerializer.serialize(node);
    expect(result).toContain('checked');
  });

  it('includes disabled flag when isEnabled is false', () => {
    const node = makeNode({ isEnabled: false, isClickable: false });
    const result = ScreenSerializer.serialize(node);
    expect(result).toContain('disabled');
  });

  it('does not include disabled flag when isEnabled is true', () => {
    const node = makeNode({ isEnabled: true, isClickable: false });
    const result = ScreenSerializer.serialize(node);
    expect(result).not.toContain('disabled');
  });

  it('includes bounds', () => {
    const node = makeNode({ bounds: { left: 10, top: 20, right: 200, bottom: 80 } });
    const result = ScreenSerializer.serialize(node);
    expect(result).toContain('bounds(10,20,200,80)');
  });

  it('serializes children with indentation', () => {
    const node = makeNode({
      nodeId: 'parent',
      children: [makeNode({ nodeId: 'child', text: 'Child Text' })],
    });
    const result = ScreenSerializer.serialize(node);
    const lines = result.split('\n');
    const childLine = lines.find((l) => l.includes('[node:child]'));
    expect(childLine).toBeDefined();
    expect(childLine).toMatch(/^ {2}/);
  });

  it('handles deeply nested children', () => {
    const grandchild = makeNode({ nodeId: 'gc', text: 'Deep' });
    const child = makeNode({ nodeId: 'child', children: [grandchild] });
    const root = makeNode({ nodeId: 'root', children: [child] });
    const result = ScreenSerializer.serialize(root);
    const lines = result.split('\n');
    const gcLine = lines.find((l) => l.includes('[node:gc]'));
    expect(gcLine).toBeDefined();
    expect(gcLine).toMatch(/^ {4}/);
  });

  it('handles null/undefined gracefully', () => {
    expect(() => ScreenSerializer.serialize(null)).not.toThrow();
    expect(() => ScreenSerializer.serialize(undefined)).not.toThrow();
    const result = ScreenSerializer.serialize(null);
    expect(result).toBe('=== SCREEN STATE ===');
  });

  it('skips node fields that are absent', () => {
    const minimal = { children: [] };
    const result = ScreenSerializer.serialize(minimal);
    expect(result).toBe('=== SCREEN STATE ===');
  });
});

describe('ScreenSerializer.summarize', () => {
  it('returns full output when under maxLength', () => {
    const node = makeNode({ text: 'Short' });
    const full = ScreenSerializer.serialize(node);
    const summary = ScreenSerializer.summarize(node, 10000);
    expect(summary).toBe(full);
  });

  it('truncates to maxLength when over limit', () => {
    const node = makeNode({
      text: 'A'.repeat(5000),
      children: Array.from({ length: 50 }, (_, i) =>
        makeNode({ nodeId: String(i), text: 'Item ' + i, isClickable: false })
      ),
    });
    const summary = ScreenSerializer.summarize(node, 200);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith('...')).toBe(true);
  });

  it('keeps interactive elements when trimming', () => {
    const children = [
      makeNode({ nodeId: 'plain', text: 'Plain text', isClickable: false }),
      makeNode({ nodeId: 'btn', text: 'Click me', isClickable: true }),
    ];
    const root = makeNode({ children, isClickable: false, text: null });
    const summary = ScreenSerializer.summarize(root, 100);
    expect(summary).toContain('[node:btn]');
  });
});
