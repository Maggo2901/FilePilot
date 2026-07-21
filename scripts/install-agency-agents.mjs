import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(projectRoot, '.agents', 'agency-agents-source');
const targetArg = process.argv.indexOf('--target');
const targetDir = targetArg >= 0 && process.argv[targetArg + 1]
  ? resolve(process.argv[targetArg + 1])
  : join(homedir(), '.codex', 'agents');

const agents = [
  'engineering/engineering-frontend-developer.md',
  'engineering/engineering-backend-architect.md',
  'security/security-appsec-engineer.md',
  'engineering/engineering-devops-automator.md',
  'engineering/engineering-code-reviewer.md',
  'engineering/engineering-git-workflow-master.md',
  'engineering/engineering-technical-writer.md',
  'testing/testing-test-automation-engineer.md',
  'testing/testing-accessibility-auditor.md',
  'design/design-ui-designer.md',
  'testing/testing-reality-checker.md'
];

function parseAgent(markdown, file) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Ungültiges Agent-Format: ${file}`);

  const field = name => {
    const value = match[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    if (!value) throw new Error(`Feld ${name} fehlt: ${file}`);
    return value.replace(/^['"]|['"]$/g, '');
  };

  return {name: field('name'), description: field('description'), instructions: match[2].trim()};
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tomlString(value) {
  return JSON.stringify(value);
}

await mkdir(targetDir, {recursive: true});

for (const relativeFile of agents) {
  const sourceFile = join(sourceRoot, relativeFile);
  const agent = parseAgent(await readFile(sourceFile, 'utf8'), sourceFile);
  const output = [
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    `developer_instructions = ${tomlString(agent.instructions)}`,
    ''
  ].join('\n');
  const outputFile = join(targetDir, `${slugify(agent.name)}.toml`);
  await writeFile(outputFile, output, 'utf8');
  console.log(`Installiert: ${agent.name} -> ${basename(outputFile)}`);
}

console.log(`\n${agents.length} FilePilot-Agenten installiert in ${targetDir}`);
