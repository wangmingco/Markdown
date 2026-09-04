import { marked } from 'marked';

// Shared marked configuration used by both the live preview (main.js) and the
// image exporter (export.js). Keep marked.setOptions / marked.use in one place
// so both render identically.
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Preserve $$...$$ block math as a single token so `breaks: true` doesn't
// split multi-line formulas or drop the $$ delimiters.
const blockMathExtension = {
  name: 'blockMath',
  level: 'block',
  start(src) { return src.match(/^\$\$/) ? 0 : -1; },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: 'blockMath', raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    return `<div class="math-display">$$${token.text}$$</div>`;
  },
};
marked.use({ extensions: [blockMathExtension] });

export default marked;