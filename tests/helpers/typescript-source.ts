import { parse } from '@babel/parser';
import * as t from '@babel/types';

export function parseTypeScriptSource(path: string, source: string): t.Program {
  return parse(source, {
    sourceFilename: path,
    sourceType: 'module',
    plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  }).program;
}

export function walkSourceAst(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node);
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) walkSourceAst(item, visit);
      }
      continue;
    }
    if (isAstNode(child)) walkSourceAst(child, visit);
  }
}

export function findTypeAliasDeclaration(
  program: t.Program,
  name: string,
): t.TSTypeAliasDeclaration | undefined {
  for (const statement of program.body) {
    if (t.isTSTypeAliasDeclaration(statement) && statement.id.name === name) return statement;
    if (
      t.isExportNamedDeclaration(statement)
      && t.isTSTypeAliasDeclaration(statement.declaration)
      && statement.declaration.id.name === name
    ) {
      return statement.declaration;
    }
  }
  return undefined;
}

export function getModuleSpecifiers(program: t.Program): string[] {
  const specifiers: string[] = [];
  for (const statement of program.body) {
    if (t.isImportDeclaration(statement)) {
      specifiers.push(statement.source.value);
      continue;
    }
    if (t.isExportNamedDeclaration(statement) && statement.source) {
      specifiers.push(statement.source.value);
      continue;
    }
    if (t.isExportAllDeclaration(statement)) specifiers.push(statement.source.value);
  }
  return specifiers;
}

function isAstNode(value: unknown): value is t.Node {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && type in t.VISITOR_KEYS;
}
