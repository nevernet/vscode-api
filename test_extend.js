const { ApiParser } = require("./dist/server/parser");
const fs = require("fs");

// Read the test file
const testFile = fs.readFileSync("./examples/extend_test.api", "utf8");

// Create a parser and parse the test file
const parser = new ApiParser();
const ast = parser.parse(testFile);

// Find the typedef with extend
const typedefStatement = ast.body.find(
  (stmt) =>
    stmt.type === "TypedefStatement" && stmt.structDef && stmt.structDef.extends
);

if (typedefStatement) {
  console.log("✅ Successfully parsed typedef with extend!");
  console.log("Struct name:", typedefStatement.name.name);
  console.log("Extends:", typedefStatement.structDef.extends.name);
  console.log(
    "Fields:",
    typedefStatement.structDef.fields.map(
      (f) => `${f.fieldType.name} ${f.name.name}`
    )
  );
} else {
  console.log("❌ Failed to parse typedef with extend");
}
