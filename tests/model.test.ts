import { describe, expect, it } from 'vitest';
import { MODEL_TEXT, renderModel } from '../src/ui/model.ts';

describe('the Model view', () => {
  it('renders headings, paragraphs, lists and the comparison table from the text', () => {
    const html = renderModel();
    expect(html).toContain('<h1>How geografia works</h1>');
    expect((html.match(/<h2>/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Earth</th>');
    expect(html).toContain('<ul><li>');
    expect(html).toContain('<strong>Slab pull and break-off.</strong>');
    expect(html).not.toContain('**');
    expect(MODEL_TEXT).toContain('Budyko');
  });

  it('escapes markup in the text and keeps inline code', () => {
    expect(renderModel('a <b> & `c`')).toBe('<p>a &lt;b&gt; &amp; <code>c</code></p>');
    expect(renderModel('| x | y |\n|---|---|\n| 1 | 2 |')).toBe('<table><thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  });
});
