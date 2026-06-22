/**
 * skill 加载器
 * 扫描 .xh/skills 目录， 读取 所有.skill.md文件并解析成结构化数据
 * Agent 启动的时候调用它，把解析结果 合并到 System Prompt
 *
 */

import fs from "fs";
import path from "path";

// skill结构
export interface Skill {
  name: string; // 技能名称 # 标题
  fileName: string; // 文件名  code-review.skill.md
  description: string; // 触发条件  ## Description
  script: string; // 执行步骤  ## Script
  examples?: string; // 示例  ## Examples
  references?: string; // 参考资料  ## References
  outputFormat?: string; // 输出格式
  raw?: string; // 完整原始文件内容
}

// 解析单个 .skill.md 文件
export function parseSkillFile(filePath: string): Skill {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");

  // 提取技能名称 (第一个 # 标题)
  const nameMath = lines.find((l) => l.startsWith("# "));
  const name = nameMath
    ? nameMath.replace("# ", "").trim()
    : path.basename(filePath, ".skill.md");
  // const filthPath = /user/skills/vue.skill.md ===> path.basename(filePath) == vue.skill.md

  // 按 ## 章节分割
  const sections: Record<string, string> = {};
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // 遇到新的二级标题，先把上一个章节存起来
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      // 切换到新章节，清空内容缓存
      currentSection = line.replace("## ", "").trim();
      currentContent = [];
    } else if (!line.startsWith("# ")) {
      // 非一级标题的普通行，加入当前章节内容
      currentContent.push(line);
    }
  }
  // 保存最后一个章节
  if (currentSection) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  // 示例
  //   {
  //     name: "Vue 组件开发技能",
  //     fileName: "vue.skill.md",
  //     description:
  //       "用于生成符合 Vue 3 规范的单文件组件代码，支持 Composition API。",
  //     script: "你是资深 Vue 开发工程师，严格按照用户需求输出代码。",
  //     examples: "输入：写一个按钮组件\n输出：<template>...</template>",
  //     references: undefined, // 文件里没这个章节就是 undefined
  //     outputFormat: "直接输出完整的 .vue 文件代码，不要多余解释。",
  //     raw: "文件原始全部文本...",
  //   }

  return {
    name,
    fileName: path.basename(filePath),
    description: sections["Description"],
    script: sections["Script"],
    examples: sections["Examples"],
    references: sections["References"],
    outputFormat: sections["Output Format"],
    raw,
  };
}

// 加载指定目录下所有的 .skill.md 文件
// 返回解析后的 skill数组
export function loadSkills(skillsDir: string): Skill[] {
  const resolveDir = path.resolve(skillsDir);

  // 目录不存在时给出警告，不直接报错（允许没有 Skill 运行）
  if (!fs.existsSync(resolveDir)) {
    console.warn(`[SkillLoder]目录不存在: ${resolveDir}`);
    return [];
  }

  const files = fs.readdirSync(resolveDir);
  const skillFiles = files.filter((f) => f.endsWith(".skill.md"));

  if (skillFiles.length === 0) {
    console.warn(`[SkillLoder]没有找到 .skill.md文件: ${resolveDir}`);
    return [];
  }

  const skills = skillFiles.map((file) => {
    const filePath = path.join(resolveDir, file);
    const skill = parseSkillFile(filePath);

    console.warn(`[SkillLoder] 已加载技能: ${skill.name} (${file})`);
    return skill;
  });

  return skills;
}

// 将 skill 列表的格式 转成 System Prompt 中的技能说明
export function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const skillDescriptions = skills
    .map((skill, index) => {
      // 基础格式：序号 + 加粗技能名 + 触发条件（对应 Description 章节）
      let desc = `${index + 1}. **${skill.name}**\n触发条件：${skill.description}`;
      if (skill.examples) {
        // 有示例的话，追加示例（只取前 3 行，控制 token 长度）
        const firstExample = skill.examples.split("\n").slice(0, 3).join("\n");
        desc += `\n 示例：\n ${firstExample}`;
      }
      return desc;
    })
    .join("\n\n");
  return `
    ## 你具备以下专项技能(skill)
    ${skillDescriptions}
    当用户的输入符合某个技能的触发条件时，请主动调用该技能的执行逻辑来处理任务。
  `;
}
