import { readFileSync } from "fs";
import { ApiLexer } from "./server/lexer";
import { ApiParser } from "./server/parser";
import { SymbolTable, SymbolCollector } from "./server/symbols";

function testParser() {
  try {
    // 读取示例文件
    const content = readFileSync("./example.api", "utf8");
    console.log("Testing API Language Parser");
    console.log("=".repeat(50));

    // 词法分析
    console.log("\n1. Lexical Analysis:");
    const lexer = new ApiLexer(content);
    const tokens = lexer.tokenize();
    console.log(`Found ${tokens.length} tokens`);

    // 语法分析
    console.log("\n2. Syntax Analysis:");
    const parser = new ApiParser(lexer);
    const ast = parser.parse(content);
    console.log(`AST root type: ${ast.type}`);
    console.log(`Number of statements: ${ast.body.length}`);

    // 符号收集
    console.log("\n3. Symbol Collection:");
    const symbolTable = new SymbolTable();
    const collector = new SymbolCollector(symbolTable, "test://example.api");
    collector.collect(ast);

    const symbols = symbolTable.getAllSymbols();
    console.log(`Found ${symbols.length} symbols:`);

    symbols.forEach((symbol) => {
      console.log(`  - ${symbol.name} (${symbol.kind}): ${symbol.detail}`);
    });

    // 检查重复定义
    console.log("\n4. Duplicate Check:");
    const duplicates = symbolTable.getDuplicates();
    if (duplicates.size > 0) {
      console.log("Found duplicate definitions:");
      duplicates.forEach((symbols, name) => {
        console.log(`  - ${name}: ${symbols.length} definitions`);
      });
    } else {
      console.log("No duplicate definitions found.");
    }

    console.log("\n✅ Parser test completed successfully!");
  } catch (error) {
    console.error("❌ Parser test failed:", error);
  }
}

testParser();
