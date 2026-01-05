# API Language 插件配置

## 配置文件位置

API Language 插件会在项目根目录下的 `.api` 文件夹中查找配置文件 `config.json`。

## 配置格式

配置文件使用 JSON 格式，支持以下选项：

```json
{
  "ignore": {
    "files": [
      "要忽略的文件名列表，支持通配符"
    ],
    "directories": [
      "要忽略的目录名列表，支持通配符"
    ],
    "patterns": [
      "要忽略的路径模式列表，支持通配符"
    ]
  }
}
```

## 配置示例

```json
{
  "ignore": {
    "files": [
      "test*.api",
      "temp*.api",
      "debug.api"
    ],
    "directories": [
      "test",
      "samples",
      "examples",
      "generated*"
    ],
    "patterns": [
      "*/generated/*",
      "*/auto/*",
      "*/backup/*",
      "*/temp/*"
    ]
  }
}
```

## 默认忽略的目录

以下目录默认会被忽略，无需在配置文件中指定：

- `node_modules`
- `.git`
- `.vscode`
- `dist`
- `build`
- `out`
- `target`
- `.idea`
- `__pycache__`
- `.cache`
- `tmp`
- `temp`
- `.api` (插件自己的缓存目录)

## 通配符支持

配置中的文件名、目录名和路径模式都支持简单的通配符 `*`，它匹配任意数量的字符。

例如：
- `test*.api` 匹配 `test.api`、`test123.api`、`test_file.api` 等
- `generated*` 匹配 `generated`、`generated_files`、`generated-v2` 等
- `*/temp/*` 匹配任意路径下的 `temp` 目录及其子目录

## 注意事项

1. 修改配置文件后，需要重启 VS Code 或使用 "API: 重启索引系统" 命令来应用新的配置。
2. 配置文件是可选的，如果没有提供配置文件，插件将使用默认的忽略规则。
3. 路径模式是相对于项目根目录的。