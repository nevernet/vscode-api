# 构建和打包说明

## 📦 可用的构建命令

### 基本命令

```bash
# 清理构建输出
npm run clean

# 编译 TypeScript 代码
npm run compile

# 监视模式编译（开发时使用）
npm run watch

# 版本号递增（0.0.1 -> 0.0.2）
npm run bump-version

# 基本构建（不递增版本）
npm run build

# 构建并递增版本号
npm run build:bump
```

### 打包命令

```bash
# 基本打包（不递增版本）
npm run package

# 打包并递增版本号
npm run package:bump

# 发布到 VS Code 市场（需要配置发布token）
npm run publish
```

### 高级构建脚本

```bash
# 使用构建脚本（推荐）
node scripts/build.js

# 使用构建脚本并递增版本号
node scripts/build.js --bump
# 或者
node scripts/build.js -b
```

## 🔧 构建流程

构建脚本执行以下步骤：

1. **清理** - 删除 `dist/` 目录和所有旧文件
2. **版本递增**（可选）- 自动递增补丁版本号
3. **代码检查**（暂时禁用）- ESLint 代码风格检查  
4. **编译** - TypeScript 编译为 JavaScript，输出到 `dist/` 目录
5. **打包** - 使用 vsce 打包为 `.vsix` 扩展文件，保存到 `dist/` 目录

## 📁 输出文件

构建成功后会在 `dist/` 目录中生成：
- `client/` - 客户端编译后的 JavaScript 文件
- `server/` - 服务器端编译后的 JavaScript 文件  
- `api-x.x.x.vsix` - VS Code 扩展包

## 🚀 安装扩展

### 方法1：从 .vsix 文件安装
```bash
code --install-extension dist/api-0.0.4.vsix
```

### 方法2：在 VS Code 中安装
1. 打开 VS Code
2. 按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac)
3. 输入 "Extensions: Install from VSIX..."
4. 选择生成的 `.vsix` 文件

## 🔄 版本管理

版本号格式：`major.minor.patch`

- `npm run bump-version` 只递增补丁版本 (x.x.z+1)
- 如需递增其他版本号，可手动编辑 `package.json`

## 📝 开发建议

### 开发时
```bash
# 启动监视模式
npm run watch

# 在另一个终端启动调试
# 按 F5 在 VS Code 中启动 Extension Development Host
```

### 发布前
```bash
# 完整构建并测试
npm run build:bump

# 安装并测试扩展
code --install-extension dist/api-x.x.x.vsix
```

## ⚠️ 注意事项

1. **构建前确保代码已提交** - 避免丢失未保存的更改
2. **测试功能** - 每次构建后在 Extension Development Host 中测试
3. **版本控制** - 构建脚本会自动更新 `package.json` 中的版本号
4. **许可证文件** - 考虑添加 LICENSE 文件以消除警告
5. **文件大小** - 当前使用 `.vscodeignore` 排除开发文件，保持扩展包精简

## 🐛 常见问题

### TypeScript 编译错误 "Cannot write file because it would overwrite input file"
如果遇到这个错误：
1. 清理构建输出：`npm run clean`
2. 检查 `tsconfig.json` 中是否正确排除了 `out` 目录
3. 确保 `include` 字段只包含源文件目录 `src/**/*`

### ESLint 错误
如果遇到 ESLint 配置问题，临时解决方案：
1. 修改 `scripts/build.js` 注释掉 lint 步骤
2. 或者修复 `.eslintrc.js` 配置

### 构建失败
1. 检查 TypeScript 编译错误
2. 确保所有依赖已安装：`npm install`
3. 清理后重试：`npm run clean && npm run build`

### 扩展无法安装
1. 检查 VS Code 版本兼容性
2. 验证 `package.json` 中的 `engines.vscode` 字段
3. 尝试重新构建扩展