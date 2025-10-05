// AST 节点基类
export interface ASTNode {
  type: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

// 程序根节点
export interface Program extends ASTNode {
  type: "Program";
  body: Statement[];
}

// 语句基类
export interface Statement extends ASTNode {}

// Typedef语句
export interface TypedefStatement extends Statement {
  type: "TypedefStatement";
  structDef?: StructDefinition;
  enumDef?: EnumDefinition;
  name: Identifier;
}

// 结构体定义
export interface StructDefinition extends ASTNode {
  type: "StructDefinition";
  fields: FieldDefinition[];
}

// 字段定义
export interface FieldDefinition extends ASTNode {
  type: "FieldDefinition";
  fieldType: TypeReference;
  name: Identifier;
  comment?: string;
}

// API定义
export interface ApiDefinition extends Statement {
  type: "ApiDefinition";
  uri: StringLiteral;
  body: ApiBodyStatement[];
}

// API体语句
export interface ApiBodyStatement extends ASTNode {}

// Input语句
export interface InputStatement extends ApiBodyStatement {
  type: "InputStatement";
  structRef: TypeReference;
}

// Output语句
export interface OutputStatement extends ApiBodyStatement {
  type: "OutputStatement";
  structRef: TypeReference;
}

// Extract语句
export interface ExtractStatement extends ApiBodyStatement {
  type: "ExtractStatement";
  fields: Identifier[];
}

// 枚举定义
export interface EnumDefinition extends Statement {
  type: "EnumDefinition";
  name: Identifier;
  values: EnumValue[];
}

// 枚举值
export interface EnumValue extends ASTNode {
  type: "EnumValue";
  name: Identifier;
  value?: NumberLiteral;
}

// 类型引用
export interface TypeReference extends ASTNode {
  type: "TypeReference";
  name: string;
  isBuiltin: boolean;
}

// 标识符
export interface Identifier extends ASTNode {
  type: "Identifier";
  name: string;
}

// 字符串字面量
export interface StringLiteral extends ASTNode {
  type: "StringLiteral";
  value: string;
}

// 数字字面量
export interface NumberLiteral extends ASTNode {
  type: "NumberLiteral";
  value: number;
}

// Include语句
export interface IncludeStatement extends Statement {
  type: "IncludeStatement";
  path: StringLiteral;
}

// Set语句
export interface SetStatement extends Statement {
  type: "SetStatement";
  name: Identifier;
  value: StringLiteral;
}

// 注释节点
export interface Comment extends ASTNode {
  type: "Comment";
  commentType: "line" | "block" | "builtin";
  value: string;
}

// 访问者模式接口
export interface ASTVisitor<T = void> {
  visitProgram?(node: Program): T;
  visitTypedefStatement?(node: TypedefStatement): T;
  visitStructDefinition?(node: StructDefinition): T;
  visitFieldDefinition?(node: FieldDefinition): T;
  visitApiDefinition?(node: ApiDefinition): T;
  visitInputStatement?(node: InputStatement): T;
  visitOutputStatement?(node: OutputStatement): T;
  visitExtractStatement?(node: ExtractStatement): T;
  visitEnumDefinition?(node: EnumDefinition): T;
  visitEnumValue?(node: EnumValue): T;
  visitTypeReference?(node: TypeReference): T;
  visitIdentifier?(node: Identifier): T;
  visitStringLiteral?(node: StringLiteral): T;
  visitNumberLiteral?(node: NumberLiteral): T;
  visitIncludeStatement?(node: IncludeStatement): T;
  visitSetStatement?(node: SetStatement): T;
  visitComment?(node: Comment): T;
}

// AST遍历函数
export function walkAST<T>(
  node: ASTNode,
  visitor: ASTVisitor<T>
): T | undefined {
  switch (node.type) {
    case "Program":
      const program = node as Program;
      if (visitor.visitProgram) {
        return visitor.visitProgram(program);
      }
      break;

    case "TypedefStatement":
      const typedef = node as TypedefStatement;
      if (visitor.visitTypedefStatement) {
        return visitor.visitTypedefStatement(typedef);
      }
      break;

    case "StructDefinition":
      const struct = node as StructDefinition;
      if (visitor.visitStructDefinition) {
        return visitor.visitStructDefinition(struct);
      }
      break;

    case "FieldDefinition":
      const field = node as FieldDefinition;
      if (visitor.visitFieldDefinition) {
        return visitor.visitFieldDefinition(field);
      }
      break;

    case "ApiDefinition":
      const api = node as ApiDefinition;
      if (visitor.visitApiDefinition) {
        return visitor.visitApiDefinition(api);
      }
      break;

    case "InputStatement":
      const input = node as InputStatement;
      if (visitor.visitInputStatement) {
        return visitor.visitInputStatement(input);
      }
      break;

    case "OutputStatement":
      const output = node as OutputStatement;
      if (visitor.visitOutputStatement) {
        return visitor.visitOutputStatement(output);
      }
      break;

    case "ExtractStatement":
      const extract = node as ExtractStatement;
      if (visitor.visitExtractStatement) {
        return visitor.visitExtractStatement(extract);
      }
      break;

    case "EnumDefinition":
      const enumDef = node as EnumDefinition;
      if (visitor.visitEnumDefinition) {
        return visitor.visitEnumDefinition(enumDef);
      }
      break;

    case "EnumValue":
      const enumValue = node as EnumValue;
      if (visitor.visitEnumValue) {
        return visitor.visitEnumValue(enumValue);
      }
      break;

    case "TypeReference":
      const typeRef = node as TypeReference;
      if (visitor.visitTypeReference) {
        return visitor.visitTypeReference(typeRef);
      }
      break;

    case "Identifier":
      const identifier = node as Identifier;
      if (visitor.visitIdentifier) {
        return visitor.visitIdentifier(identifier);
      }
      break;

    case "StringLiteral":
      const stringLit = node as StringLiteral;
      if (visitor.visitStringLiteral) {
        return visitor.visitStringLiteral(stringLit);
      }
      break;

    case "NumberLiteral":
      const numberLit = node as NumberLiteral;
      if (visitor.visitNumberLiteral) {
        return visitor.visitNumberLiteral(numberLit);
      }
      break;

    case "IncludeStatement":
      const include = node as IncludeStatement;
      if (visitor.visitIncludeStatement) {
        return visitor.visitIncludeStatement(include);
      }
      break;

    case "SetStatement":
      const set = node as SetStatement;
      if (visitor.visitSetStatement) {
        return visitor.visitSetStatement(set);
      }
      break;

    case "Comment":
      const comment = node as Comment;
      if (visitor.visitComment) {
        return visitor.visitComment(comment);
      }
      break;
  }

  return undefined;
}
