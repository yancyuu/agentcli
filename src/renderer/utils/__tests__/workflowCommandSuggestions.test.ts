import { describe, expect, it } from 'vitest';

import { buildWorkflowCommandSuggestion } from '../workflowCommandSuggestions';

import type { WorkflowPromptSummary } from '@shared/types/systemManager';

function prompt(overrides: Partial<WorkflowPromptSummary> = {}): WorkflowPromptSummary {
  return {
    id: 'prompt-loop-scan',
    label: 'Loop Scan',
    filename: 'loop-scan.md',
    path: '/workspace/.claude/commands/loop-scan.md',
    folder: '/workspace/.claude/commands',
    sizeBytes: 100,
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildWorkflowCommandSuggestion', () => {
  it('derives the command from commandName when present', () => {
    const suggestion = buildWorkflowCommandSuggestion(prompt({ commandName: '/loop-scan' }));
    expect(suggestion.command).toBe('/loop-scan');
    expect(suggestion.name).toBe('loop-scan');
    expect(suggestion.insertText).toBe('loop-scan');
  });

  it('falls back to the filename when there is no commandName', () => {
    const suggestion = buildWorkflowCommandSuggestion(prompt({ commandName: undefined }));
    expect(suggestion.command).toBe('/loop-scan');
  });

  it('carries workflowPromptId / workflowPromptFolder for submit-time expansion', () => {
    const suggestion = buildWorkflowCommandSuggestion(prompt());
    expect(suggestion.workflowPromptId).toBe('prompt-loop-scan');
    expect(suggestion.workflowPromptFolder).toBe('/workspace/.claude/commands');
  });

  it('uses a configurable id prefix', () => {
    expect(buildWorkflowCommandSuggestion(prompt()).id).toBe('workflow:prompt-loop-scan');
    expect(buildWorkflowCommandSuggestion(prompt(), 'team-workflow').id).toBe(
      'team-workflow:prompt-loop-scan'
    );
  });

  it('builds a searchable searchText from label/description/category/safety', () => {
    const suggestion = buildWorkflowCommandSuggestion(
      prompt({ description: 'Run loop scan', category: 'loop', safety: 'read-only' })
    );
    expect(suggestion.searchText).toContain('Loop Scan');
    expect(suggestion.searchText).toContain('read-only');
    expect(suggestion.searchText).toContain('/loop-scan');
  });

  it('falls back to a description from the label', () => {
    const suggestion = buildWorkflowCommandSuggestion(prompt({ description: undefined }));
    expect(suggestion.description).toBe('运行 Loop Scan');
  });
});
