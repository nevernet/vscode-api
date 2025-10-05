const { formatApiDocument } = require("../../dist/server/server");

// 测试格式化功能
const testInput = `typedef struct {
  id           int
  } CustomerCategoryParentInfo

  typedef struct {
    user_id      int
    category     string
    active       bool
  } UserCategory`;

const expected = `typedef struct {
  id           int
} CustomerCategoryParentInfo

typedef struct {
  user_id      int
  category     string
  active       bool
} UserCategory`;

console.log("Testing formatting fix...");
console.log("Input:");
console.log(testInput);
console.log("\nExpected output:");
console.log(expected);

// Note: This is a conceptual test - the actual formatApiDocument function
// is not exported from the server module, but this shows what we're testing for.
