// XH Agent 核心模块
// 基于大模型实现通用型智能体
// 兼容openai接口
// 集成 Skill加载 沙箱管理 HITL机制 流式输出

import OpenAI from "openai";
import {
  type SandboxConfig,
  type SandboxContent,
  createSandbox,
} from "./sandbox.js";
import { type HitlConfig, hitlCheckpoint } from "./hitl.js";
import { type Skill, loadSkills, buildSkillsPrompt } from "./skill-loader.js";

export interface AgentCofig {
  name: string; // 智能体名称
  model?: string; // 模型
  apiKey?: string; // api key
  temperature?: number; // 温度参数
  skillsDir?: string; // skill目录路径
  sandbox?: SandboxConfig; // 沙箱配置
  hitl?: HitlConfig; // HITL的配置
  systemPrompt?: string; // 系统提示词 (追加到默认提示词后面)
  maxToken?: number; // 最大token数，默认4096
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  content: string;
  messages: AgentMessage[];
  filesWritten: string[];
}

export class XHAgent {
  private client: OpenAI;
  private config: Required<AgentCofig>;
  private skills: Skill[] = [];
  private sandbox: SandboxContent | null = null;
  private conversationHistory: AgentMessage[] = [];

  constructor(config: AgentCofig) {
    this.config = {
      name: config.name,
      model: config.model ?? (process.env.DASHSCOPE_MODEL || "qwen3.7-plus"),
      apiKey: config.apiKey ?? process.env.DASHSCOPE_API_KEY ?? "",
      temperature:
        config.temperature ?? Number(process.env.DASHSCOPE_TEMPERATURE ?? 0.7),
      skillsDir: config.skillsDir ?? ".xh/skills",
      sandbox: config.sandbox ?? {
        workspacePath: process.cwd(),
        outputDir: "output",
        verbose: true,
      },
      hitl: config.hitl ?? { enabled: true, autoApprove: false },
      systemPrompt: config.systemPrompt ?? "",
      maxToken: config.maxToken ?? 4096,
    };
    if (!this.config.apiKey) {
      throw new Error("缺少 API_KEY，请在 .env 文件中配置");
    }
    // 兼容 OpenAI 接口，只需替换 baseURL
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  }

  // 初始化 智能体
  // 加载skill文件，初始化沙箱
  async init(): Promise<void> {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🤖 ${this.config.name} 启动中...`);
    console.log(`\n${"=".repeat(50)}`);

    console.log("\n📁 [Agent] 正在加载 Skill 文件...");
    this.skills = loadSkills(this.config.skillsDir);
    console.log(`[Agent] 共加载 ${this.skills.length} 个 Skill`);

    console.log("\n🔒 [Agent] 正在初始化沙箱...");
    this.sandbox = createSandbox(this.config.sandbox);

    console.log(`\n✅ [Agent] 初始化完成，模型：${this.config.model}`);
    console.log(`${"=".repeat(50)}`);
  }

  // 构建完整的 System Prompt
  private buildSystemPrompt(): string {
    const skillsSection = buildSkillsPrompt(this.skills);
    const sandboxSection = this.sandbox
      ? `\n## 工作区信息\n当前输出路径：${this.sandbox.outputPath}\n所有文件操作都写入此目录`
      : "";
    return `你是 ${this.config.name}，一个通用型 AI 智能体。
## 核心能力
- 理解用户的自然语言目标，自动规划执行步骤
- 调用相应的 Skill 技能处理专项任务
- 将结果写入本地文件系统
${skillsSection}
${sandboxSection}

## 行为准则
- 每次回复说明你正在做什么（Planning → 执行 → 输出）
- 需要写文件时，使用以下格式：
\`\`\`filename:文件名.md
文件内容
\`\`\`
- 使用中文回复

${this.config.systemPrompt}`;
  }

  // 普通调用(非流式)
  async invoke(userMessage: string): Promise<AgentResult> {
    const approved = await hitlCheckpoint(userMessage, this.config.hitl);
    if (!approved) {
      return {
        content: "操作已被用户取消。",
        messages: this.conversationHistory,
        filesWritten: [],
      };
    }
    this.conversationHistory.push({ role: "user", content: userMessage });
    console.log(
      `\n📨 [Agent] 收到任务：${userMessage.slice(0, 80)}${userMessage.length > 80 ? "..." : ""}`,
    );
    console.log("[Agent] 正在思考...\n");

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: this.config.maxToken,
      temperature: this.config.temperature,
      messages: [
        { role: "system", content: this.buildSystemPrompt() },
        ...this.conversationHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    const assistantContent = response.choices[0]?.message?.content ?? "";
    this.conversationHistory.push({
      role: "assistant",
      content: assistantContent,
    });

    const filesWritten = await this.processFileOperations(assistantContent);

    console.log("\n" + "=".repeat(50));
    console.log("🎯 [Agent] 执行完成");
    if (filesWritten.length > 0) {
      console.log(`📄 写入文件：${filesWritten.join(", ")}`);
    }
    return {
      content: assistantContent,
      messages: this.conversationHistory,
      filesWritten,
    };
  }

  // 流式调用(边生成边输出)
  async invokeStream(userMessage: string): Promise<AgentResult> {
    const approved = await hitlCheckpoint(userMessage, this.config.hitl);
    if (!approved) {
      return {
        content: "操作已被用户取消。",
        messages: this.conversationHistory,
        filesWritten: [],
      };
    }
    this.conversationHistory.push({ role: "user", content: userMessage });
    console.log(
      `\n📨 [Agent] 收到任务：${userMessage.slice(0, 80)}${userMessage.length > 80 ? "..." : ""}`,
    );
    console.log("[Agent] 开始流式输入\n");
    console.log(`${"=".repeat(50)}`);

    let fullContent = "";

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: this.config.maxToken,
      temperature: this.config.temperature,
      stream: true,
      messages: [
        { role: "system", content: this.buildSystemPrompt() },
        ...this.conversationHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content ?? "";
      if (delta) {
        process.stdout.write(delta);
        fullContent += delta;
      }
    }

    console.log(`\n${"=".repeat(50)}`);

    this.conversationHistory.push({
      role: "assistant",
      content: fullContent,
    });

    const filesWritten = await this.processFileOperations(fullContent);

    console.log("\n🎯 [Agent] 流式执行完成");
    if (filesWritten.length > 0) {
      console.log(`📄 写入文件：${filesWritten.join(", ")}`);
    }
    return {
      content: fullContent,
      messages: this.conversationHistory,
      filesWritten,
    };
  }

  // 解析AI回复中的文件写入指令
  // 文件格式 \`\`\`filename:文件名.md 文件内容 \`\`\`
  private async processFileOperations(content: string): Promise<string[]> {
    if (!this.sandbox) return [];

    const filesWritten: string[] = [];
    const fileBlockRegex = /```(?:filename:|file:)([^\n]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = fileBlockRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      const fileContent = match[2].trim();
      try {
        const approved = await hitlCheckpoint(
          `写入文件：${filename}`,
          this.config.hitl,
        );
        if (approved) {
          const writtenPath = this.sandbox.writeFile(filename, fileContent);
          filesWritten.push(filename);
          console.log(`[Agent] ✅已写入：${writtenPath}`);
        }
      } catch (err) {
        console.log(`[Agent] ❌ 写入失败 ${filename}：`, err);
      }
    }
    return filesWritten;
  }

  // 手动写文件 (在沙箱内)
  writeFile(filename: string, content: string): string {
    if (!this.sandbox) throw new Error("沙箱未初始化");
    return this.sandbox.writeFile(filename, content);
  }

  // 获取沙箱信息
  getSandBox(): SandboxContent | null {
    return this.sandbox;
  }

  // 清除历史对话
  clearHistory() {
    this.conversationHistory = [];
    console.log("[Agent] 对话历史清空");
  }

  // 获取所有的skills
  getSkills(): Skill[] {
    return this.skills;
  }
}

// 工厂函数 快速的创建并初始化Agent
export async function createXHAgent(config: AgentCofig): Promise<XHAgent> {
  const agent = new XHAgent(config);
  await agent.init();
  return agent;
}
