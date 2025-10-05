#!/usr/bin/env node
import { ApiLexer } from "./dist/server/lexer.js";
import { ApiParser } from "./dist/server/parser.js";
import { SymbolTable, SymbolCollector } from "./dist/server/symbols.js";
import * as fs from "fs";

console.log("=== API Language Parser Test ===\n");

// 读取测试文件
const testFile = "test.api";
if (!fs.existsSync(testFile)) {
    console.error(`Test file ${testFile} not found!`);
    process.exit(1);
}

const content = fs.readFileSync(testFile, "utf8");
console.log("Reading test file:", testFile);

try {
    // 创建词法分析器和解析器
    const lexer = new ApiLexer(content);
    const parser = new ApiParser(lexer);
    
    console.log("\n=== Parsing ===");
    const ast = parser.parse(content);
    console.log("✅ Parsing successful!");
    console.log(`Parsed ${ast.body.length} statements`);
    
    // 创建符号表并收集符号
    console.log("\n=== Symbol Collection ===");
    const symbolTable = new SymbolTable();
    const collector = new SymbolCollector(symbolTable, testFile);
    collector.collect(ast);
    
    const allSymbols = symbolTable.getAllSymbols();
    console.log(`✅ Collected ${allSymbols.length} symbols`);
    
    // 显示所有符号
    console.log("\n=== Symbols Found ===");
    allSymbols.forEach(symbol => {
        const parent = symbol.parent ? ` (in ${symbol.parent})` : '';
        console.log(`- ${symbol.kind}: ${symbol.name}${parent}`);
    });
    
    // 检查重复定义
    console.log("\n=== Duplicate Check ===");
    const duplicates = symbolTable.getDuplicates();
    if (duplicates.size === 0) {
        console.log("⚠️  No duplicates detected (expected some for testing)");
    } else {
        console.log(`🔍 Found ${duplicates.size} duplicate definitions:`);
        for (const [name, symbols] of duplicates) {
            console.log(`- "${name}": ${symbols.length} definitions`);
            symbols.forEach((symbol, index) => {
                console.log(`  ${index + 1}. Line ${symbol.location.range.start.line + 1}`);
            });
        }
    }
    
    console.log("\n✅ All tests completed successfully!");
    
} catch (error) {
    console.error("\n❌ Error during testing:");
    console.error(error.message);
    if (error.token) {
        console.error(`At line ${error.token.line}, column ${error.token.column}: "${error.token.value}"`);
    }
    process.exit(1);
}