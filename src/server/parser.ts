import { ApiLexer, Token, TokenType } from "./lexer";
import {
  ASTNode,
  Program,
  Statement,
  TypedefStatement,
  StructDefinition,
  FieldDefinition,
  ApiDefinition,
  InputStatement,
  OutputStatement,
  ExtractStatement,
  EnumDefinition,
  EnumValue,
  TypeReference,
  Identifier,
  StringLiteral,
  NumberLiteral,
  IncludeStatement,
  SetStatement,
  Comment,
  ApiBodyStatement,
} from "./ast";

export class ParseError extends Error {
  constructor(message: string, public token?: Token) {
    super(message);
    this.name = "ParseError";
  }
}

export class ApiParser {
  private tokens: Token[] = [];
  private current: number = 0;

  constructor(private lexer: ApiLexer) {}

  public parse(text: string): Program {
    this.lexer = new ApiLexer(text);
    this.tokens = this.lexer.tokenize();
    this.current = 0;

    const statements: Statement[] = [];

    while (!this.isAtEnd()) {
      const token = this.peek();

      // 跳过注释和空白
      if (
        this.isComment(token) ||
        token.type === TokenType.WHITESPACE ||
        token.type === TokenType.NEWLINE
      ) {
        this.advance();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
    }

    return {
      type: "Program",
      body: statements,
      start: 0,
      end: this.tokens.length > 0 ? this.tokens[this.tokens.length - 1].end : 0,
      line: 1,
      column: 1,
    };
  }

  private parseStatement(): Statement | null {
    const token = this.peek();

    switch (token.type) {
      case TokenType.TYPEDEF:
        return this.parseTypedefStatement();
      case TokenType.API:
        return this.parseApiDefinition();
      case TokenType.ENUM:
        return this.parseEnumDefinition();
      case TokenType.INCLUDE:
        return this.parseIncludeStatement();
      case TokenType.SET:
        return this.parseSetStatement();
      case TokenType.EOF:
        return null;
      default:
        // 跳过未识别的tokens
        this.advance();
        return null;
    }
  }

  private parseTypedefStatement(): TypedefStatement {
    const start = this.peek();
    this.consume(TokenType.TYPEDEF, "Expected 'typedef'");

    const structDef = this.parseStructDefinition();
    const name = this.parseIdentifier();

    return {
      type: "TypedefStatement",
      structDef,
      name,
      start: start.start,
      end: name.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseStructDefinition(): StructDefinition {
    const start = this.peek();
    this.consume(TokenType.STRUCT, "Expected 'struct'");
    this.consume(TokenType.LEFT_BRACE, "Expected '{'");

    const fields: FieldDefinition[] = [];

    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      // 跳过注释
      if (this.isComment(this.peek())) {
        this.advance();
        continue;
      }

      const field = this.parseFieldDefinition();
      if (field) {
        fields.push(field);
      }
    }

    const end = this.consume(TokenType.RIGHT_BRACE, "Expected '}'");

    return {
      type: "StructDefinition",
      fields,
      start: start.start,
      end: end.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseFieldDefinition(): FieldDefinition | null {
    const start = this.peek();

    // 解析类型
    const fieldType = this.parseTypeReference();
    if (!fieldType) {
      return null;
    }

    // 解析字段名
    const name = this.parseIdentifier();

    // 可选的分号
    if (this.check(TokenType.SEMICOLON)) {
      this.advance();
    }

    return {
      type: "FieldDefinition",
      fieldType,
      name,
      start: start.start,
      end: name.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseApiDefinition(): ApiDefinition {
    const start = this.peek();
    this.consume(TokenType.API, "Expected 'api'");

    const uri = this.parseStringLiteral();
    this.consume(TokenType.LEFT_BRACE, "Expected '{'");

    const body: ApiBodyStatement[] = [];

    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      // 跳过注释
      if (this.isComment(this.peek())) {
        this.advance();
        continue;
      }

      const stmt = this.parseApiBodyStatement();
      if (stmt) {
        body.push(stmt);
      }
    }

    const end = this.consume(TokenType.RIGHT_BRACE, "Expected '}'");

    return {
      type: "ApiDefinition",
      uri,
      body,
      start: start.start,
      end: end.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseApiBodyStatement(): ApiBodyStatement | null {
    const token = this.peek();

    switch (token.type) {
      case TokenType.INPUT:
        return this.parseInputStatement();
      case TokenType.OUTPUT:
        return this.parseOutputStatement();
      case TokenType.EXTRACT:
        return this.parseExtractStatement();
      default:
        this.advance(); // 跳过未识别的tokens
        return null;
    }
  }

  private parseInputStatement(): InputStatement {
    const start = this.peek();
    this.consume(TokenType.INPUT, "Expected 'input'");

    const structRef = this.parseTypeReference();

    return {
      type: "InputStatement",
      structRef,
      start: start.start,
      end: structRef.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseOutputStatement(): OutputStatement {
    const start = this.peek();
    this.consume(TokenType.OUTPUT, "Expected 'output'");

    const structRef = this.parseTypeReference();

    return {
      type: "OutputStatement",
      structRef,
      start: start.start,
      end: structRef.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseExtractStatement(): ExtractStatement {
    const start = this.peek();
    this.consume(TokenType.EXTRACT, "Expected 'extract'");

    const fields: Identifier[] = [];

    do {
      const field = this.parseIdentifier();
      fields.push(field);

      if (this.check(TokenType.COMMA)) {
        this.advance();
      } else {
        break;
      }
    } while (!this.isAtEnd());

    const lastField = fields[fields.length - 1];

    return {
      type: "ExtractStatement",
      fields,
      start: start.start,
      end: lastField ? lastField.end : start.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseEnumDefinition(): EnumDefinition {
    const start = this.peek();
    this.consume(TokenType.ENUM, "Expected 'enum'");

    const name = this.parseIdentifier();
    this.consume(TokenType.LEFT_BRACE, "Expected '{'");

    const values: EnumValue[] = [];

    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      if (this.isComment(this.peek())) {
        this.advance();
        continue;
      }

      const value = this.parseEnumValue();
      if (value) {
        values.push(value);
      }

      if (this.check(TokenType.COMMA)) {
        this.advance();
      }
    }

    const end = this.consume(TokenType.RIGHT_BRACE, "Expected '}'");

    return {
      type: "EnumDefinition",
      name,
      values,
      start: start.start,
      end: end.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseEnumValue(): EnumValue | null {
    const start = this.peek();

    if (!this.check(TokenType.IDENTIFIER)) {
      return null;
    }

    const name = this.parseIdentifier();
    let value: NumberLiteral | undefined;

    if (this.check(TokenType.EQUALS)) {
      this.advance();
      value = this.parseNumberLiteral();
    }

    return {
      type: "EnumValue",
      name,
      value,
      start: start.start,
      end: value ? value.end : name.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseIncludeStatement(): IncludeStatement {
    const start = this.peek();
    this.consume(TokenType.INCLUDE, "Expected '#include'");

    const path = this.parseStringLiteral();

    return {
      type: "IncludeStatement",
      path,
      start: start.start,
      end: path.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseSetStatement(): SetStatement {
    const start = this.peek();
    this.consume(TokenType.SET, "Expected '#set'");

    const name = this.parseIdentifier();
    const value = this.parseStringLiteral();

    return {
      type: "SetStatement",
      name,
      value,
      start: start.start,
      end: value.end,
      line: start.line,
      column: start.column,
    };
  }

  private parseTypeReference(): TypeReference {
    const token = this.peek();

    if (!this.checkType()) {
      throw new ParseError(`Expected type, got ${token.type}`, token);
    }

    const name = token.value;
    const isBuiltin = this.isBuiltinType(token.type);

    this.advance();

    return {
      type: "TypeReference",
      name,
      isBuiltin,
      start: token.start,
      end: token.end,
      line: token.line,
      column: token.column,
    };
  }

  private parseIdentifier(): Identifier {
    const token = this.consume(TokenType.IDENTIFIER, "Expected identifier");

    return {
      type: "Identifier",
      name: token.value,
      start: token.start,
      end: token.end,
      line: token.line,
      column: token.column,
    };
  }

  private parseStringLiteral(): StringLiteral {
    const token = this.consume(
      TokenType.STRING_LITERAL,
      "Expected string literal"
    );

    return {
      type: "StringLiteral",
      value: token.value,
      start: token.start,
      end: token.end,
      line: token.line,
      column: token.column,
    };
  }

  private parseNumberLiteral(): NumberLiteral {
    const token = this.consume(TokenType.NUMBER, "Expected number literal");

    return {
      type: "NumberLiteral",
      value: parseFloat(token.value),
      start: token.start,
      end: token.end,
      line: token.line,
      column: token.column,
    };
  }

  // 辅助方法
  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkType(): boolean {
    const token = this.peek();
    return (
      this.isBuiltinType(token.type) || token.type === TokenType.IDENTIFIER
    );
  }

  private isBuiltinType(type: TokenType): boolean {
    return [
      TokenType.INT,
      TokenType.LONG,
      TokenType.UINT,
      TokenType.ULONG,
      TokenType.BOOL,
      TokenType.FLOAT,
      TokenType.DOUBLE,
      TokenType.STRING,
    ].includes(type);
  }

  private isComment(token: Token): boolean {
    return [
      TokenType.LINE_COMMENT,
      TokenType.BLOCK_COMMENT,
      TokenType.BUILTIN_COMMENT,
    ].includes(token.type);
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();

    const current = this.peek();
    throw new ParseError(
      `${message}. Got ${current.type} at line ${current.line}:${current.column}`,
      current
    );
  }
}
