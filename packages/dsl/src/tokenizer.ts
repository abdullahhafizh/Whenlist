export type TokenKind =
  | "IDENT"
  | "INT"
  | "STRING"
  | "OP"
  | "AND"
  | "OR"
  | "NOT"
  | "LPAREN"
  | "RPAREN"
  | "LBRACK"
  | "RBRACK"
  | "LBRACE"
  | "RBRACE"
  | "COMMA"
  | "DOTDOT"
  | "SEMICOLON"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "BETWEEN"
  | "IN"
  | "CHECKED"
  | "NOT_CHECKED"
  | "WEEKEND"
  | "LET"
  | "FN"
  | "ASSIGN"
  | "EOF";

export type Token = {
  kind: TokenKind;
  value: string;
  /** 0-based char offset in source */
  pos: number;
};

export class TokenizeError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(`${message} at position ${pos}`);
    this.name = "TokenizeError";
  }
}

const KEYWORDS: Record<string, TokenKind> = {
  between: "BETWEEN",
  in: "IN",
  checked: "CHECKED",
  notchecked: "NOT_CHECKED",
  weekend: "WEEKEND",
  let: "LET",
  fn: "FN",
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  const peek = (offset = 0) => input[i + offset] ?? "";
  const advance = () => input[i++];

  while (i < n) {
    const ch = peek();
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    const pos = i;

    if (ch === "(") {
      advance();
      tokens.push({ kind: "LPAREN", value: "(", pos });
      continue;
    }
    if (ch === ")") {
      advance();
      tokens.push({ kind: "RPAREN", value: ")", pos });
      continue;
    }
    if (ch === "{") {
      advance();
      tokens.push({ kind: "LBRACE", value: "{", pos });
      continue;
    }
    if (ch === "}") {
      advance();
      tokens.push({ kind: "RBRACE", value: "}", pos });
      continue;
    }
    if (ch === "[") {
      advance();
      tokens.push({ kind: "LBRACK", value: "[", pos });
      continue;
    }
    if (ch === "]") {
      advance();
      tokens.push({ kind: "RBRACK", value: "]", pos });
      continue;
    }
    if (ch === ",") {
      advance();
      tokens.push({ kind: "COMMA", value: ",", pos });
      continue;
    }
    if (ch === ";") {
      advance();
      tokens.push({ kind: "SEMICOLON", value: ";", pos });
      continue;
    }
    if (ch === "+") {
      advance();
      tokens.push({ kind: "PLUS", value: "+", pos });
      continue;
    }
    if (ch === "*") {
      advance();
      tokens.push({ kind: "STAR", value: "*", pos });
      continue;
    }
    if (ch === "/") {
      advance();
      tokens.push({ kind: "SLASH", value: "/", pos });
      continue;
    }
    if (ch === "!" && peek(1) !== "=") {
      advance();
      tokens.push({ kind: "NOT", value: "!", pos });
      continue;
    }
    if (ch === "&" && peek(1) === "&") {
      i += 2;
      tokens.push({ kind: "AND", value: "&&", pos });
      continue;
    }
    if (ch === "|" && peek(1) === "|") {
      i += 2;
      tokens.push({ kind: "OR", value: "||", pos });
      continue;
    }
    if (ch === "." && peek(1) === ".") {
      i += 2;
      tokens.push({ kind: "DOTDOT", value: "..", pos });
      continue;
    }

    if (ch === "=" || ch === "!" || ch === ">" || ch === "<") {
      let op = advance();
      if (peek() === "=") op += advance();
      if (op === "=") {
        tokens.push({ kind: "ASSIGN", value: "=", pos });
        continue;
      }
      if (!["==", "!=", ">=", "<=", ">", "<"].includes(op)) {
        throw new TokenizeError(`Unexpected operator '${op}'`, pos);
      }
      tokens.push({ kind: "OP", value: op, pos });
      continue;
    }

    if (ch === '"') {
      advance();
      let value = "";
      while (i < n && peek() !== '"') {
        if (peek() === "\\") {
          advance();
          const esc = advance();
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === '"' || esc === "\\") value += esc;
          else value += esc;
        } else {
          value += advance();
        }
      }
      if (peek() !== '"') {
        throw new TokenizeError("Unterminated string", pos);
      }
      advance();
      tokens.push({ kind: "STRING", value, pos });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let num = "";
      while (/[0-9]/.test(peek())) num += advance();
      tokens.push({ kind: "INT", value: num, pos });
      continue;
    }

    if (ch === "-") {
      advance();
      tokens.push({ kind: "MINUS", value: "-", pos });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (/[a-zA-Z0-9_]/.test(peek())) ident += advance();
      const lower = ident.toLowerCase();
      const kw = KEYWORDS[lower];
      if (kw) {
        tokens.push({ kind: kw, value: lower, pos });
      } else {
        tokens.push({ kind: "IDENT", value: lower, pos });
      }
      continue;
    }

    throw new TokenizeError(`Unexpected character '${ch}'`, pos);
  }

  tokens.push({ kind: "EOF", value: "", pos: n });
  return tokens;
}
