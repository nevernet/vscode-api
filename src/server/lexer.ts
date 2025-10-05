// Token 类型枚举
export enum TokenType {
  // 关键字
  TYPEDEF = "typedef",
  STRUCT = "struct",
  API = "api",
  ENUM = "enum",
  INPUT = "input",
  OUTPUT = "output",
  EXTRACT = "extract",
  EXTENDS = "extends",
  IMPLEMENTS = "implements",
  PATCH = "patch",
  APILIST = "apilist",
  INCLUDE = "#include",
  SET = "#set",

  // 基础类型
  INT = "int",
  LONG = "long",
  UINT = "uint",
  ULONG = "ulong",
  BOOL = "bool",
  FLOAT = "float",
  DOUBLE = "double",
  STRING = "string",

  // 常量
  GET = "GET",
  SET_CONST = "SET",

  // 字面量
  IDENTIFIER = "identifier",
  NUMBER = "number",
  STRING_LITERAL = "string_literal",

  // 符号
  LEFT_BRACE = "{",
  RIGHT_BRACE = "}",
  LEFT_PAREN = "(",
  RIGHT_PAREN = ")",
  LEFT_BRACKET = "[",
  RIGHT_BRACKET = "]",
  SEMICOLON = ";",
  COMMA = ",",
  EQUALS = "=",

  // 注释
  LINE_COMMENT = "line_comment",
  BLOCK_COMMENT = "block_comment",
  BUILTIN_COMMENT = "builtin_comment",

  // 特殊
  EOF = "eof",
  NEWLINE = "newline",
  WHITESPACE = "whitespace",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

export class ApiLexer {
  private text: string;
  private position: number = 0;
  private line: number = 1;
  private column: number = 1;

  // 关键字映射
  private keywords = new Map<string, TokenType>([
    ["typedef", TokenType.TYPEDEF],
    ["struct", TokenType.STRUCT],
    ["api", TokenType.API],
    ["enum", TokenType.ENUM],
    ["input", TokenType.INPUT],
    ["output", TokenType.OUTPUT],
    ["extract", TokenType.EXTRACT],
    ["extends", TokenType.EXTENDS],
    ["implements", TokenType.IMPLEMENTS],
    ["patch", TokenType.PATCH],
    ["apilist", TokenType.APILIST],
    ["#include", TokenType.INCLUDE],
    ["#set", TokenType.SET],
    ["int", TokenType.INT],
    ["long", TokenType.LONG],
    ["uint", TokenType.UINT],
    ["ulong", TokenType.ULONG],
    ["bool", TokenType.BOOL],
    ["float", TokenType.FLOAT],
    ["double", TokenType.DOUBLE],
    ["string", TokenType.STRING],
    ["GET", TokenType.GET],
    ["SET", TokenType.SET_CONST],
  ]);

  constructor(text: string) {
    this.text = text;
  }

  private currentChar(): string {
    if (this.position >= this.text.length) {
      return "";
    }
    return this.text[this.position];
  }

  private peekChar(offset: number = 1): string {
    const pos = this.position + offset;
    if (pos >= this.text.length) {
      return "";
    }
    return this.text[pos];
  }

  private advance(): void {
    if (this.position < this.text.length) {
      if (this.text[this.position] === "\n") {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.position++;
    }
  }

  private skipWhitespace(): void {
    while (this.position < this.text.length && /\s/.test(this.currentChar())) {
      this.advance();
    }
  }

  private readString(): Token {
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    this.advance(); // 跳过开始的引号

    let value = "";
    while (this.position < this.text.length && this.currentChar() !== '"') {
      if (this.currentChar() === "\\") {
        this.advance();
        if (this.position < this.text.length) {
          value += this.currentChar();
          this.advance();
        }
      } else {
        value += this.currentChar();
        this.advance();
      }
    }

    if (this.currentChar() === '"') {
      this.advance(); // 跳过结束的引号
    }

    return {
      type: TokenType.STRING_LITERAL,
      value,
      line: startLine,
      column: startColumn,
      start,
      end: this.position,
    };
  }

  private readNumber(): Token {
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    let value = "";

    // 处理十六进制数
    if (
      this.currentChar() === "0" &&
      (this.peekChar() === "x" || this.peekChar() === "X")
    ) {
      value += this.currentChar();
      this.advance();
      value += this.currentChar();
      this.advance();

      while (/[0-9a-fA-F]/.test(this.currentChar())) {
        value += this.currentChar();
        this.advance();
      }
    } else {
      // 处理十进制数
      while (/[0-9]/.test(this.currentChar())) {
        value += this.currentChar();
        this.advance();
      }

      // 处理小数点
      if (this.currentChar() === ".") {
        value += this.currentChar();
        this.advance();

        while (/[0-9]/.test(this.currentChar())) {
          value += this.currentChar();
          this.advance();
        }
      }
    }

    return {
      type: TokenType.NUMBER,
      value,
      line: startLine,
      column: startColumn,
      start,
      end: this.position,
    };
  }

  private readIdentifier(): Token {
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    let value = "";

    // 处理以#开头的标识符 (#include, #set)
    if (this.currentChar() === "#") {
      value += this.currentChar();
      this.advance();
    }

    while (
      this.position < this.text.length &&
      /[a-zA-Z0-9_]/.test(this.currentChar())
    ) {
      value += this.currentChar();
      this.advance();
    }

    const tokenType = this.keywords.get(value) || TokenType.IDENTIFIER;

    return {
      type: tokenType,
      value,
      line: startLine,
      column: startColumn,
      start,
      end: this.position,
    };
  }

  private readLineComment(): Token {
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    let value = "";
    this.advance(); // /
    this.advance(); // /

    while (this.position < this.text.length && this.currentChar() !== "\n") {
      value += this.currentChar();
      this.advance();
    }

    return {
      type: TokenType.LINE_COMMENT,
      value,
      line: startLine,
      column: startColumn,
      start,
      end: this.position,
    };
  }

  private readBlockComment(): Token {
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    let value = "";
    this.advance(); // /
    this.advance(); // *

    while (this.position < this.text.length) {
      if (this.currentChar() === "*" && this.peekChar() === "/") {
        this.advance(); // *
        this.advance(); // /
        break;
      }
      value += this.currentChar();
      this.advance();
    }

    return {
      type: TokenType.BLOCK_COMMENT,
      value,
      line: startLine,
      column: startColumn,
      start,
      end: this.position,
    };
  }

  private readBuiltinComment(): Token {
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    let value = "";
    this.advance(); // [
    this.advance(); // [

    while (this.position < this.text.length) {
      if (this.currentChar() === "]" && this.peekChar() === "]") {
        this.advance(); // ]
        this.advance(); // ]
        break;
      }
      value += this.currentChar();
      this.advance();
    }

    return {
      type: TokenType.BUILTIN_COMMENT,
      value,
      line: startLine,
      column: startColumn,
      start,
      end: this.position,
    };
  }

  public nextToken(): Token {
    this.skipWhitespace();

    if (this.position >= this.text.length) {
      return {
        type: TokenType.EOF,
        value: "",
        line: this.line,
        column: this.column,
        start: this.position,
        end: this.position,
      };
    }

    const char = this.currentChar();
    const start = this.position;
    const startLine = this.line;
    const startColumn = this.column;

    // 字符串字面量
    if (char === '"') {
      return this.readString();
    }

    // 数字
    if (/[0-9]/.test(char)) {
      return this.readNumber();
    }

    // 标识符和关键字
    if (/[a-zA-Z_#]/.test(char)) {
      return this.readIdentifier();
    }

    // 注释
    if (char === "/" && this.peekChar() === "/") {
      return this.readLineComment();
    }

    if (char === "/" && this.peekChar() === "*") {
      return this.readBlockComment();
    }

    // 内置注释
    if (char === "[" && this.peekChar() === "[") {
      return this.readBuiltinComment();
    }

    // 单字符tokens
    this.advance();
    switch (char) {
      case "{":
        return {
          type: TokenType.LEFT_BRACE,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case "}":
        return {
          type: TokenType.RIGHT_BRACE,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case "(":
        return {
          type: TokenType.LEFT_PAREN,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case ")":
        return {
          type: TokenType.RIGHT_PAREN,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case "[":
        return {
          type: TokenType.LEFT_BRACKET,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case "]":
        return {
          type: TokenType.RIGHT_BRACKET,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case ";":
        return {
          type: TokenType.SEMICOLON,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case ",":
        return {
          type: TokenType.COMMA,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      case "=":
        return {
          type: TokenType.EQUALS,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
      default:
        // 未知字符，作为标识符处理
        return {
          type: TokenType.IDENTIFIER,
          value: char,
          line: startLine,
          column: startColumn,
          start,
          end: this.position,
        };
    }
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    let token: Token;

    do {
      token = this.nextToken();
      tokens.push(token);
    } while (token.type !== TokenType.EOF);

    return tokens;
  }
}
