// 测试增强的格式化功能
import fs from "fs";
import path from "path";

// 增强的格式化函数测试
function formatApiDocument(text) {
  const lines = text.split("\n");
  const formattedLines = [];
  let indentLevel = 0;
  const indentSize = 2; // 使用2个空格缩进
  let currentContext = []; // 跟踪当前上下文

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 处理空行和注释
    if (!line || line.startsWith("//")) {
      formattedLines.push(line);
      continue;
    }

    // 减少缩进的情况
    if (line === "}") {
      indentLevel = Math.max(0, indentLevel - 1);
      currentContext.pop();
    }

    // 添加缩进
    const indent = " ".repeat(indentLevel * indentSize);

    // 特殊处理字段定义 - 进行对齐
    if (isFieldDefinition(line) && isInStructOrEnum(currentContext)) {
      const formattedField = formatFieldDefinition(line, indent);
      formattedLines.push(formattedField);
    } else {
      formattedLines.push(indent + line);
    }

    // 增加缩进的情况
    if (line.endsWith("{")) {
      indentLevel++;
      // 跟踪当前上下文
      if (line.includes("struct")) {
        currentContext.push("struct");
      } else if (line.includes("enum")) {
        currentContext.push("enum");
      } else if (line.includes("apilist")) {
        currentContext.push("apilist");
      } else {
        currentContext.push("block");
      }
    }
  }

  return formattedLines.join("\n");
}

function isFieldDefinition(line) {
  // 检查是否是字段定义
  const fieldPattern = /^[a-zA-Z_][a-zA-Z0-9_]*\s+[a-zA-Z\[\]]+/;
  return (
    fieldPattern.test(line) && !line.includes("{") && !line.includes("typedef")
  );
}

function isInStructOrEnum(context) {
  return (
    context.length > 0 &&
    (context[context.length - 1] === "struct" ||
      context[context.length - 1] === "enum")
  );
}

function formatFieldDefinition(line, indent) {
  // 简单的字段格式化：确保字段名和类型之间有适当的空格
  const parts = line.split(/\s+/);
  if (parts.length >= 2) {
    const fieldName = parts[0];
    const fieldType = parts.slice(1).join(" ");
    return `${indent}${fieldName.padEnd(12)} ${fieldType}`;
  }
  return indent + line;
}

// 读取测试文件
const testFile = "format-test.api";
const content = fs.readFileSync(testFile, "utf8");

console.log("原始内容:");
console.log(content);
console.log("\n增强格式化后:");
console.log(formatApiDocument(content));
