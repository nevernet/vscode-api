#!/usr/bin/env node
import { ApiLexer } from "../dist/server/lexer.js";
import { ApiParser } from "../dist/server/parser.js";
import { SymbolTable, SymbolCollector } from "../dist/server/symbols.js";
import * as fs from "fs";

console.log("=== API Language Parser Test (Updated) ===\n");

// 测试多个文件
const testFiles = ["test.api", "test-apilist.api"];

for (const testFile of testFiles) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Testing file: ${testFile}`);
  console.log(`${"=".repeat(50)}`);

  if (!fs.existsSync(testFile)) {
    console.error(`Test file ${testFile} not found! Skipping...`);
    continue;
  }

  const content = fs.readFileSync(testFile, "utf8");

  try {
    // 创建词法分析器和解析器
    const lexer = new ApiLexer(content);
    const parser = new ApiParser(lexer);

    console.log("\n=== Parsing ===");
    const ast = parser.parse(content);
    console.log("✅ Parsing successful!");
    console.log(`Parsed ${ast.body.length} statements`);

    // 显示解析的语句类型
    console.log("\n=== Statement Types ===");
    ast.body.forEach((stmt, index) => {
      console.log(`${index + 1}. ${stmt.type}`);
    });

    // 创建符号表并收集符号
    console.log("\n=== Symbol Collection ===");
    const symbolTable = new SymbolTable();
    const collector = new SymbolCollector(symbolTable, testFile);
    collector.collect(ast);

    const allSymbols = symbolTable.getAllSymbols();
    console.log(`✅ Collected ${allSymbols.length} symbols`);

    // 按类型分组显示符号
    console.log("\n=== Symbols by Type ===");
    const symbolsByKind = {};
    allSymbols.forEach((symbol) => {
      if (!symbolsByKind[symbol.kind]) {
        symbolsByKind[symbol.kind] = [];
      }
      symbolsByKind[symbol.kind].push(symbol);
    });

    for (const [kind, symbols] of Object.entries(symbolsByKind)) {
      console.log(`\n${kind.toUpperCase()}:`);
      symbols.forEach((symbol) => {
        const parent = symbol.parent ? ` (in ${symbol.parent})` : "";
        console.log(`  - ${symbol.name}${parent}`);
      });
    }

    // 检查重复定义
    console.log("\n=== Duplicate Check ===");
    const duplicates = symbolTable.getDuplicates();
    if (duplicates.size === 0) {
      console.log("✅ No duplicates detected");
    } else {
      console.log(`🔍 Found ${duplicates.size} duplicate definitions:`);
      for (const [name, symbols] of duplicates) {
        console.log(`\n❌ "${name}": ${symbols.length} definitions`);
        symbols.forEach((symbol, index) => {
          const parent = symbol.parent ? ` (in ${symbol.parent})` : "";
          console.log(
            `  ${index + 1}. Line ${
              symbol.location.range.start.line + 1
            }${parent}`
          );
        });
      }
    }
  } catch (error) {
    console.error("\n❌ Error during testing:");
    console.error(error.message);
    if (error.token) {
      console.error(
        `At line ${error.token.line}, column ${error.token.column}: "${error.token.value}"`
      );
    }
  }
}

console.log("\n" + "=".repeat(50));
console.log("✅ All tests completed!");
console.log("=".repeat(50));
