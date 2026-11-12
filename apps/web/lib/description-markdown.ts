import { Lexer, Marked, marked, type MarkedExtension, type MarkedOptions, type Token } from "marked";

function preserveUnsupportedTokens(tokens: Token[]) {
  marked.walkTokens(tokens, (token) => {
    if (token.type === "list_item") {
      const itemTokens = token.tokens;
      if (!itemTokens) return;
      const [checkbox, firstBlock] = itemTokens;
      if (checkbox?.type !== "checkbox") return;

      const marker = { type: "text" as const, raw: checkbox.raw, text: checkbox.raw };
      // List items need block children. Put the literal marker in the first
      // paragraph so it stays next to the item text and its inline marks.
      if ((firstBlock?.type === "text" || firstBlock?.type === "paragraph") && firstBlock.tokens) {
        firstBlock.tokens.unshift(marker);
        itemTokens.shift();
      } else {
        itemTokens[0] = { type: "paragraph", raw: checkbox.raw, text: checkbox.raw, tokens: [marker] };
      }
    }
    if (token.type === "table" || (token.type === "html" && token.block)) {
      const literal = token.raw.trimEnd().split("\n").flatMap((line, index) => [
        ...(index ? [{ type: "br", raw: "\n" }] : []),
        { type: "text", raw: line, text: line },
      ]);
      Object.assign(token, { type: "paragraph", tokens: literal });
    } else if (token.type === "html") {
      Object.assign(token, { type: "text", text: token.raw });
    }
  });
}

class DescriptionLexer<ParserOutput = string, RendererOutput = string> extends Lexer<ParserOutput, RendererOutput> {
  override lex(source: string) {
    const tokens = super.lex(source);
    preserveUnsupportedTokens(tokens);
    return tokens;
  }

  override inlineTokens(source: string, tokens?: Token[]) {
    const result = super.inlineTokens(source, tokens);
    preserveUnsupportedTokens(result);
    return result;
  }
}

// The editor uses Marked's lexer directly. Convert HTML tokens to text before
// Tiptap sees them, while preserving literal code and old single line breaks.
export function createDescriptionMarked(): typeof marked {
  const instance = new Marked({ breaks: true, gfm: true });
  const setOptions = (options: MarkedOptions) => {
    instance.setOptions(options);
    parser.defaults = instance.defaults;
    return parser;
  };
  const parser: typeof marked = Object.assign(instance.parse, {
    ...marked,
    parseInline: instance.parseInline,
    Lexer: DescriptionLexer,
    lexer: <ParserOutput = string, RendererOutput = string>(
      source: string,
      options?: MarkedOptions<ParserOutput, RendererOutput>,
    ) => (options ? new DescriptionLexer(options) : new DescriptionLexer(instance.defaults)).lex(source),
    defaults: instance.defaults,
    options: setOptions,
    setOptions,
    use: (...extensions: MarkedExtension[]) => {
      instance.use(...extensions);
      parser.defaults = instance.defaults;
      return parser;
    },
    walkTokens: instance.walkTokens.bind(instance),
  });
  parser.parse = parser;
  return parser;
}
