#!/usr/bin/env node
import { ApiLexer } from "../dist/server/lexer.js";
import { ApiParser } from "../dist/server/parser.js";

console.log("=== Inline Struct Test ===");

// 测试内联结构体语法
const inlineTest = `
apilist "test" {
    api "inline" {
        input struct {
            id number
            name string
        }
        output struct {
            success boolean
            data struct {
                result string
            }
        }
    }
}
`;

console.log("Testing inline struct...");

try {
  const lexer = new ApiLexer(inlineTest);
  const parser = new ApiParser(lexer);

  console.log("Created lexer and parser");
  const ast = parser.parse(inlineTest);
  console.log("✅ Inline struct parsing successful!");
  console.log(`Parsed ${ast.body.length} statements`);
} catch (error) {
  console.error("❌ Inline struct parsing failed:");
  console.error(error.message);
  if (error.token) {
    console.error(
      `At line ${error.token.line}, column ${error.token.column}: "${error.token.value}"`
    );
  }
  console.error("Full error:", error);
}

console.log("\n=== Test completed ===");
