#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function log(message) {
  console.log(`[BUILD] ${message}`);
}

function execCommand(command, description) {
  log(description);
  try {
    execSync(command, { stdio: "inherit" });
    return true;
  } catch (error) {
    console.error(`❌ Failed: ${description}`);
    console.error(error.message);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const shouldBumpVersion = args.includes("--bump") || args.includes("-b");

  log("Starting build process...");

  // 1. Clean previous build
  if (fs.existsSync("dist")) {
    log("Cleaning previous build...");
    execCommand("rm -rf dist", "Clean dist directory");
  }

  // 2. Bump version if requested
  if (shouldBumpVersion) {
    if (!execCommand("node scripts/bump-version.js", "Bump version number")) {
      process.exit(1);
    }
  }

  // 3. Lint code (optional)
  // if (!execCommand('npm run lint', 'Lint TypeScript code')) {
  //   log('⚠️  Linting failed, but continuing...');
  // }

  // 4. Compile TypeScript
  if (!execCommand("npm run compile", "Compile TypeScript")) {
    process.exit(1);
  }

  // 5. Package extension
  if (
    !execCommand("npx vsce package --out dist/", "Package VS Code extension")
  ) {
    process.exit(1);
  }

  // 6. Show result
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const vsixFile = `dist/${packageJson.name}-${packageJson.version}.vsix`;

  if (fs.existsSync(vsixFile)) {
    log(`✅ Build completed successfully!`);
    log(`📦 Extension package: ${vsixFile}`);
    log(`🔖 Version: ${packageJson.version}`);

    // Show file size
    const stats = fs.statSync(vsixFile);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    log(`📊 Package size: ${fileSizeInMB} MB`);
  } else {
    log("❌ Package file not found!");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
