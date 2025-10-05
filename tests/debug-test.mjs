#!/usr/bin/env node
import { ApiLexer } from "../dist/server/lexer.js";
import { ApiParser } from "../dist/server/parser.js";

console.log("=== Simple Parser Test ===");

// 测试简单的语法
const simpleTest = `
typedef struct {
    id number
    name string
} User
`;

console.log("Testing simple struct...");

try {
  const lexer = new ApiLexer(simpleTest);
  const parser = new ApiParser(lexer);

  console.log("Created lexer and parser");
  const ast = parser.parse(simpleTest);
  console.log("✅ Simple parsing successful!");
  console.log(`Parsed ${ast.body.length} statements`);
} catch (error) {
  console.error("❌ Simple parsing failed:");
  console.error(error.message);
  if (error.token) {
    console.error(
      `At line ${error.token.line}, column ${error.token.column}: "${error.token.value}"`
    );
  }
}

// 测试apilist语法
const apilistTest = `
apilist "test" {
    api "simple" {
        input User
        output User
    }
}
`;

console.log("\nTesting apilist...");

try {
  const lexer2 = new ApiLexer(apilistTest);
  const parser2 = new ApiParser(lexer2);

  console.log("Created lexer and parser for apilist");
  const ast2 = parser2.parse(apilistTest);
  console.log("✅ Apilist parsing successful!");
  console.log(`Parsed ${ast2.body.length} statements`);
} catch (error) {
  console.error("❌ Apilist parsing failed:");
  console.error(error.message);
  if (error.token) {
    console.error(
      `At line ${error.token.line}, column ${error.token.column}: "${error.token.value}"`
    );
  }
}

console.log("\n=== Test completed ===");
