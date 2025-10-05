# 测试文件目录

此目录包含了 VS Code API 语言扩展的所有测试文件。

## 文件说明

### API 测试文件 (*.api)

- `test.api` - 基础语法测试文件
- `test-apilist.api` - API列表语法测试文件
- `example.api` - 示例API文件
- `format-test.api` - 格式化功能测试文件
- `comprehensive-test.api` - 综合功能测试文件

### 测试脚本 (*.mjs)

- `debug-test.mjs` - 基础解析器调试测试
- `inline-test.mjs` - 内联结构体解析测试
- `test-new-features.mjs` - 新功能测试脚本
- `format-test.mjs` - 格式化功能测试脚本
- `comprehensive-test.mjs` - 综合功能测试脚本（注意：可能导致内存溢出）
- `final-test.mjs` - 最终功能验证测试

## 运行测试

在项目根目录运行以下命令来执行测试：

```bash
# 进入测试目录
cd tests

# 运行单个测试
node final-test.mjs
node format-test.mjs
node debug-test.mjs

# 运行所有基础测试
node test-new-features.mjs
```

## 功能测试覆盖

测试文件覆盖了以下功能：

- ✅ typedef enum {} 语法支持
- ✅ typedef struct { id int name string } 语法支持
- ✅ 重复字段/枚举值检查
- ✅ apilist "name" {} 语法支持
- ✅ input/output/data struct {} 支持
- ✅ API重复检查
- ✅ 改进的自动完成功能
- ✅ 文档格式化功能

## 注意事项

- 确保在运行测试前编译了项目：`npm run compile`
- `comprehensive-test.mjs` 可能会导致内存溢出，推荐使用 `final-test.mjs` 进行快速验证
- 所有测试脚本都使用 ES6 模块语法，需要 Node.js 支持