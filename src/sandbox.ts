// 沙箱隔离
// 管理智能体的工作区，实现文件路径映射 安全的隔离

import fs from "fs";
import path from "path";

export interface SandboxConfig {
  // 工作区根目录 真实路径
  workspacePath: string;
  // 输出目录 相对于工作区
  outputDir?: string;
  // 是否开启操作日志
  verbose?: boolean;
}

export interface SandboxContent {
  // 工作区真实路径
  workspacePath: string;
  // 输出真实路径
  outputPath?: string;
  // 写文件（在沙箱内）
  writeFile: (filename: string, content: string) => string;
  // 读文件（在沙箱内）
  readFile: (filename: string) => string | null;
  // 列出文件
  listFiles: () => string[];
  // 路径是否在沙箱内 安全校验
  isPathSafe: (targetPath: string) => boolean;
}

//
export function createSandbox(config: SandboxConfig): SandboxContent {
  const workspacePath = path.resolve(config.workspacePath);
  const outputDir = config.outputDir || "output";
  const outputPath = path.join(workspacePath, outputDir);
  const verbose = config.verbose ?? true;

  // 确保输出目录存在
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true }); //recursive 递归创建
  }
  if (verbose) {
    console.log(`[Sandbox] 工作区初始化完成`);
    console.log(`[Sandbox]    真实路径：${workspacePath}`);
    console.log(`[Sandbox]    输出路径：${outputPath}`);
  }

  // 安全校验： 目标路径必须在工作区
  function isPathSafe(targetPath: string): boolean {
    const resolved = path.resolve(outputPath, targetPath);
    return resolved.startsWith(outputPath);
  }

  // 写文件到输出目录
  function writeFile(filename: string, content: string): string {
    // 安全前置校验
    if (!isPathSafe(filename)) {
      throw new Error(`[Sandbox] 安全拦截，路径越界 ${filename}`);
    }
    // 拼接最终目标路径
    const targetPath = path.join(outputPath, filename);
    // 确保子目录存在
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // 同步写入文件
    fs.writeFileSync(targetPath, content, "utf-8");
    //  调试日志
    if (verbose) {
      console.log(
        `[Sandbox] 文件已写入：${path.relative(workspacePath, targetPath)}`,
      );
    }
    return targetPath;
  }

  // 读取目录中的文件
  function readFile(filename: string): string | null {
    if (!isPathSafe(filename)) {
      throw new Error(`[Sandbox] 安全拦截，路径越界 ${filename}`);
    }
    const targetPath = path.join(outputPath, filename);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.readFileSync(targetPath, "utf-8");
  }

  // 列出 输出目录中所有的文件
  function listFiles(): string[] {
    if (!fs.existsSync(outputPath)) return [];
    const walk = (dir: string): string[] => {
      // 读取目录下所有条目，开启 withFileTypes 直接获取文件/目录类型
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // flatMap 同时完成「遍历映射 + 数组扁平化」，无需额外 flat 操作
      return entries.flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        // 如果是目录，递归深入遍历子目录，递归结果会被 flatMap 自动拍平
        if (entry.isDirectory()) return walk(fullPath);
        // 如果是文件，转为相对于 outputPath 的相对路径后返回
        return [path.relative(outputPath, fullPath)];
      });
    };
    return walk(outputPath);

    // 示例
    // /project/sandbox/output/
    // ├── readme.md
    // ├── src/
    // │   ├── index.js
    // │   └── utils/
    // │       └── tool.js
    // ├── empty-dir/          # 空目录，没有任何文件
    // └── assets/
    //     └── style.css

    // [
    //     "readme.md",
    //     "src/index.js",
    //     "src/utils/tool.js",
    //     "assets/style.css"
    // ]
  }

  return {
    workspacePath,
    outputPath,
    writeFile,
    readFile,
    listFiles,
    isPathSafe,
  };
}
