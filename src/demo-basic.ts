/**
 * Demo1：基础 Skill 调用
 * 演示：Skill 加载 → DeepSeek 识别触发条件 → 输出结果
 * 运行命令：npm run demo:basic
 * 不需要 Tavily Key
 */

import "dotenv/config";
import { createXHAgent } from "./agent.js";

async function main() {
  // 创建并初始化 Agent
  // hitl 关闭，演示时不需要每次确认
  const agent = await createXHAgent({
    name: "OpenCodex - 基础版",
    skillsDir: ".xh/skills",
    sandbox: {
      workspacePath: process.cwd(),
      outputDir: "output",
      verbose: true,
    },
    hitl: { enabled: false },
    systemPrompt: "你是一个有趣的 AI 助手，擅长处理古诗词和技术问题。",
  });

  // 打印已加载的 Skill 列表
  console.log("📋 已加载的 Skill：");
  agent.getSkills().forEach((skill) => {
    console.log(`  - ${skill.name}（${skill.fileName}）`);
  });

  // 测试一：输入诗词，验证「唐宋诗词笑话生成器」Skill 触发
  console.log("\n🎭 测试一：诗词笑话生成\n");
  const result1 = await agent.invoke("飞流直下三千尺，疑是银河落九天");
  console.log("\n📝 AI 回复：");
  console.log(result1.content);

  // 测试二：另一首诗，验证同一个 Skill 对不同输入的处理
  console.log("\n🎭 测试二：另一首诗\n");
  const result2 = await agent.invoke("举头望明月，低头思故乡");
  console.log("\n📝 AI 回复：");
  console.log(result2.content);
}
main().catch(console.error);
